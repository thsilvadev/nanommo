import { forwardRef, Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { BattleQueueEntry, Character, MapKillCounter, GambitPage, InventoryItem } from '@/database/entities';
import {
  BattleEngine,
  GambitEvaluator,
  Mulberry32,
  mulberry32Seed,
  rngForIndex,
  resolveRewards,
  type CombatantSnapshot,
} from '@nanommo/shared';
import { effectiveFoodStatValue, TOWN_MAP_ID } from '@nanommo/shared';
import { DataService } from '../data/data.service';
import { CharacterService } from '../character/character.service';
import { InventoryService, buildDietStateAfterFoodConsumption } from '../inventory/inventory.service';
import { EquipmentService } from '../equipment/equipment.service';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';
import { GatewayService, BattleResolvedPayload, CharacterLeveledUpPayload, CharacterDiedPayload } from '../gateway/gateway.service';
import { MapPresenceService } from '../presence/map-presence.service';

/** SPEC §11.2: epoch rollover once the counter reaches this many kills. */
const EPOCH_ROLLOVER_AT = 10_000;

/** SPEC §7.1: 1 tick = 1 second of in-game time. */
const MS_PER_TICK = 1000;

export function calculateEncounterSearchDelayMs(otherPlayers: number): number {
  return 2000 + Math.max(0, Math.floor(otherPlayers)) * 100;
}

export function calculateNextEncounterBoundaryAt(
  battleEndAt: number,
  otherPlayers: number,
): number {
  return battleEndAt + calculateEncounterSearchDelayMs(otherPlayers);
}

export function applyLevelXpResolution(
  currentXp: number,
  currentLevel: number,
  xpGain: number,
  getXpToNextLevel: (level: number) => number,
): { xp: number; level: number; levelsGained: number } {
  let xp = Math.max(0, Number(currentXp) || 0) + Math.max(0, Number(xpGain) || 0);
  let level = Math.max(1, Number(currentLevel) || 1);
  let levelsGained = 0;
  while (level < 99) {
    const threshold = Math.max(0, Number(getXpToNextLevel(level)) || 0);
    if (threshold <= 0 || xp < threshold) break;
    xp -= threshold;
    level += 1;
    levelsGained += 1;
  }
  return { xp, level, levelsGained };
}

@Injectable()
export class BattleService {
  private readonly logger = new Logger(BattleService.name);
  private readonly QUEUE_DEPTH_TARGET = 5;

  constructor(
    @InjectQueue('battle-queue')
    private readonly bullQueue: Queue,
    @InjectRepository(BattleQueueEntry)
    private readonly battleQueueRepo: Repository<BattleQueueEntry>,
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    @InjectRepository(MapKillCounter)
    private readonly mapKillCounterRepo: Repository<MapKillCounter>,
    @InjectRepository(GambitPage)
    private readonly gambitPageRepo: Repository<GambitPage>,
    @InjectRepository(InventoryItem)
    private readonly inventoryItemRepo: Repository<InventoryItem>,
    private readonly dataService: DataService,
    @Inject(forwardRef(() => CharacterService))
    private readonly characterService: CharacterService,
    private readonly inventoryService: InventoryService,
    private readonly equipmentService: EquipmentService,
    private readonly gatewayService: GatewayService,
    private readonly mapPresenceService: MapPresenceService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Get the current battle queue for a character
   */
  async getBattleQueue(characterId: string, limit: number = 5): Promise<BattleQueueEntry[]> {
    return this.battleQueueRepo.find({
      where: { characterId, resolved: false },
      order: { sequenceIndex: 'ASC' },
      take: limit,
    });
  }

  /**
   * Authoritative boundary for mutations that change future combat simulation.
   *
   * A mutation is always persisted. If a battle is currently running, that
   * battle remains immutable and its scheduled job is preserved; only the stale
   * future entries are discarded. The future chain is then rebuilt by the normal
   * battle-resolution/queue-advance boundary after the active battle finishes.
   * When no battle is running, the mutation immediately rebuilds the canonical
   * queue from the post-mutation authoritative state.
   */
  async runFutureCombatMutation<T>(
    characterId: string,
    mutation: () => Promise<T>,
  ): Promise<T> {
    const queue = await this.getBattleQueue(characterId, 100);
    const now = Date.now();
    const activeBattle = queue.find(
      (entry) => entry.startAt.getTime() <= now && now < entry.endAt.getTime(),
    );

    const result = await mutation();
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');

    if (activeBattle) {
      // The active battle is already a persisted immutable snapshot. Remove only
      // entries after it so no stale future simulation can resolve. Do not remove
      // or reschedule the active battle's BullMQ job.
      await this.discardUnresolvedBattles(characterId, activeBattle.id);
      const remainingQueue = await this.getBattleQueue(characterId, 100);
      await this.safePublishQueueUpdated(characterId, remainingQueue);
      return result;
    }

    await this.invalidateAndRebuildFutureCombatQueue(characterId);
    return result;
  }

  private async invalidateAndRebuildFutureCombatQueue(characterId: string): Promise<void> {
    await this.discardUnresolvedBattles(characterId);
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');

    const grinding =
      character.status === 'grinding' &&
      !!character.currentMapId &&
      !character.pendingMapTransition &&
      character.currentMapId !== TOWN_MAP_ID;

    if (!grinding) {
      await this.safePublishQueueUpdated(characterId, []);
      return;
    }

    await this.queueBattles(characterId, this.QUEUE_DEPTH_TARGET, false);
    const rebuiltQueue = await this.getBattleQueue(characterId, 5);
    const snapshot = await this.buildAuthoritativeBattleSnapshot(characterId);
    await this.safePublishQueueUpdated(characterId, rebuiltQueue, snapshot);
  }

  async getResolvedBattleHistory(characterId: string, limit = 100): Promise<any[]> {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    const rows = await this.battleQueueRepo.find({
      where: { characterId, resolved: true }, order: { startAt: 'DESC' }, take: safeLimit,
    });
    return rows.map((battle) => {
      const monster = this.dataService.getMonsterById(battle.monsterId);
      const map = this.dataService.getMapById(battle.mapId);
      return { id:battle.id, outcome:battle.outcome, monsterId:battle.monsterId, monsterName:monster?.name ?? battle.monsterId,
        monsterLevel:Number(monster?.level ?? 0), mapId:battle.mapId, mapName:map?.name ?? battle.mapId,
        startAt:battle.startAt, endAt:battle.endAt, xpGain:Number(battle.xpGain ?? 0), goldGain:Number(battle.goldGain ?? 0) };
    });
  }

  async getResolvedBattleDetail(characterId: string, battleId: string): Promise<any | null> {
    const battle = await this.battleQueueRepo.findOne({ where: { id:battleId, characterId, resolved:true } });
    if (!battle) return null;
    const monster = this.dataService.getMonsterById(battle.monsterId);
    const map = this.dataService.getMapById(battle.mapId);
    return { id:battle.id, outcome:battle.outcome, monsterId:battle.monsterId, monsterName:monster?.name ?? battle.monsterId,
      monsterLevel:Number(monster?.level ?? 0), mapId:battle.mapId, mapName:map?.name ?? battle.mapId, startAt:battle.startAt,
      endAt:battle.endAt, xpGain:Number(battle.xpGain ?? 0), goldGain:Number(battle.goldGain ?? 0), drops:battle.drops ?? [],
      itemsConsumed:battle.itemsConsumed ?? [], hpAfter:battle.hpAfter, spAfter:battle.spAfter, seedUsed:battle.seedUsed, log:battle.log };
  }

  /**
   * Get a single battle by ID
   */
  async getBattleById(battleId: string): Promise<BattleQueueEntry | null> {
    return this.battleQueueRepo.findOne({
      where: { id: battleId },
    });
  }

  // ===========================================================================
  //  Combatant state assembly
  // ===========================================================================

  /**
   * Flatten the character's live inventory into an itemId -> quantity map.
   * This is what the engine's `use_item` legality check reads (SPEC §7.3 step 3).
   */
  private async buildInventoryMap(characterId: string): Promise<Record<string, number>> {
    const items = await this.inventoryItemRepo.find({
      where: { characterId, location: 'inventory' },
    });
    const map: Record<string, number> = {};
    for (const row of items) {
      map[row.itemId] = (map[row.itemId] ?? 0) + row.quantity;
    }
    return map;
  }

  /**
   * SPEC §9.1: a skill is usable only if its weapon type is equipped AND
   * WeaponProficiency.level >= skill.unlockWeaponLevel.
   */
  private async buildSkillAvailability(characterId: string): Promise<{
    skills: Record<string, any>;
    skillDefs: Record<string, any>;
    weaponTypes: string[];
  }> {
    const equipped = await this.equipmentService.getEquipment(characterId);
    const equippedIds = new Set(equipped.map((e) => e.itemId));

    const weaponTypes: string[] = [];
    for (const slot of ['mainHand', 'offHand']) {
      const row = equipped.find((e) => e.slot === slot);
      if (!row) continue;
      const def = this.dataService.getItemById(row.itemId);
      if (def?.weaponType && !weaponTypes.includes(def.weaponType)) {
        weaponTypes.push(def.weaponType);
      }
    }
    void equippedIds;

    const proficiencies = await this.equipmentService.getWeaponProficiencyLevels(characterId);
    const skills: Record<string, any> = {};
    const skillDefs: Record<string, any> = {};

    for (const weaponType of weaponTypes) {
      const profLevel = proficiencies[weaponType] ?? 1;
      for (const skill of this.dataService.getSkillsForWeapon(weaponType)) {
        if (Number(skill.unlockWeaponLevel ?? 1) > profLevel) continue;
        skills[skill.id] = skill;
        skillDefs[skill.id] = skill;
      }
    }

    return { skills, skillDefs, weaponTypes };
  }

  /**
   * The DB-backed half of a combatant snapshot: equipment stats, weapon
   * proficiency and the resulting skill set.
   *
   * Split out from `buildCharacterSnapshot()` because it is the only part that
   * touches the database, and it does not change across a simulated chain - the
   * whole batch fights with one loadout. `queueBattles()` therefore loads it once
   * and reuses it for every battle, instead of re-querying equipment and
   * proficiency per battle (SPEC §9.1).
   */
  private async loadCombatantLoadout(characterId: string): Promise<{
    equipmentStats: Awaited<ReturnType<EquipmentService['calculateEquipmentStats']>>;
    skills: Record<string, any>;
    skillDefs: Record<string, any>;
    weaponTypes: string[];
  }> {
    const equipmentStats = await this.equipmentService.calculateEquipmentStats(characterId);
    const { skills, skillDefs, weaponTypes } = await this.buildSkillAvailability(characterId);
    return { equipmentStats, skills, skillDefs, weaponTypes };
  }

  /**
   * Build the real combatant snapshot handed to BattleEngine.simulateBattle().
   * Equipment bonuses, weapon proficiency and live inventory are all included.
   *
   * `loadout` is the pre-loaded result of `loadCombatantLoadout()`. Omit it only
   * for a one-off snapshot (it is then loaded here); pass it when building a chain.
   */
  async buildCharacterSnapshot(
    character: Character,
    hp: number,
    sp: number,
    atTime: number = Date.now(),
    foodOverride: any = character.activeFoodBuff,
    loadout?: Awaited<ReturnType<BattleService['loadCombatantLoadout']>>,
    foodDigestOverride?: Record<string, number>,
  ): Promise<CombatantSnapshot> {
    const { equipmentStats, skills, skillDefs, weaponTypes } =
      loadout ?? (await this.loadCombatantLoadout(character.id));

    const derived = BattleEngine.calculateDerivedStats(
      character.level,
      {
        str: character.str + (equipmentStats.statBonus.STR || 0),
        agi: character.agi + (equipmentStats.statBonus.AGI || 0),
        dex: character.dex + (equipmentStats.statBonus.DEX || 0),
        vit: character.vit + (equipmentStats.statBonus.VIT || 0),
        int: character.int + (equipmentStats.statBonus.INT || 0),
        sor: character.sor + (equipmentStats.statBonus.SOR || 0),
      },
      {
        def: equipmentStats.def,
        mdefPercent: equipmentStats.mdefPercent,
        weaponFixedAtk: equipmentStats.weaponFixedAtk,
        weaponFixedMatk: equipmentStats.weaponFixedMatk,
      },
    );

    const food = foodOverride;
    const foodExpiry = food?.expiresAt ? new Date(food.expiresAt).getTime() : 0;
    const foodActive = foodExpiry > atTime;
    const foodTicks = foodActive ? Math.max(0, Math.ceil((foodExpiry - atTime) / MS_PER_TICK)) : 0;
    return {
      level: character.level,
      hp: Math.max(1, Math.min(hp, derived.maxHp)),
      sp: Math.max(0, Math.min(sp, derived.maxSp)),
      ...derived,
      hpRegenPerTenTicks: derived.hpRegenPerTenTicks + (foodActive ? Number(food.hpRegenPerTenTicks ?? 0) : 0),
      spRegenPerTenTicks: derived.spRegenPerTenTicks + (foodActive ? Number(food.spRegenPerTenTicks ?? 0) : 0),
      foodBuffTicksRemaining: foodTicks,
      foodBuffItemId: foodActive ? food.itemId : undefined,
      foodBuffHpRegenPerTenTicks: foodActive ? Number(food.hpRegenPerTenTicks ?? 0) : undefined,
      foodBuffSpRegenPerTenTicks: foodActive ? Number(food.spRegenPerTenTicks ?? 0) : undefined,
      dietLevelByFood: Object.fromEntries(Object.entries(character.dietLevels ?? {}).map(([itemId, value]) => [itemId, Math.max(0, Math.min(3, Number(value.level ?? 0)))])),
      foodDigestRemainingTicksByItem: foodDigestOverride ?? Object.fromEntries(
        Object.entries(character.dietLevels ?? {}).map(([itemId, value]) => {
          const until = Date.parse(value.lastDigestUntil);
          return [itemId, until > atTime ? Math.ceil((until - atTime) / MS_PER_TICK) : 0];
        }),
      ),
      skills,
      skillDefs,
      statusEffects: character.statusEffects ?? [],
      equippedWeaponTypes: weaponTypes,
    } as CombatantSnapshot;
  }

  /**
   * weaponBaseAttackTicks for the equipped weapon (SPEC §7.2). Falls back to
   * the skill_trees.json average when the character is unarmed.
   */
  private getWeaponBaseAttackTicks(weaponTypes: string[]): number {
    const table: Record<string, number> = this.dataService.getWeaponBaseAttackTicks();
    for (const wt of weaponTypes) {
      if (table[wt]) return table[wt];
    }
    const values = Object.values(table);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 6;
  }

  // ===========================================================================
  //  Queue generation
  // ===========================================================================

  /**
   * Queue multiple battles until reaching target depth.
   *
   * SPEC §7.4: the next N battles are simulated in one shot, each chained from
   * the previous one's hp/sp/inventory state. Rewards (xp/gold/drops) are rolled
   * here but only APPLIED at resolve time by the BullMQ job.
   */

  async queueBattles(
    characterId: string,
    targetDepth: number = this.QUEUE_DEPTH_TARGET,
    publishQueueEvent = true,
  ): Promise<BattleQueueEntry[]> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');

    if (character.pendingMapTransition) return this.getBattleQueue(characterId, 100);
    if (!character.currentMapId) {
      throw new BadRequestException('Character is not on a map');
    }

    const currentQueue = await this.getBattleQueue(characterId, 100);
    if (currentQueue.length >= targetDepth) {
      return currentQueue; // Already at target depth
    }

    let projectedFoodBuff = character.activeFoodBuff;
    let projectedFoodExpiresAt = projectedFoodBuff?.expiresAt ? new Date(projectedFoodBuff.expiresAt).getTime() : 0;
    let projectedFoodDigestUntil: Record<string, number> = Object.fromEntries(
      Object.entries(character.dietLevels ?? {}).map(([itemId, value]) => [itemId, Date.parse(value.lastDigestUntil)]),
    );

    const mapId = character.currentMapId;
    const battlesToAdd = targetDepth - currentQueue.length;
    const newBattles: BattleQueueEntry[] = [];

    const maxSequenceIndex =
      currentQueue.length > 0 ? Math.max(...currentQueue.map((b) => b.sequenceIndex)) : -1;

    // SPEC §7.4: battle N+1 starts from battle N's end state.
    let chainHp = character.hpCurrent;
    let chainSp = character.spCurrent;
    let chainTimelineMs = Date.now();
    const workingInventory = await this.buildInventoryMap(characterId);
    for (const pending of currentQueue) {
      chainHp = pending.hpAfter;
      chainSp = pending.spAfter;
      chainTimelineMs = Math.max(chainTimelineMs, pending.endAt.getTime());
      // pending potion consumption is not in the DB until each one resolves
      for (const consumed of pending.itemsConsumed ?? []) {
        workingInventory[consumed.itemId] = Math.max(
          0,
          (workingInventory[consumed.itemId] ?? 0) - consumed.quantity,
        );
      }
    }

    const projectFoodFromQueue = (entries: BattleQueueEntry[]) => {
      for (const pending of entries.sort((a, b) => a.sequenceIndex - b.sequenceIndex)) {
        for (const event of Array.isArray(pending.log?.events) ? pending.log.events : []) {
          if (event?.action !== 'use_item') continue;
          const def = this.dataService.getItemById(event.itemId);
          if (def?.effect?.type !== 'food_buff') continue;
          const usedAt = new Date(pending.startAt).getTime() + Number(event.tick ?? 0) * MS_PER_TICK;
          projectedFoodBuff = {
            itemId: event.itemId,
            hpRegenPerTenTicks: Number(def.effect?.hpRegenPerTenTicks ?? 0),
            spRegenPerTenTicks: Number(def.effect?.spRegenPerTenTicks ?? 0),
            expiresAt: new Date(usedAt + Number(def.effect?.durationSeconds ?? 0) * MS_PER_TICK).toISOString(),
          };
        }
        if (projectedFoodBuff?.expiresAt && new Date(projectedFoodBuff.expiresAt).getTime() <= new Date(pending.endAt).getTime()) {
          projectedFoodBuff = null;
        }
      }
    };
    projectFoodFromQueue(currentQueue);
    projectedFoodExpiresAt = projectedFoodBuff?.expiresAt ? new Date(projectedFoodBuff.expiresAt).getTime() : 0;
    if (!projectedFoodExpiresAt || projectedFoodExpiresAt <= Date.now()) {
      const activeBattle = currentQueue.find(
        (entry) => Date.parse(entry.startAt.toString()) <= Date.now() &&
          Date.now() < Date.parse(entry.endAt.toString()),
      );
      if (!activeBattle) {
        const leavingMapId = character.currentMapId;
        character.currentMapId = TOWN_MAP_ID;
        character.status = 'town';
        character.pendingMapTransition = null;
        character.lastSeenAt = new Date();
        await this.characterRepo.save(character);
        if (leavingMapId) {
          await this.mapPresenceService.syncCharacter(characterId, leavingMapId);
        }
        await this.discardUnresolvedBattles(characterId);
        if (publishQueueEvent) await this.safePublishQueueUpdated(characterId, []);
        return [];
      }
      return currentQueue;
    }

    const gambitPage = character.activeGambitPageId
      ? await this.gambitPageRepo.findOne({ where: { id: character.activeGambitPageId } })
      : null;

    const counter = await this.getOrCreateKillCounter(characterId, mapId);
    const monsters = this.dataService.getMonstersInMap(mapId);
    if (!monsters || monsters.length === 0) {
      throw new Error(`No monsters found in map ${mapId}`);
    }

    const monsterSkillDefs = Object.fromEntries(
      this.dataService.getMonsterSkills().map((s: any) => [s.id, s]),
    );
    const itemDefinitions = Object.fromEntries(
      (this.dataService.getItems()?.consumables ?? []).map((c: any) => [c.id, c]),
    );

    // SPEC §11.2: seed = mulberry32Seed(`${characterId}:${mapId}:${epoch}`)
    const encounterSeed = mulberry32Seed(`${characterId}:${mapId}:${counter.epoch}`);

    // PROJECTED per-monster kill counts: the DB counter is only bumped on
    // resolve, but we need a distinct drop index for each battle in this batch.
    let projectedMapKillCount = counter.mapKillCount;
    const projectedPerMonster = { ...(counter.perMonsterKillCount ?? {}) };

    let nextStartTime =
      currentQueue.length > 0
        ? new Date(currentQueue[currentQueue.length - 1].endAt)
        : new Date();

    // Encounter search: 2s base + 0.1s for every OTHER grinder currently on this map.
    // Character status/map membership is authoritative and the current character is excluded.
    const mapPlayers = await this.mapPresenceService.countActiveGrinders(mapId);
    const otherPlayers = Math.max(0, mapPlayers - 1);
    const encounterSearchMs = calculateEncounterSearchDelayMs(otherPlayers);

    // One loadout read for the whole batch: equipment and proficiency cannot
    // change between the chained battles, so re-reading them per battle would
    // multiply identical queries without changing any simulated result.
    const loadout = await this.loadCombatantLoadout(characterId);
    const weaponBaseAttackTicks = this.getWeaponBaseAttackTicks(loadout.weaponTypes);

    for (let i = 0; i < battlesToAdd; i++) {
      if (!projectedFoodExpiresAt || projectedFoodExpiresAt <= nextStartTime.getTime()) {
        break;
      }
      const sequenceIndex = maxSequenceIndex + 1 + i;
      const killIndex = projectedMapKillCount;

      // Every encounter has its own search phase, including the first one.
      const searchStartTime = new Date(nextStartTime);
      nextStartTime = new Date(nextStartTime.getTime() + encounterSearchMs);

      // SPEC §11.2: nextMonsterId(mapId, mapKillCount) = weightedPick(rngForIndex(mapKillCount))
      const monster = rngForIndex(encounterSeed, killIndex).weightedPick(monsters);
      const monsterId = monster.id;

      const snapshot = await this.buildCharacterSnapshot(
        character,
        chainHp,
        chainSp,
        nextStartTime.getTime(),
        projectedFoodBuff,
        loadout,
        Object.fromEntries(
          Object.entries(projectedFoodDigestUntil).map(([itemId, expiresAt]) => [
            itemId,
            expiresAt > nextStartTime.getTime() ? Math.ceil((expiresAt - nextStartTime.getTime()) / MS_PER_TICK) : 0,
          ]),
        ),
      );
      const regenAnchor = character.regenAnchorAt?.getTime?.() ?? Date.now();
      const fromTick = Math.max(0, Math.floor((chainTimelineMs - regenAnchor) / MS_PER_TICK));
      const toTick = Math.max(0, Math.floor((nextStartTime.getTime() - regenAnchor) / MS_PER_TICK));
      const elapsedRegenPeriods = Math.max(0, Math.floor(toTick / 10) - Math.floor(fromTick / 10));
      if (elapsedRegenPeriods > 0 && chainHp > 0) {
        const hpPerPeriod = Number(snapshot.hpRegenPerTenTicks ?? 0);
        const spPerPeriod = Number(snapshot.spRegenPerTenTicks ?? 0);
        const foodExpiry = projectedFoodBuff?.expiresAt ? new Date(projectedFoodBuff.expiresAt).getTime() : 0;
        const foodHpPerPeriod = Number(projectedFoodBuff?.hpRegenPerTenTicks ?? 0);
        const foodSpPerPeriod = Number(projectedFoodBuff?.spRegenPerTenTicks ?? 0);
        let hpGain = 0;
        let spGain = 0;
        const firstBoundary = Math.floor(fromTick / 10) + 1;
        for (let period = 0; period < elapsedRegenPeriods; period++) {
          const boundaryTick = (firstBoundary + period) * 10;
          const boundaryAt = regenAnchor + boundaryTick * MS_PER_TICK;
          hpGain += hpPerPeriod;
          spGain += spPerPeriod;
          if (foodExpiry > boundaryAt) {
            hpGain += foodHpPerPeriod;
            spGain += foodSpPerPeriod;
          }
        }
        chainHp = Math.min(snapshot.maxHp, chainHp + hpGain);
        chainSp = Math.min(snapshot.maxSp, chainSp + spGain);
        snapshot.hp = chainHp;
        snapshot.sp = chainSp;
      }
      const seed = `${characterId}:${mapId}:${monsterId}:${sequenceIndex}:${counter.epoch}:${killIndex}`;

      // ---- Gambit is evaluated INSIDE the engine, per gauge fire (SPEC §7.3)
      const regenTickOffset = Math.max(0, Math.floor((nextStartTime.getTime() - regenAnchor) / MS_PER_TICK));
      const simulation = BattleEngine.simulateBattle(snapshot, monster, gambitPage, seed, {
        inventory: workingInventory,
        itemDefinitions,
        monsterSkillDefs,
        regenTickOffset,
        weaponBaseAttackTicks,
      });

      chainHp = simulation.hpAfter;
      chainSp = simulation.spAfter;
      Object.assign(workingInventory, simulation.inventoryAfter);

      const battleEndTime = nextStartTime.getTime() + Math.max(1000, simulation.durationTicks * MS_PER_TICK);
      for (const event of Array.isArray(simulation.log?.events) ? simulation.log.events : []) {
        if (event?.action !== 'use_item') continue;
        const def = itemDefinitions[event.itemId];
        if (def?.effect?.type !== 'food_buff') continue;
        const usedAt = nextStartTime.getTime() + Number(event.tick ?? 0) * MS_PER_TICK;
        projectedFoodDigestUntil[event.itemId] = usedAt + Number(def.effect?.durationSeconds ?? 0) * MS_PER_TICK;
      }
      if (simulation.foodBuffAfter) {
        projectedFoodBuff = {
          itemId: simulation.foodBuffAfter.itemId,
          hpRegenPerTenTicks: simulation.foodBuffAfter.hpRegenPerTenTicks,
          spRegenPerTenTicks: simulation.foodBuffAfter.spRegenPerTenTicks,
          expiresAt: new Date(battleEndTime + simulation.foodBuffAfter.remainingTicks * MS_PER_TICK).toISOString(),
        };
      } else if ((snapshot.foodBuffTicksRemaining ?? 0) <= simulation.durationTicks) {
        projectedFoodBuff = null;
      }
      projectedFoodExpiresAt = projectedFoodBuff?.expiresAt ? new Date(projectedFoodBuff.expiresAt).getTime() : 0;

      // ---- Rewards: xp from xpReward, gold rolled from goldReward.min/max,
      //      drops from monsters.json chances (SPEC §11.5) - only on a win.
      const rewards = resolveRewards({
        monster,
        mapId,
        outcome: simulation.outcome,
        items: this.dataService.getItems(),
        killIndex: projectedPerMonster[monsterId] ?? 0,
        seed,
      });

      projectedMapKillCount += 1;
      projectedPerMonster[monsterId] = (projectedPerMonster[monsterId] ?? 0) + 1;

      const battleDurationMs = Math.max(1000, simulation.durationTicks * MS_PER_TICK);

      const entry = this.battleQueueRepo.create({
        characterId,
        sequenceIndex,
        mapId,
        monsterId,
        startAt: new Date(nextStartTime),
        endAt: new Date(nextStartTime.getTime() + battleDurationMs),
        outcome: simulation.outcome,
        log: { ...simulation.log, mapId, searchStartAt: searchStartTime.toISOString(), searchEndAt: nextStartTime.toISOString() },
        itemsConsumed: simulation.itemsConsumed,
        xpGain: rewards.xpGain,
        goldGain: rewards.goldGain,
        drops: rewards.drops,
        hpAfter: simulation.hpAfter,
        spAfter: simulation.spAfter,
        resolved: false,
        seedUsed: seed,
      });

      const saved = await this.battleQueueRepo.save(entry);
      newBattles.push(saved);
      chainTimelineMs = battleEndTime;


      const delayMs = saved.endAt.getTime() - Date.now();
      await this.bullQueue.add(
        'resolve-battle',
        { battleId: saved.id },
        {
          delay: Math.max(0, delayMs),
          jobId: saved.id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );

      this.logger.log(
        `Queued battle seq=${sequenceIndex} char=${characterId} ${monsterId} ` +
          `outcome=${simulation.outcome} ticks=${simulation.durationTicks} ` +
          `hpAfter=${simulation.hpAfter} xp=${rewards.xpGain} gold=${rewards.goldGain} ` +
          `drops=${rewards.drops.length} itemsConsumed=${simulation.itemsConsumed.length} ` +
          `resolvesIn=${Math.max(0, delayMs)}ms`,
      );

      if (simulation.outcome === 'loss') break;
      nextStartTime = new Date(nextStartTime.getTime() + battleDurationMs);
    }

    const liveQueue = [...currentQueue, ...newBattles];
    if (publishQueueEvent) await this.safePublishQueueUpdated(characterId, liveQueue);
    return liveQueue;
  }

  // ===========================================================================
  //  Resolve (runs from the BullMQ delayed job)
  // ===========================================================================

  /**
   * Resolve a battle and apply its effects. This is the ONLY place where
   * XP / gold / drops / consumed items / the kill counter actually mutate.
   *
   * The battle row and Character are locked inside one PostgreSQL transaction.
   * All authoritative database effects plus the final resolved marker commit
   * atomically, so a failed attempt rolls back and is safe to retry. Competing
   * jobs for the same Character serialize on the Character row; duplicate jobs
   * subsequently observe the committed resolved marker and become no-ops.
   */
  async resolveBattle(battleId: string): Promise<boolean> {
    // Read the immutable character foreign key first so we can always acquire
    // locks in Character -> Battle order. This serializes resolution work for a
    // character and avoids two different battle jobs each holding a battle row
    // while waiting for the same Character row.
    const reference = await this.battleQueueRepo.findOne({ where: { id: battleId } });
    if (!reference) throw new NotFoundException('Battle not found');

    const result = await this.battleQueueRepo.manager.transaction(async (manager) => {
      const battleRepo = manager.getRepository(BattleQueueEntry);
      const characterRepo = manager.getRepository(Character);
      const character = await characterRepo.findOne({
        where: { id: reference.characterId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!character) throw new Error('Character not found');

      const battle = await battleRepo.findOne({
        where: { id: battleId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!battle) throw new NotFoundException('Battle not found');
      if (battle.resolved) return { alreadyResolved: true as const };

      // Simulated consumptions and all resulting inventory changes share this
      // transaction with the battle claim and Character state.
      for (const consumed of battle.itemsConsumed ?? []) {
        const have = await this.inventoryService.getItemCount(character.id, consumed.itemId, manager);
        const take = Math.min(have, consumed.quantity);
        if (take > 0) {
          await this.inventoryService.removeItem(character.id, consumed.itemId, take, manager);
        }
      }

      if (battle.outcome === 'loss') {
        this.applyResolvedFoodState(character, battle);
        const death = await this.handleCharacterDeath(character, battle, manager);
        battle.resolved = true;
        await battleRepo.save(battle);
        return {
          alreadyResolved: false as const,
          kind: 'death' as const,
          battle,
          character,
          deathLog: death.deathLog,
          discardedBattleIds: death.discardedBattleIds,
          previousMapId: battle.mapId,
        };
      }

      // --- XP and combat result
      character.xp = Number(character.xp) + Number(battle.xpGain ?? 0);
      // Monsters do not award gold; retain the explicit authoritative zero.
      const monsterGoldGain = 0;
      if (monsterGoldGain > 0) {
        character.gold = Math.min(1_000_000_000_000, Number(character.gold) + monsterGoldGain);
      }

      character.hpCurrent = Math.max(1, battle.hpAfter);
      character.spCurrent = Math.max(0, battle.spAfter);

      const xpResolution = applyLevelXpResolution(
        0,
        character.level,
        character.xp,
        (level) => this.dataService.getXpToNextLevel(level),
      );
      character.xp = xpResolution.xp;
      character.level = xpResolution.level;
      const levelsGained = xpResolution.levelsGained;
      if (levelsGained > 0) character.unspentAttributePoints += 5;
      const leveledUp = levelsGained > 0;

      if (leveledUp) {
        // Both derived-stat snapshots use this transaction's authoritative loadout.
        const equipmentStats = await this.equipmentService.calculateEquipmentStats(character.id, manager);
        const attributes = {
          str: character.str + (equipmentStats.statBonus.STR || 0),
          agi: character.agi + (equipmentStats.statBonus.AGI || 0),
          dex: character.dex + (equipmentStats.statBonus.DEX || 0),
          vit: character.vit + (equipmentStats.statBonus.VIT || 0),
          int: character.int + (equipmentStats.statBonus.INT || 0),
          sor: character.sor + (equipmentStats.statBonus.SOR || 0),
        };
        const equipment = {
          def: equipmentStats.def,
          mdefPercent: equipmentStats.mdefPercent,
          weaponFixedAtk: equipmentStats.weaponFixedAtk,
          weaponFixedMatk: equipmentStats.weaponFixedMatk,
        };
        const before = BattleEngine.calculateDerivedStats(character.level - levelsGained, attributes, equipment);
        const after = BattleEngine.calculateDerivedStats(character.level, attributes, equipment);
        character.hpCurrent = Math.min(
          after.maxHp,
          Math.max(1, Math.round(Number(character.hpCurrent) * (after.maxHp / before.maxHp))),
        );
        character.spCurrent = Math.min(
          after.maxSp,
          Math.max(0, Math.round(Number(character.spCurrent) * (after.maxSp / before.maxSp))),
        );
      }

      this.applyResolvedFoodState(character, battle);
      const equipmentChanged = await this.equipmentService.applyPendingEquipmentChanges(character.id, manager);
      await characterRepo.save(character);

      // Drops are part of the same transaction as rewards. Preserve the existing
      // overflow policy: if both inventory and warehouse are full, log and keep
      // resolving other drops rather than aborting the battle.
      if (Array.isArray(battle.drops) && battle.drops.length > 0) {
        for (const drop of battle.drops) {
          try {
            await this.inventoryService.addItem(
              character.id,
              drop.itemId,
              drop.quantity ?? 1,
              'inventory',
              drop.instanceData,
              manager,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to add drop ${drop.itemId} to ${character.id}: ${
                error instanceof Error ? error.message : 'unknown'
              }`,
            );
          }
        }
      }

      // Keep Character + Inventory under one final Character revision.
      await characterRepo.save(character);

      // Auto Feed uses the same EntityManager; a conflict/exception rolls back
      // the battle instead of leaving a partially applied payout. Eligibility
      // conflicts for still-digesting foods are handled as a normal skipped item.
      const autoFed = await this.tryAutoFeed(character, 0, manager);
      if (autoFed) await characterRepo.save(character);

      const killCounter = await this.incrementKillCounter(character.id, battle.mapId, battle.monsterId, manager);
      const previousMapId = character.currentMapId;
      const returningToTown = character.pendingMapTransition?.destinationMapId === TOWN_MAP_ID;
      const foodExpiresAt = character.activeFoodBuff?.expiresAt
        ? new Date(character.activeFoodBuff.expiresAt).getTime()
        : 0;
      const hungryAfterBattle = !foodExpiresAt || foodExpiresAt <= Date.now();
      const routedToTown = returningToTown || hungryAfterBattle;

      if (routedToTown) {
        character.pendingMapTransition = null;
        character.currentMapId = TOWN_MAP_ID;
        character.status = 'town';
        character.lastSeenAt = new Date();
        await characterRepo.save(character);
      }

      // The success marker is written only after all transactional battle effects
      // are complete. The transaction commits it atomically with XP, inventory,
      // character state, Diet, equipment substitutions and the kill counter.
      battle.resolved = true;
      await battleRepo.save(battle);

      const queueRepo = manager.getRepository(BattleQueueEntry);
      let discardedBattleIds: string[] = [];
      // These future rows were simulated against state that no longer exists:
      // Town/death ends Grind; Auto Feed changes food/inventory; level-up changes
      // derived stats; applying pending equipment changes changes the loadout.
      // Remove them in this same transaction, then rebuild the fresh chain after
      // commit. If the transaction fails, both the battle and its old queue stay.
      if (character.status === 'town' || autoFed || leveledUp || equipmentChanged) {
        const unresolved = await queueRepo.find({ where: { characterId: character.id, resolved: false } });
        discardedBattleIds = unresolved.map((entry) => entry.id);
        if (discardedBattleIds.length) await queueRepo.delete({ id: In(discardedBattleIds) });
      }

      return {
        alreadyResolved: false as const,
        kind: 'win' as const,
        battle,
        character,
        killCounter,
        levelsGained,
        leveledUp,
        equipmentChanged,
        autoFed,
        discardedBattleIds,
        previousMapId: routedToTown ? previousMapId : null,
      };
    });

    if (result.alreadyResolved) {
      this.logger.log(`Battle ${battleId} already resolved - skipping`);
      // Tell callers not to run their post-resolution queue top-up for a
      // duplicate delivery while the winning caller is maintaining the queue.
      return false;
    }

    // BullMQ, Redis presence and Socket.IO are deliberately outside the database
    // transaction. Their failure cannot roll back or duplicate the committed
    // battle payout; stale queue rows have already been removed atomically above.
    const jobsToRemove = [...new Set([battleId, ...result.discardedBattleIds])];
    for (const id of jobsToRemove) {
      try {
        const job = await this.bullQueue.getJob(id);
        if (!job) continue;
        const state = await job.getState();
        if (id === battleId && state === 'active') continue;
        await job.remove();
      } catch (error) {
        this.logger.debug(
          `Could not remove BullMQ job for battle ${id}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }

    if (result.previousMapId) {
      try {
        await this.mapPresenceService.syncCharacter(result.character.id, result.previousMapId);
      } catch (error) {
        this.logger.warn(
          `Map presence sync failed after battle ${result.battle.id} committed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }

    if (result.kind === 'death') {
      await this.safePublishBattleResolved(result.character.id, result.battle);
      await this.safePublishCharacterDied(result.character.id, result.deathLog);
      return true;
    }

    // Queue operations depend on committed Character / Inventory / kill-counter
    // state. In particular, Auto Feed rebuild now happens AFTER the kill index is
    // incremented, so the new chain cannot replay the kill just resolved.
    try {
      if (result.character.status !== 'town') {
        if (result.autoFed || result.leveledUp || result.equipmentChanged) {
          await this.invalidateAndRebuildFutureCombatQueue(result.character.id);
        } else if (result.character.currentMapId && result.character.status === 'grinding') {
          await this.queueBattles(result.character.id, this.QUEUE_DEPTH_TARGET, false);
        }
      }
    } catch (error) {
      // The payout has committed. The processor's queue-depth top-up and boot
      // recovery can repair queue shape; do not report the battle itself failed.
      this.logger.error(
        `Battle ${result.battle.id} committed but queue maintenance failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }

    if (result.leveledUp) {
      await this.safePublishCharacterLeveledUp(result.character.id, {
        newLevel: result.character.level,
        unspentAttributePoints: result.character.unspentAttributePoints,
      });
    }
    await this.safePublishBattleResolved(result.character.id, result.battle);
    try {
      const liveQueue = await this.getBattleQueue(result.character.id, 5);
      const authoritativeSnapshot = await this.buildAuthoritativeBattleSnapshot(result.character.id);
      await this.safePublishQueueUpdated(result.character.id, liveQueue, authoritativeSnapshot);
    } catch (error) {
      // All authoritative effects are already committed. A read/snapshot failure
      // cannot turn the successful battle into a retry that would skip publication.
      this.logger.warn(
        `Post-commit queue snapshot failed for ${result.character.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.logger.log(
      `Resolved battle ${result.battle.id} char=${result.character.id} ${result.battle.monsterId} ` +
        `xp+=${result.battle.xpGain} gold+=${result.battle.goldGain} drops=${JSON.stringify(result.battle.drops)} ` +
        `level=${result.character.level} xp=${result.character.xp} gold=${result.character.gold} ` +
        `mapKillCount=${result.killCounter.mapKillCount} perMonster=${result.battle.monsterId}:${result.killCounter.perMonsterCount}`,
    );
    return true;
  }

  private async tryAutoFeed(character: Character, boundaryAt: number, manager?: EntityManager): Promise<boolean> {
    if (!character.autoFeed || character.pendingMapTransition) return false;

    // Auto Feed is evaluated at every authoritative battle-resolution boundary.
    // An already-active food buff does not suppress feeding: any Diet entry whose
    // digestion has reached 0 and whose food is available may be consumed now.
    // boundaryAt remains part of the caller's Grind-continuity calculation, but
    // eligibility is defined by the current Diet digestion state.
    void boundaryAt;

    const now = Date.now();
    let consumedAny = false;

    // Fill every currently eligible Diet slot in the same authoritative boundary.
    // Each successful consumeFood() mutates Character.diet, so re-read the current
    // Diet on every pass. This naturally preserves FIFO rotation and the rule that
    // the same food cannot be consumed again while it is still digesting.
    for (let pass = 0; pass < 3; pass++) {
      const diet = Array.isArray(character.diet) ? character.diet : [];
      let consumedThisPass = false;

      for (const entry of diet) {
        const itemId = entry?.itemId;
        if (!itemId) continue;
        // Repeated foods intentionally occupy multiple Diet slots. Eligibility
        // follows the latest retained occurrence, exactly as consumeFood() does.
        const latestEntry = [...diet].reverse().find((candidate) => candidate?.itemId === itemId);
        if (entry !== latestEntry) continue;

        const definition = this.dataService.getItemById(itemId);
        if (definition?.type !== 'food' || definition.effect?.type !== 'food_buff') continue;

        const digestUntil = entry?.digestUntil ? Date.parse(entry.digestUntil) : 0;
        if (digestUntil > now) continue;

        if ((await this.inventoryService.getItemCount(character.id, itemId, manager)) <= 0) continue;

        let updated: Character;
        try {
          updated = await this.inventoryService.consumeFood(character.id, itemId, manager);
        } catch (error) {
          // A concurrent/just-refreshed digestion timestamp is a normal lost
          // eligibility race, not a battle-resolution failure. Try another food.
          if (error instanceof BadRequestException && error.message === 'Food is still digesting') continue;
          throw error;
        }
        Object.assign(character, updated);
        consumedAny = true;
        consumedThisPass = true;
        break;
      }

      if (!consumedThisPass) break;
    }

    return consumedAny;
  }

  private applyResolvedFoodState(character: Character, battle: BattleQueueEntry): void {
    const events = Array.isArray(battle.log?.events) ? battle.log.events : [];
    let diet = Array.isArray(character.diet) ? character.diet.slice() : [];
    const dietLevels = character.dietLevels ?? {};
    let lastFoodUse: { event: any; def: any } | null = null;

    for (const event of events) {
      if (event?.action !== 'use_item') continue;
      const def = this.dataService.getItemById(event.itemId);
      if (def?.effect?.type !== 'food_buff') continue;

      const usedAt = new Date(battle.startAt).getTime() + Number(event.tick ?? 0) * MS_PER_TICK;
      const digestUntil = new Date(usedAt + Number(def.effect?.durationSeconds ?? 0) * MS_PER_TICK).toISOString();
      const previousEntry = [...diet].reverse().find((entry) => entry.itemId === event.itemId);
      const previousDigestUntil = previousEntry?.digestUntil ? Date.parse(previousEntry.digestUntil) : 0;
      if (previousEntry && previousDigestUntil > usedAt) continue;

      const dietState = buildDietStateAfterFoodConsumption(
        diet,
        event.itemId,
        new Date(usedAt).toISOString(),
        digestUntil,
      );
      diet = dietState.diet;
      lastFoodUse = { event, def };
    }

    character.diet = diet;
    character.dietLevels = Object.fromEntries(
      diet.map((entry) => [
        entry.itemId,
        { level: Math.max(0, Math.min(3, Number(entry.dietLevel ?? 0))), lastDigestUntil: entry.digestUntil },
      ]),
    );

    if (lastFoodUse) {
      const usedAt = new Date(battle.startAt).getTime() + Number(lastFoodUse.event.tick ?? 0) * MS_PER_TICK;
      character.activeFoodBuff = {
        itemId: lastFoodUse.def.id,
        hpRegenPerTenTicks: effectiveFoodStatValue(lastFoodUse.def.effect?.hpRegenPerTenTicks, Number(dietLevels[lastFoodUse.event.itemId]?.level ?? 0)),
        spRegenPerTenTicks: effectiveFoodStatValue(lastFoodUse.def.effect?.spRegenPerTenTicks, Number(dietLevels[lastFoodUse.event.itemId]?.level ?? 0)),
        expiresAt: new Date(usedAt + Number(lastFoodUse.def.effect?.durationSeconds ?? 0) * MS_PER_TICK).toISOString(),
      };
    } else if (character.activeFoodBuff?.expiresAt && new Date(character.activeFoodBuff.expiresAt).getTime() <= Date.now()) {
      character.activeFoodBuff = null;
    }
  }

  private async discardUnresolvedBattles(characterId: string, preserveBattleId?: string): Promise<void> {
    const unresolved = await this.battleQueueRepo.find({
      where: { characterId, resolved: false },
      order: { sequenceIndex: 'ASC' },
    });
    const remaining = preserveBattleId
      ? unresolved.filter((entry) => entry.id !== preserveBattleId)
      : unresolved;
    if (!remaining.length) return;
    for (const entry of remaining) {
      await this.bullQueue.getJob(entry.id).then((job) => job?.remove()).catch(() => undefined);
    }
    await this.battleQueueRepo.delete({ id: In(remaining.map((entry) => entry.id)), resolved: false });
  }

  /**
   * Handle character death (SPEC §7.6)
   */
  private async handleCharacterDeath(
    character: Character,
    battle: BattleQueueEntry,
    manager: EntityManager,
  ): Promise<{ deathLog: any; discardedBattleIds: string[] }> {
    const characterRepo = manager.getRepository(Character);
    const queueRepo = manager.getRepository(BattleQueueEntry);
    character.status = 'town';
    character.currentMapId = TOWN_MAP_ID;
    character.lastSeenAt = new Date();
    character.hpCurrent = 1;
    character.pendingMapTransition = null;

    const xpLoss = Math.floor(this.dataService.getXpToNextLevel(character.level) * 0.05);
    character.xp = Math.max(0, Number(character.xp) - xpLoss);
    character.lastDeathLog = {
      monsterId: battle.monsterId,
      mapId: battle.mapId,
      timestamp: new Date().toISOString(),
      log: battle.log,
    };
    await characterRepo.save(character);

    // Exclude this battle (still marked unresolved until its transactional commit).
    const pending = await queueRepo.find({ where: { characterId: character.id, resolved: false } });
    const doomed = pending.filter((entry) => entry.id !== battle.id);
    const discardedBattleIds = doomed.map((entry) => entry.id);
    if (discardedBattleIds.length) await queueRepo.delete({ id: In(discardedBattleIds) });

    await this.resetEncounterSequence(character.id, battle.mapId, 'death', manager);
    this.logger.log(
      `Character ${character.id} died to ${battle.monsterId}; ${doomed.length} queued battle(s) discarded`,
    );

    return { deathLog: character.lastDeathLog, discardedBattleIds };
  }

  async publishQueueUpdated(characterId: string): Promise<void> {
    const entries = await this.getBattleQueue(characterId, 5);
    await this.safePublishQueueUpdated(characterId, entries);
  }

  async cancelPendingBattlesAfter(characterId: string, activeBattleId: string): Promise<void> {
    const pending = await this.battleQueueRepo.find({
      where: { characterId, resolved: false },
    });
    const future = pending.filter((entry) => entry.id !== activeBattleId);
    if (!future.length) return;
    await this.battleQueueRepo.delete({ id: In(future.map((entry) => entry.id)), resolved: false });
    for (const entry of future) {
      await this.bullQueue.getJob(entry.id).then((job) => job?.remove()).catch(() => undefined);
    }
  }

  async cancelPendingBattles(characterId: string): Promise<void> {
    const pending = await this.battleQueueRepo.find({
      where: { characterId, resolved: false },
    });
    if (!pending.length) return;

    await this.battleQueueRepo.delete({ id: In(pending.map((entry) => entry.id)), resolved: false });
    for (const entry of pending) {
      await this.bullQueue.getJob(entry.id).then((job) => job?.remove()).catch(() => undefined);
    }
  }

  private async safePublishQueueUpdated(
    characterId: string,
    entries: BattleQueueEntry[],
    state?: { stateRevision: number; characterAfter: any; inventoryAfter: any[] },
  ): Promise<void> {
    try {
      await this.gatewayService.publishBattleQueueUpdated(characterId, entries, state);
    } catch (error) {
      this.logger.warn(`battle:queueUpdated publication failed for ${characterId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async buildAuthoritativeBattleSnapshot(characterId: string): Promise<{
    stateRevision: number;
    characterAfter: any;
    inventoryAfter: any[];
  } | undefined> {
    const characterRow = await this.characterRepo.findOne({ where: { id: characterId } });
    const characterAfter = await this.characterService.getCharacterDtoById(characterId);
    if (!characterRow || !characterAfter) {
      this.logger.warn('authoritative battle snapshot unavailable for ' + characterId);
      return undefined;
    }
    return {
      stateRevision: characterRow.stateVersion,
      characterAfter,
      inventoryAfter: await this.inventoryService.getInventory(characterId),
    };
  }

  private async safePublishBattleResolved(characterId: string, battle: BattleQueueEntry): Promise<void> {
    try {
      const state = await this.buildAuthoritativeBattleSnapshot(characterId);
      if (!state) return;
      const payload: BattleResolvedPayload = {
        entryId: battle.id,
        outcome: battle.outcome,
        xpGain: Number(battle.xpGain ?? 0),
        goldGain: Number(battle.goldGain ?? 0),
        drops: battle.drops ?? [],
        ...state,
      };
      await this.gatewayService.publishBattleResolved(characterId, payload);
    } catch (error) {
      // Snapshot assembly and transport are post-commit work too. Do not bubble
      // them to BullMQ as a failed battle: a retry sees resolved=true and cannot
      // safely reproduce a missed socket event. Log it for observability instead.
      this.logger.warn(`battle:resolved snapshot/publication failed for ${characterId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async safePublishCharacterLeveledUp(characterId: string, payload: CharacterLeveledUpPayload): Promise<void> {
    try {
      await this.gatewayService.publishCharacterLeveledUp(characterId, payload);
    } catch (error) {
      this.logger.warn(`character:leveledUp publication failed for ${characterId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async safePublishCharacterDied(characterId: string, deathLog: any): Promise<void> {
    try {
      await this.gatewayService.publishCharacterDied(characterId, { deathLog });
    } catch (error) {
      this.logger.warn(`character:died publication failed for ${characterId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ===========================================================================
  //  MapKillCounter (SPEC §11.2)
  // ===========================================================================

  private async getOrCreateKillCounter(characterId: string, mapId: string, manager?: EntityManager): Promise<MapKillCounter> {
    const repo = manager?.getRepository(MapKillCounter) ?? this.mapKillCounterRepo;
    let counter = await repo.findOne({ where: { characterId, mapId } });
    if (!counter) {
      counter = await repo.save(
        repo.create({
          characterId,
          mapId,
          epoch: 0,
          mapKillCount: 0,
          perMonsterKillCount: {},
        }),
      );
    }
    return counter;
  }

  /**
   * SPEC §11.2 epoch rollover: when mapKillCount (or a given monster's
   * perMonsterKillCount) reaches 10,000, increment epoch and reset the counter.
   * The seed incorporates epoch, so the sequence "feels" fresh.
   *
   * Called from resolveBattle only - one increment per actually resolved kill.
   */
  async incrementKillCounter(
    characterId: string,
    mapId: string,
    monsterId: string,
    manager?: EntityManager,
  ): Promise<{ mapKillCount: number; perMonsterCount: number; epoch: number }> {
    const repo = manager?.getRepository(MapKillCounter) ?? this.mapKillCounterRepo;
    const counter = await this.getOrCreateKillCounter(characterId, mapId, manager);

    counter.mapKillCount = Number(counter.mapKillCount ?? 0) + 1;

    const perMonster = { ...(counter.perMonsterKillCount ?? {}) };
    perMonster[monsterId] = Number(perMonster[monsterId] ?? 0) + 1;
    counter.perMonsterKillCount = perMonster;

    if (counter.mapKillCount >= EPOCH_ROLLOVER_AT) {
      counter.epoch = Number(counter.epoch ?? 0) + 1;
      counter.mapKillCount = 0;
      this.logger.log(
        `MapKillCounter epoch rollover for ${characterId}/${mapId} -> epoch ${counter.epoch}`,
      );
    }

    await repo.save(counter);

    return {
      mapKillCount: Number(counter.mapKillCount),
      perMonsterCount: Number(perMonster[monsterId] ?? 0),
      epoch: Number(counter.epoch ?? 0),
    };
  }

  /**
   * Leaving the map restarts its encounter sequence (SPEC §11.2) - the same
   * effect a death has, so walking back in never replays the run that just ended.
   *
   * A death is the motivating case: a loss never advances `mapKillCount` (that
   * only happens on a resolved kill), so without a reset the character re-entering
   * the map would be handed the exact same stream from the exact same index - the
   * killer included - for as long as it keeps dying there. Rolling `epoch`
   * re-derives a fresh sequence through the same deterministic mechanism the
   * 10,000-kill rollover already uses, so §11.2 keeps its shape: same (seed, index)
   * -> same monster, new seed now.
   *
   * The monster is redrawn by the map's weights, so any previous opponent can
   * still come up again - just not pinned, and never as the forced first
   * encounter of a re-entry.
   */
  async resetEncounterSequence(characterId: string, mapId: string, reason: string, manager?: EntityManager): Promise<void> {
    const repo = manager?.getRepository(MapKillCounter) ?? this.mapKillCounterRepo;
    const counter = await this.getOrCreateKillCounter(characterId, mapId, manager);

    counter.epoch = Number(counter.epoch ?? 0) + 1;
    counter.mapKillCount = 0;
    counter.perMonsterKillCount = {};

    await repo.save(counter);

    this.logger.log(
      `MapKillCounter reset (${reason}) for ${characterId}/${mapId} -> epoch ${counter.epoch}`,
    );
  }

  /**
   * Read the kill counter without touching it (diagnostics / the map endpoint)
   */
  async getKillCounter(characterId: string, mapId: string): Promise<MapKillCounter | null> {
    return this.mapKillCounterRepo.findOne({ where: { characterId, mapId } });
  }
}
