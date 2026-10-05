import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import { effectiveFoodStatValue } from '@nanommo/shared';
import { DataService } from '../data/data.service';
import { CharacterService } from '../character/character.service';
import { InventoryService, buildDietStateAfterFoodConsumption } from '../inventory/inventory.service';
import { EquipmentService } from '../equipment/equipment.service';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';
import { GatewayService, BattleResolvedPayload, CharacterLeveledUpPayload, CharacterDiedPayload } from '../gateway/gateway.service';

/** SPEC §11.2: epoch rollover once the counter reaches this many kills. */
const EPOCH_ROLLOVER_AT = 10_000;

/** SPEC §7.1: 1 tick = 1 second of in-game time. */
const MS_PER_TICK = 1000;

export function calculateEncounterSearchDelayMs(otherPlayers: number): number {
  return 2000 + Math.max(0, Math.floor(otherPlayers)) * 100;
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
    private readonly characterService: CharacterService,
    private readonly inventoryService: InventoryService,
    private readonly equipmentService: EquipmentService,
    private readonly gatewayService: GatewayService,
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

    if (character.returnToTownAfterBattle) return this.getBattleQueue(characterId, 100);
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
        character.currentMapId = null as any;
        character.status = 'town';
        character.returnToTownAfterBattle = false;
        character.lastSeenAt = new Date();
        await this.characterRepo.save(character);
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
    const mapPlayers = await this.characterRepo.count({
      where: { currentMapId: mapId, status: 'grinding' as any },
    });
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
   * xp / gold / drops / consumed items / the kill counter actually mutate.
   *
   * Idempotent: the row is claimed with a conditional UPDATE before any effect
   * is applied. The same battle can legitimately be handed to this method twice —
   * once by the BullMQ delayed job and once by the §7.5 boot recovery pass (or
   * by a BullMQ retry after a partial failure) — and XP/gold/drops/inventory
   * must not be granted twice.
   */
  async resolveBattle(battleId: string): Promise<void> {
    const claimed = await this.battleQueueRepo
      .createQueryBuilder()
      .update(BattleQueueEntry)
      .set({ resolved: true })
      .where('"id" = :battleId', { battleId })
      .andWhere('"resolved" = false')
      .execute();

    if (!claimed.affected) {
      this.logger.log(`Battle ${battleId} already resolved - skipping`);
      return;
    }

    // A delayed job that is still pending for this battle is now redundant, so
    // drop it. This is the case when the §7.5 boot recovery pass wins the race.
    // When we are the job's own handler the job is `active` and locked, and
    // BullMQ refuses removal — that is expected, not an error.
    try {
      const job = await this.bullQueue.getJob(battleId);
      if (job && (await job.getState()) !== 'active') {
        await job.remove();
      }
    } catch (error) {
      this.logger.debug(
        `Could not remove BullMQ job for battle ${battleId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }

    const battle = await this.battleQueueRepo.findOne({ where: { id: battleId } });
    if (!battle) throw new NotFoundException('Battle not found');

    const character = await this.characterRepo.findOne({
      where: { id: battle.characterId },
    });
    if (!character) throw new Error('Character not found');

    // Items were spent during the simulation - they leave the real inventory now.
    for (const consumed of battle.itemsConsumed ?? []) {
      const have = await this.inventoryService.getItemCount(character.id, consumed.itemId);
      const take = Math.min(have, consumed.quantity);
      if (take > 0) {
        await this.inventoryService.removeItem(character.id, consumed.itemId, take);
      }
    }

    if (battle.outcome === 'loss') {
      this.applyResolvedFoodState(character, battle);
      const deathLog = await this.handleCharacterDeath(character, battle);
      await this.safePublishBattleResolved(character.id, battle);
      await this.safePublishCharacterDied(character.id, deathLog);
      return;
    }

    // --- XP: the monster's xpReward, already rolled at simulation time
    character.xp = Number(character.xp) + Number(battle.xpGain ?? 0);

    // Monsters do not award gold. Keep this explicit at the authoritative apply boundary
    // so legacy queued entries cannot grant monster gold even if they were created earlier.
    const monsterGoldGain = 0;
    if (monsterGoldGain > 0) {
      character.gold = Math.min(1_000_000_000_000, Number(character.gold) + monsterGoldGain);
    }

    character.hpCurrent = Math.max(1, battle.hpAfter);
    character.spCurrent = Math.max(0, battle.spAfter);

    // --- level ups: consume every crossed threshold; the reduced Grind XP rate
    // is the pacing control, so a single resolution is allowed to advance multiple levels.
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
      // SPEC §6.3: maxHp/maxSp recompute immediately, but hpCurrent/spCurrent are
      // NOT auto-topped - they stay ratio-adjusted so a mid-grind level-up can
      // neither heal for free nor leave HP nonsensically low against the new max.
      // A single ratio step is applied for the whole batch of levels gained, using
      // the stats before the first level-up and the stats after the last one.
      const preLevel = character.level - levelsGained;
      // SPEC §5.2 / §6.3: the ratio is taken between two maxHp/maxSp values, so both
      // sides must be derived from the SAME character+equipment state the battles were
      // simulated against. `buildCharacterSnapshot()` (battle.service.ts:144-160) folds
      // `statBonus` into the attributes and passes the real `def`/`mdefPercent`/weapon
      // ATK; passing `{}` here instead scaled an equipped character by the wrong ratio.
      const equipmentStats = await this.equipmentService.calculateEquipmentStats(character.id);
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
      const before = BattleEngine.calculateDerivedStats(preLevel, attributes, equipment);
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
    const equipmentChanged = await this.equipmentService.applyPendingEquipmentChanges(character.id);
    await this.characterRepo.save(character);

    // --- drops (SPEC §11.5)
    if (Array.isArray(battle.drops) && battle.drops.length > 0) {
      for (const drop of battle.drops) {
        try {
          await this.inventoryService.addItem(
            character.id,
            drop.itemId,
            drop.quantity ?? 1,
            'inventory',
            drop.instanceData,
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

    // Inventory drops are part of the same authoritative post-resolution snapshot.
    // Touch Character after all inventory mutations so its updatedAt can serve as the
    // revision for the complete Character + Inventory state.
    await this.characterRepo.save(character);

    const futureQueue = await this.getBattleQueue(character.id, 100);
    const nextBattleStart = futureQueue[0]?.startAt
      ? futureQueue[0].startAt.getTime()
      : Date.now();
    const autoFed = await this.tryAutoFeed(character, nextBattleStart);
    if (autoFed) {
      await this.discardUnresolvedBattles(character.id);
      await this.characterRepo.save(character);
      if (character.currentMapId && character.status === 'grinding') {
        await this.queueBattles(character.id, this.QUEUE_DEPTH_TARGET, false);
      }
    }

    // --- the kill actually happened: bump the counter (SPEC §11.2)
    const killCounter = await this.incrementKillCounter(character.id, battle.mapId, battle.monsterId);

    // `resolved` was already claimed atomically at the top of this method.
    await this.battleQueueRepo.save(battle);

    const returningToTown = character.returnToTownAfterBattle;
    const foodExpiresAt = character.activeFoodBuff?.expiresAt
      ? new Date(character.activeFoodBuff.expiresAt).getTime()
      : 0;
    const hungryAfterBattle = !foodExpiresAt || foodExpiresAt <= Date.now();
    if (returningToTown || hungryAfterBattle) {
      // Town return and food exhaustion both end the current grind cleanly.
      // The current battle is already resolved, so no unresolved encounter may remain.
      character.returnToTownAfterBattle = false;
      character.currentMapId = null as any;
      character.status = 'town';
      character.lastSeenAt = new Date();
      await this.characterRepo.save(character);
    }

    // SPEC §3.4 / §6.3: a level-up changes derived stats (maxHp/maxSp/atk...),
    // which invalidates every remaining entry in the chain — they were simulated
    // against the OLD stats. Discard them and rebuild the queue from scratch with
    // the new character state. Must run AFTER the kill counter is bumped so the
    // rebuilt chain does not re-encounter the same monster index it just killed.
    if (character.status === 'town') {
      await this.discardUnresolvedBattles(character.id);
    } else if (leveledUp || equipmentChanged) {
      await this.discardUnresolvedBattles(character.id);
      await this.queueBattles(character.id, this.QUEUE_DEPTH_TARGET, false);
    } else if (character.currentMapId && character.status === 'grinding') {
      await this.queueBattles(character.id, this.QUEUE_DEPTH_TARGET, false);
    }
    if (leveledUp) {
      await this.safePublishCharacterLeveledUp(character.id, {
        newLevel: character.level,
        unspentAttributePoints: character.unspentAttributePoints,
      });
    }
    // battle:resolved and the subsequent queueUpdated must expose the same final
    // Character + Inventory + Diet revision; neither event is allowed to carry a
    // pre-Auto-Feed snapshot.
    await this.safePublishBattleResolved(character.id, battle);
    const liveQueue = await this.getBattleQueue(character.id, 5);
    const authoritativeSnapshot = await this.buildAuthoritativeBattleSnapshot(character.id);
    await this.safePublishQueueUpdated(character.id, liveQueue, authoritativeSnapshot);

    this.logger.log(
      `Resolved battle ${battle.id} char=${character.id} ${battle.monsterId} ` +
        `xp+=${battle.xpGain} gold+=${battle.goldGain} drops=${JSON.stringify(battle.drops)} ` +
        `level=${character.level} xp=${character.xp} gold=${character.gold} ` +
        `mapKillCount=${killCounter.mapKillCount} perMonster=${battle.monsterId}:${killCounter.perMonsterCount}`,
    );
  }

  private async tryAutoFeed(character: Character, boundaryAt: number): Promise<boolean> {
    if (!character.autoFeed || character.returnToTownAfterBattle) return false;

    const activeExpiresAt = character.activeFoodBuff?.expiresAt
      ? Date.parse(character.activeFoodBuff.expiresAt)
      : 0;
    if (activeExpiresAt > boundaryAt) return false;

    const now = Date.now();
    const configuredIds = [
      ...(Array.isArray(character.diet) ? character.diet.map((entry) => entry.itemId) : []),
      ...Object.keys(character.dietLevels ?? {}),
    ];
    const candidates = [...new Set(configuredIds)];

    for (const itemId of candidates) {
      const definition = this.dataService.getItemById(itemId);
      if (definition?.type !== 'consumable' || definition.effect?.type !== 'food_buff') continue;

      const lastDigestUntil = character.dietLevels?.[itemId]?.lastDigestUntil
        ? Date.parse(character.dietLevels[itemId].lastDigestUntil)
        : 0;
      if (lastDigestUntil > now) continue;

      if ((await this.inventoryService.getItemCount(character.id, itemId)) <= 0) continue;

      const updated = await this.inventoryService.consumeFood(character.id, itemId);
      Object.assign(character, updated);
      return true;
    }

    return false;
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

  private async discardUnresolvedBattles(characterId: string): Promise<void> {
    const remaining = await this.battleQueueRepo.find({ where: { characterId, resolved: false } });
    if (!remaining.length) return;
    for (const entry of remaining) {
      await this.bullQueue.getJob(entry.id).then((job) => job?.remove()).catch(() => undefined);
    }
    await this.battleQueueRepo.delete({ id: In(remaining.map((entry) => entry.id)) });
  }

  /**
   * Handle character death (SPEC §7.6)
   */
  private async handleCharacterDeath(character: Character, battle: BattleQueueEntry): Promise<any> {
    // Consumed items are still gone, and the character is routed to town.
    character.status = 'town';
    // null, not undefined: TypeORM silently skips undefined columns on save,
    // which would leave the character on a map it is no longer standing on.
    character.currentMapId = null as any;
    character.lastSeenAt = new Date();
    character.hpCurrent = 1;

    // SPEC §6.4 XP loss: 5% of the next level requirement
    const xpLoss = Math.floor(this.dataService.getXpToNextLevel(character.level) * 0.05);
    character.xp = Math.max(0, Number(character.xp) - xpLoss);

    // SPEC §7.7: lastDeathLog is overwritten with this battle's full log
    character.lastDeathLog = {
      monsterId: battle.monsterId,
      mapId: battle.mapId,
      timestamp: new Date().toISOString(),
      log: battle.log,
    };

    await this.characterRepo.save(character);

    // Everything still queued assumed the character survived
    const doomed = await this.battleQueueRepo.find({
      where: { characterId: character.id, resolved: false },
    });
    if (doomed.length) {
      await this.battleQueueRepo.delete({ id: In(doomed.map((b) => b.id)) });
      for (const entry of doomed) {
        await this.bullQueue
          .getJob(entry.id)
          .then((job) => job?.remove())
          .catch(() => undefined);
      }
    }

    await this.resetEncounterSequence(character.id, battle.mapId, 'death');

    this.logger.log(
      `Character ${character.id} died to ${battle.monsterId}; ` +
        `${doomed.length} queued battle(s) discarded`,
    );

    return character.lastDeathLog;
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
    await this.battleQueueRepo.delete({ id: In(future.map((entry) => entry.id)) });
    for (const entry of future) {
      await this.bullQueue.getJob(entry.id).then((job) => job?.remove()).catch(() => undefined);
    }
  }

  async cancelPendingBattles(characterId: string): Promise<void> {
    const pending = await this.battleQueueRepo.find({
      where: { characterId, resolved: false },
    });
    if (!pending.length) return;

    await this.battleQueueRepo.delete({ id: In(pending.map((entry) => entry.id)) });
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
    try {
      await this.gatewayService.publishBattleResolved(characterId, payload);
    } catch (error) {
      this.logger.warn(`battle:resolved publication failed for ${characterId}: ${error instanceof Error ? error.message : String(error)}`);
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

  private async getOrCreateKillCounter(characterId: string, mapId: string): Promise<MapKillCounter> {
    let counter = await this.mapKillCounterRepo.findOne({ where: { characterId, mapId } });
    if (!counter) {
      counter = await this.mapKillCounterRepo.save(
        this.mapKillCounterRepo.create({
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
  ): Promise<{ mapKillCount: number; perMonsterCount: number; epoch: number }> {
    const counter = await this.getOrCreateKillCounter(characterId, mapId);

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

    await this.mapKillCounterRepo.save(counter);

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
  async resetEncounterSequence(characterId: string, mapId: string, reason: string): Promise<void> {
    const counter = await this.getOrCreateKillCounter(characterId, mapId);

    counter.epoch = Number(counter.epoch ?? 0) + 1;
    counter.mapKillCount = 0;
    counter.perMonsterKillCount = {};

    await this.mapKillCounterRepo.save(counter);

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
