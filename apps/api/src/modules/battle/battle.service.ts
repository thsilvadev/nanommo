import { forwardRef, Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { BattleQueueEntry, Character, MapKillCounter, GambitPage, InventoryItem, WeaponProficiency } from '@/database/entities';
import {
  BattleEngine,
  GambitEvaluator,
  Mulberry32,
  mulberry32Seed,
  rngForIndex,
  resolveRewards,
  calculateMasteryXpAwards,
  masteryLevelForXp,
  resolveRankScaledSkill,
  sumAttributeBonuses,
  applyAttributeBonuses,
  masteryPassiveAttributeBonuses,
  type CombatantSnapshot,
  type AttributeBonuses,
} from '@nanommo/shared';
import { effectiveFoodStatValue, TOWN_MAP_ID } from '@nanommo/shared';
import { DataService } from '../data/data.service';
import { CharacterService } from '../character/character.service';
import { InventoryService, buildDietStateAfterFoodConsumption, normalizeDietState } from '../inventory/inventory.service';
import { EquipmentService } from '../equipment/equipment.service';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';
import { GatewayService, BattleResolvedPayload, CharacterLeveledUpPayload, CharacterDiedPayload } from '../gateway/gateway.service';
import { MapPresenceService } from '../presence/map-presence.service';
import { getMasteryXpPolicy } from '../../config/mastery-xp-policy';
export { getMasteryXpPolicy } from '../../config/mastery-xp-policy';

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
    @InjectRepository(WeaponProficiency)
    private readonly weaponProficiencyRepo: Repository<WeaponProficiency>,
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
   * A skill is usable only when it has an allocated rank and its category
   * equipment is present in this immutable combat snapshot.
   */
  private async buildSkillAvailability(characterId: string): Promise<{
    skills: Record<string, any>;
    skillDefs: Record<string, any>;
    weaponTypes: string[];
  }> {
    const equipped = await this.equipmentService.getEquipment(characterId);
    const weaponTypes: string[] = [];
    for (const slot of ['mainHand', 'offHand']) {
      const row = equipped.find((e) => e.slot === slot);
      if (!row) continue;
      const def = this.dataService.getItemById(row.itemId);
      if (def?.weaponType && !weaponTypes.includes(def.weaponType)) weaponTypes.push(def.weaponType);
    }

    const masteryRows = await this.equipmentService.getWeaponMasteryRows(characterId);
    const masteryByType = new Map(masteryRows.map((row) => [row.weaponType, row]));
    const skills: Record<string, any> = {};
    const skillDefs: Record<string, any> = {};

    for (const weaponType of weaponTypes) {
      const ranks = masteryByType.get(weaponType)?.skillRanks ?? {};
      for (const skill of this.dataService.getSkillsForWeapon(weaponType)) {
        const rank = Math.max(0, Math.floor(Number(ranks[skill.id] ?? 0)));
        if (rank < 1) continue;
        const learnedDefinition = { ...skill, masteryRank: rank };
        skillDefs[skill.id] = learnedDefinition;
        // Passive nodes are snapshot data, never selectable Gambit actions.
        if (skill.kind === 'active') skills[skill.id] = learnedDefinition;
      }
    }

    // Resolve rank-scaled costs/cooldowns once at snapshot construction. Stored
    // Essence only exists in this immutable skill set when a learned Rune passive
    // is actually equipped, and its discount is applied before Gambit legality.
    const storedEssenceRank = Math.max(0, Number(skillDefs.stored_essence?.masteryRank ?? 0));
    for (const definition of Object.values(skillDefs) as any[]) {
      if (definition.kind !== 'active') continue;
      Object.assign(definition, resolveRankScaledSkill(definition, definition.masteryRank, storedEssenceRank));
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
    masteryEquipment: Array<{ slot: 'mainHand' | 'offHand'; category: string; twoHanded: boolean }>;
  }> {
    const equipmentStats = await this.equipmentService.calculateEquipmentStats(characterId);
    const { skills, skillDefs, weaponTypes } = await this.buildSkillAvailability(characterId);
    const rows = await this.equipmentService.getEquipment(characterId);
    const masteryEquipment = rows.flatMap((row) => {
      if (row.slot !== 'mainHand' && row.slot !== 'offHand') return [];
      const item = this.dataService.getItemById(row.itemId);
      return item?.weaponType ? [{ slot: row.slot as 'mainHand' | 'offHand', category: String(item.weaponType), twoHanded: item.twoHanded === true }] : [];
    });
    return { equipmentStats, skills, skillDefs, weaponTypes, masteryEquipment };
  }

  /** Return every food whose own digestion/buff boundary is still in the future. */
  private getActiveDietFoodBuffs(character: Character, atTime: number): Array<{ itemId: string; hpRegenPerTenTicks: number; spRegenPerTenTicks: number; expiresAt: string }> {
    const diet = Array.isArray((character as any).diet) ? (character as any).diet : [];
    const active = diet.flatMap((entry: any) => {
      const expiresAt = String(entry?.digestUntil ?? '');
      const expiry = Date.parse(expiresAt);
      if (!entry?.itemId || !Number.isFinite(expiry) || expiry <= atTime) return [];
      const definition = this.dataService.getItemById(String(entry.itemId));
      if (definition?.effect?.type !== 'food_buff') return [];
      const level = Math.max(0, Math.min(3, Number(entry.dietLevel ?? 0)));
      return [{
        itemId: String(entry.itemId),
        hpRegenPerTenTicks: effectiveFoodStatValue(definition.effect.hpRegenPerTenTicks, level),
        spRegenPerTenTicks: effectiveFoodStatValue(definition.effect.spRegenPerTenTicks, level),
        expiresAt,
      }];
    });
    if (active.length) return active;

    // Backward compatibility for older rows where activeFoodBuff exists but Diet
    // was not persisted/populated. Do not add it a second time when Diet has rows.
    const legacy = (character as any).activeFoodBuff;
    const legacyExpiry = legacy?.expiresAt ? Date.parse(String(legacy.expiresAt)) : 0;
    return legacy && legacyExpiry > atTime ? [{
      itemId: String(legacy.itemId ?? ''),
      hpRegenPerTenTicks: Number(legacy.hpRegenPerTenTicks ?? 0),
      spRegenPerTenTicks: Number(legacy.spRegenPerTenTicks ?? 0),
      expiresAt: new Date(legacyExpiry).toISOString(),
    }] : [];
  }

  private latestFoodExpiry(foods: Array<{ expiresAt: string | Date }>): number {
    return Math.max(0, ...foods.map((food) => Date.parse(String(food.expiresAt))).filter(Number.isFinite));
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
    foodOverride: any = undefined,
    loadout?: Awaited<ReturnType<BattleService['loadCombatantLoadout']>>,
    foodDigestOverride?: Record<string, number>,
  ): Promise<CombatantSnapshot> {
    const { equipmentStats, skills, skillDefs, weaponTypes, masteryEquipment } =
      loadout ?? (await this.loadCombatantLoadout(character.id));

    // Canonical combat attributes (SPEC §5.2): base attributes plus
    // every modifier source — equipment stat bonuses and learned
    // mastery passives — aggregated into one total bonus.
    const attributeBonuses: AttributeBonuses = sumAttributeBonuses(
      equipmentStats.statBonus,
      masteryPassiveAttributeBonuses(skillDefs),
    );
    const derived = BattleEngine.calculateDerivedStats(
      character.level,
      applyAttributeBonuses(character, attributeBonuses),
      {
        def: equipmentStats.def,
        mdefPercent: equipmentStats.mdefPercent,
        weaponFixedAtk: equipmentStats.weaponFixedAtk,
        weaponFixedMatk: equipmentStats.weaponFixedMatk,
        accuracyModifier: equipmentStats.accuracyModifier,
        accuracyMultiplier: equipmentStats.accuracyMultiplier,
      },
    );

    const foodCandidates: any[] = foodOverride === undefined
      ? this.getActiveDietFoodBuffs(character, atTime)
      : Array.isArray(foodOverride) ? foodOverride : foodOverride ? [foodOverride] : [];
    const activeFoodBuffs = foodCandidates
      .map((food: any) => ({ ...food, expiryAtMs: food?.expiresAt ? Date.parse(String(food.expiresAt)) : 0 }))
      .filter((food: any) => Number.isFinite(food.expiryAtMs) && food.expiryAtMs > atTime)
      .sort((a: any, b: any) => a.expiryAtMs - b.expiryAtMs);
    const latestFood = activeFoodBuffs[activeFoodBuffs.length - 1];
    const foodBuffStates = activeFoodBuffs.map((food: any) => ({
      itemId: String(food.itemId),
      hpRegenPerTenTicks: Number(food.hpRegenPerTenTicks ?? 0),
      spRegenPerTenTicks: Number(food.spRegenPerTenTicks ?? 0),
      remainingTicks: Math.max(0, Math.ceil((food.expiryAtMs - atTime) / MS_PER_TICK)),
    }));
    const foodTicks = Math.max(0, ...foodBuffStates.map((food) => food.remainingTicks));
    return {
      characterName: character.name,
      level: character.level,
      hp: Math.max(1, Math.min(hp, derived.maxHp)),
      sp: Math.max(0, Math.min(sp, derived.maxSp)),
      ...derived,
      // Keep base regen separate from the active food buff: BattleEngine adds
      // the food fields below while the buff is active, and stops when it expires.
      hpRegenPerTenTicks: derived.hpRegenPerTenTicks,
      spRegenPerTenTicks: derived.spRegenPerTenTicks,
      foodBuffTicksRemaining: foodTicks,
      foodBuffItemId: latestFood ? String(latestFood.itemId) : undefined,
      foodBuffHpRegenPerTenTicks: latestFood ? Number(latestFood.hpRegenPerTenTicks ?? 0) : undefined,
      foodBuffSpRegenPerTenTicks: latestFood ? Number(latestFood.spRegenPerTenTicks ?? 0) : undefined,
      foodBuffs: foodBuffStates,
      dietLevelByFood: Object.fromEntries(Object.entries(character.dietLevels ?? {}).map(([itemId, value]) => [itemId, Math.max(0, Math.min(3, Number(value.level ?? 0)))])),
      foodDigestRemainingTicksByItem: foodDigestOverride ?? Object.fromEntries(
        Object.entries(character.dietLevels ?? {}).map(([itemId, value]) => {
          const until = Date.parse(value.lastDigestUntil);
          return [itemId, until > atTime ? Math.ceil((until - atTime) / MS_PER_TICK) : 0];
        }),
      ),
      skills,
      skillDefs,
      masteryEquipment,
      statusEffects: character.statusEffects ?? [],
      equippedWeaponTypes: weaponTypes,
      luk: Number((character as any).luk ?? 5) + Number(attributeBonuses.LUK ?? 0),
    } as CombatantSnapshot;
  }

  /**
   * Legacy weapon timing metadata from skill_trees.json. The current character
   * basic-Attack interval is governed by the universal Attack Speed scale in §7.2.
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
    if (character.status !== 'grinding' || !character.currentMapId || this.dataService.getMapById(character.currentMapId)?.type !== 'grind') {
      const existing = await this.getBattleQueue(characterId, 100);
      if (existing.length === 0 && publishQueueEvent) await this.safePublishQueueUpdated(characterId, []);
      return existing.filter(entry => entry.mapId === character.currentMapId);
    }
    if (!character.currentMapId) {
      throw new BadRequestException('Character is not on a map');
    }

    const currentQueue = await this.getBattleQueue(characterId, 100);
    if (currentQueue.length >= targetDepth) {
      return currentQueue; // Already at target depth
    }

    let projectedFoodBuffs = this.getActiveDietFoodBuffs(character, Date.now());
    let projectedFoodExpiresAt = this.latestFoodExpiry(projectedFoodBuffs);
    const projectedDietLevelByFood: Record<string, number> = Object.fromEntries(
      Object.entries(character.dietLevels ?? {}).map(([itemId, value]: [string, any]) => [itemId, Math.max(0, Math.min(3, Number(value.level ?? 0))) ]),
    );
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
      for (const pending of entries.slice().sort((a, b) => a.sequenceIndex - b.sequenceIndex)) {
        for (const event of Array.isArray(pending.log?.events) ? pending.log.events : []) {
          if (event?.action !== 'use_item') continue;
          const def = this.dataService.getItemById(event.itemId);
          if (def?.effect?.type !== 'food_buff') continue;
          const usedAt = new Date(pending.startAt).getTime() + Number(event.tick ?? 0) * MS_PER_TICK;
          const digestUntil = Number(projectedFoodDigestUntil[String(event.itemId)] ?? 0);
          if (digestUntil > usedAt) continue;
          const itemId = String(event.itemId);
          const hadLevel = Object.prototype.hasOwnProperty.call(projectedDietLevelByFood, itemId);
          const currentLevel = Math.max(0, Math.min(3, Number(projectedDietLevelByFood[itemId] ?? 0)));
          const nextLevel = hadLevel ? Math.min(3, currentLevel + 1) : 0;
          const expiry = usedAt + Number(def.effect?.durationSeconds ?? 0) * MS_PER_TICK;
          projectedFoodBuffs = [
            ...projectedFoodBuffs.filter((food) => food.itemId !== itemId && Date.parse(String(food.expiresAt)) > usedAt),
            { itemId, hpRegenPerTenTicks: effectiveFoodStatValue(def.effect?.hpRegenPerTenTicks, nextLevel), spRegenPerTenTicks: effectiveFoodStatValue(def.effect?.spRegenPerTenTicks, nextLevel), expiresAt: new Date(expiry).toISOString() },
          ];
          projectedFoodDigestUntil[itemId] = expiry;
          projectedDietLevelByFood[itemId] = nextLevel;
        }
        const pendingEnd = new Date(pending.endAt).getTime();
        projectedFoodBuffs = projectedFoodBuffs.filter((food) => Date.parse(String(food.expiresAt)) > pendingEnd);
      }
    };
    projectFoodFromQueue(currentQueue);
    projectedFoodExpiresAt = this.latestFoodExpiry(projectedFoodBuffs);
    if (!projectedFoodExpiresAt || projectedFoodExpiresAt <= Date.now()) {
      const now = Date.now();
      const activeBattle = currentQueue.find(
        (entry) => Date.parse(entry.startAt.toString()) <= now &&
          now < Date.parse(entry.endAt.toString()),
      );
      if (!activeBattle) {
        // Queue projection answers whether another future encounter can be
        // added; it is not the Character's current food state. A projected buff
        // can expire during a future queued battle while the persisted buff is
        // still valid now. Never turn that prediction into an early Town exit.
        const actualFoodExpiresAt = this.latestFoodExpiry(this.getActiveDietFoodBuffs(character, now));
        if (actualFoodExpiresAt > now) return currentQueue;

        // If queue generation itself reaches the real exhaustion boundary before
        // any battle is active, give Auto Feed the same authoritative chance the
        // resolver gives it. A successful consume persists the food through the
        // existing InventoryService path; throw away stale projections and rebuild.
        const autoFed = await this.tryAutoFeed(character, now);
        if (autoFed) {
          await this.characterRepo.save(character);
          await this.discardUnresolvedBattles(characterId);
          return this.queueBattles(characterId, targetDepth, publishQueueEvent);
        }

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
    const statusEffectDefs = Object.fromEntries(
      this.dataService.getStatusEffects().map((status: any) => [status.id, status]),
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

    let blockedByFoodExpiryBeforeNextStart = false;
    for (let i = 0; i < battlesToAdd; i++) {
      const sequenceIndex = maxSequenceIndex + 1 + i;
      const killIndex = projectedMapKillCount;

      // Every encounter has its own search phase, including the first one.
      const searchStartTime = new Date(nextStartTime);
      const encounterStartAt = nextStartTime.getTime() + encounterSearchMs;
      // Eligibility is evaluated at the actual battle start, after encounter
      // search, not at the beginning of the search gap.
      if (!projectedFoodExpiresAt || projectedFoodExpiresAt <= encounterStartAt) {
        blockedByFoodExpiryBeforeNextStart = true;
        break;
      }
      nextStartTime = new Date(encounterStartAt);

      // SPEC §11.2: nextMonsterId(mapId, mapKillCount) = weightedPick(rngForIndex(mapKillCount))
      const monster = rngForIndex(encounterSeed, killIndex).weightedPick(monsters);
      const monsterId = monster.id;

      const snapshot = await this.buildCharacterSnapshot(
        character,
        chainHp,
        chainSp,
        nextStartTime.getTime(),
        projectedFoodBuffs,
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
        let hpGain = 0;
        let spGain = 0;
        const firstBoundary = Math.floor(fromTick / 10) + 1;
        for (let period = 0; period < elapsedRegenPeriods; period++) {
          const boundaryTick = (firstBoundary + period) * 10;
          const boundaryAt = regenAnchor + boundaryTick * MS_PER_TICK;
          hpGain += hpPerPeriod;
          spGain += spPerPeriod;
          for (const food of projectedFoodBuffs) {
            if (Date.parse(String(food.expiresAt)) > boundaryAt) {
              hpGain += Number(food.hpRegenPerTenTicks ?? 0);
              spGain += Number(food.spRegenPerTenTicks ?? 0);
            }
          }
        }
        chainHp = Math.min(snapshot.maxHp, chainHp + hpGain);
        chainSp = Math.min(snapshot.maxSp, chainSp + spGain);
        snapshot.hp = chainHp;
        snapshot.sp = chainSp;
      }
      const seed = `${characterId}:${mapId}:${monsterId}:${sequenceIndex}:${counter.epoch}:${killIndex}`;

      // Freeze the entry combat style into this immutable battle snapshot. Bow basic
      // attacks and any enabled, available ranged Foe skill/item make the player ranged.
      const gambitLines = Array.isArray((gambitPage as any)?.lines) ? (gambitPage as any).lines : [];
      const normalizedWeaponTypes = loadout.weaponTypes.map((type) => String(type).toLowerCase());
      const hasBow = normalizedWeaponTypes.includes('bow');
      const hasRangedBasic = hasBow || normalizedWeaponTypes.some((type) => ['staff', 'rod', 'rod'].includes(type));
      const hasRangedGambitAction = gambitLines.some((line: any) => {
        if (line?.enabled === false || line?.disabled === true) return false;
        const action = line?.action ?? {};
        const id = action.id ?? action.type;
        const target = action.target ?? action.targetType ?? action.params?.target;
        if (target && !['foe', 'enemy', 'monster'].includes(String(target).toLowerCase())) return false;
        if (id === 'attack') return hasRangedBasic;
        if (id === 'use_skill') {
          const skillId = action.skillId ?? action.params?.skillId;
          const def = loadout.skillDefs[skillId];
          return !!loadout.skills[skillId] && !!def && (def.ranged === true || Number(def.maxRange ?? 0) > 0);
        }
        if (id === 'use_item') {
          const itemId = action.itemId ?? action.params?.itemId;
          const def = itemDefinitions[itemId];
          return !!itemId && (workingInventory[itemId] ?? 0) > 0 && !!def && (def.ranged === true || Number(def.maxRange ?? 0) > 0);
        }
        return false;
      });
      snapshot.combatStyle = hasRangedGambitAction ? 'ranged' : 'melee';
      snapshot.basicAttackDamageType = hasBow ? 'ranged' : normalizedWeaponTypes.some((type) => ['staff', 'rod', 'rod'].includes(type)) ? 'magic' : 'melee';
      snapshot.basicAttackRange = hasRangedBasic ? 6 : 0;

      // ---- Gambit is evaluated INSIDE the engine, per gauge fire (SPEC §7.3)
      const regenTickOffset = Math.max(0, Math.floor((nextStartTime.getTime() - regenAnchor) / MS_PER_TICK));
      const simulation = BattleEngine.simulateBattle(snapshot, monster, gambitPage, seed, {
        inventory: workingInventory,
        itemDefinitions,
        monsterSkillDefs,
        statusEffectDefs,
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
      projectedFoodBuffs = (simulation.foodBuffsAfter ?? (simulation.foodBuffAfter ? [simulation.foodBuffAfter] : []))
        .filter((food: any) => Number(food.remainingTicks ?? 0) > 0)
        .map((food: any) => ({
          itemId: String(food.itemId),
          hpRegenPerTenTicks: Number(food.hpRegenPerTenTicks ?? 0),
          spRegenPerTenTicks: Number(food.spRegenPerTenTicks ?? 0),
          expiresAt: new Date(battleEndTime + Number(food.remainingTicks) * MS_PER_TICK).toISOString(),
        }));
      projectedFoodExpiresAt = this.latestFoodExpiry(projectedFoodBuffs);

      // ---- Rewards: xp from xpReward, gold rolled from goldReward.min/max,
      //      drops from monsters.json chances (SPEC §11.5) - only on a win.
      const rewards = resolveRewards({
        monster,
        mapId,
        outcome: simulation.outcome,
        items: this.dataService.getItems(),
        killIndex: projectedPerMonster[monsterId] ?? 0,
        seed,
        characterLevel: Number(snapshot?.level ?? 1),
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
    if (liveQueue.length === 0 && blockedByFoodExpiryBeforeNextStart) {
      const actualFoodExpiresAt = this.latestFoodExpiry(this.getActiveDietFoodBuffs(character, Date.now()));
      if (actualFoodExpiresAt > 0) {
        // No battle can legally start before the current buff expires, so there
        // is no battle-resolution job to revisit the boundary. Reuse the
        // existing queue-battles worker to re-evaluate at the exact expiry (or
        // immediately if the expiry passed during queue generation).
        await this.bullQueue.add(
          'queue-battles',
          { characterId },
          {
            delay: Math.max(0, actualFoodExpiresAt - Date.now()),
            jobId: `food-expiry-check-${characterId}-${actualFoodExpiresAt}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          },
        );
      }
    }
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

      // Rewards are derived from the immutable precomputed snapshot and events,
      // then committed under this battle's existing exactly-once transaction.
      await this.applyMasteryRewards(battle, manager);

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
        const { skillDefs } = await this.buildSkillAvailability(character.id);
        // Same attribute state the battles were simulated against (SPEC §6.3):
        // base attributes plus the aggregated equipment and mastery-passive bonus.
        const attributeBonuses: AttributeBonuses = sumAttributeBonuses(
          equipmentStats.statBonus,
          masteryPassiveAttributeBonuses(skillDefs),
        );
        const attributes = applyAttributeBonuses(character, attributeBonuses);
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

      // A failed capacity check discards only that drop; independent loot and
      // the battle's remaining payout continue through this same transaction.
      await this.grantBattleDropsBestEffort(character, battle, manager);

      // Keep Character + Inventory under one final Character revision.
      await characterRepo.save(character);

      // Auto Feed uses the same EntityManager; a conflict/exception rolls back
      // the battle instead of leaving a partially applied payout. Eligibility
      // conflicts for still-digesting foods are handled as a normal skipped item.
      const autoFed = await this.tryAutoFeed(character, 0, manager);
      if (autoFed) await characterRepo.save(character);

      const killCounter = await this.incrementKillCounter(character.id, battle.mapId, battle.monsterId, manager);
      const previousMapId = character.currentMapId;
      const requestedDestinationId = character.pendingMapTransition?.destinationMapId;
      const requestedDestination = requestedDestinationId ? this.dataService.getMapById(requestedDestinationId) : null;
      const returningToTown = requestedDestination?.type === 'town';
      const foodExpiresAt = Math.max(
        character.activeFoodBuff?.expiresAt ? Date.parse(String(character.activeFoodBuff.expiresAt)) : 0,
        ...((Array.isArray((character as any).diet) ? (character as any).diet : []).map((entry: any) => Date.parse(String(entry.digestUntil ?? ''))).filter(Number.isFinite)),
      );
      const hungryAfterBattle = !foodExpiresAt || foodExpiresAt <= Date.now();
      const routedToTown = returningToTown || hungryAfterBattle;
      const pendingDestination = requestedDestination && (requestedDestination.type === 'town' || requestedDestination.type === 'grind') ? requestedDestination : null;
      if (pendingDestination && !hungryAfterBattle) {
        character.currentMapId = pendingDestination.id;
        character.status = pendingDestination.type === 'town' ? 'town' : 'grinding';
        character.pendingMapTransition = null;
        character.discoveredMapIds = Array.from(new Set([...(character.discoveredMapIds ?? [TOWN_MAP_ID]), pendingDestination.id]));
        character.lastSeenAt = new Date();
        await characterRepo.save(character);
      } else if (routedToTown) {
        character.pendingMapTransition = null;
        character.currentMapId = TOWN_MAP_ID;
        character.status = 'town';
        character.discoveredMapIds = Array.from(new Set([...(character.discoveredMapIds ?? [TOWN_MAP_ID]), TOWN_MAP_ID]));
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
      if (character.status === 'town' || autoFed || leveledUp || equipmentChanged || !!pendingDestination) {
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
        if (result.autoFed || result.leveledUp || result.equipmentChanged || result.character.pendingMapTransition == null && result.character.currentMapId !== result.battle.mapId) {
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

  private async grantBattleDropsBestEffort(character: Character, battle: BattleQueueEntry, manager: EntityManager): Promise<void> {
    if (!Array.isArray(battle.drops) || battle.drops.length === 0) return;
    for (const drop of battle.drops) {
      try {
        const quantity = Number(drop.quantity ?? 1);
        if (!(await this.inventoryService.canFitInventoryDrop(character.id, drop.itemId, quantity, manager))) {
          this.logger.warn(`Discarded battle drop character=${character.id} battle=${battle.id} item=${drop.itemId} quantity=${quantity}: Inventory capacity insufficient`);
          continue;
        }
        await this.inventoryService.addItem(character.id, drop.itemId, quantity, 'inventory', drop.instanceData, manager);
        const knownItems = Array.isArray(character.knownItemIds) ? character.knownItemIds : [];
        if (!knownItems.includes(drop.itemId)) character.knownItemIds = [...knownItems, drop.itemId];
      } catch (error) {
        this.logger.warn(`Failed to add drop ${drop.itemId} to ${character.id}: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
  }

  private async applyMasteryRewards(battle: BattleQueueEntry, manager: EntityManager): Promise<void> {
    const awards = calculateMasteryXpAwards(battle.log, getMasteryXpPolicy());
    const repo = manager.getRepository(WeaponProficiency);
    for (const [category, amount] of Object.entries(awards)) {
      if (amount <= 0) continue;
      const row = await repo.findOne({ where: { characterId: battle.characterId, weaponType: category }, lock: { mode: 'pessimistic_write' } });
      if (!row) continue;
      // Preserve cumulative XP. Level and available skill points are derived
      // from the single shared threshold table in the same battle transaction.
      row.xp = Number(row.xp) + amount;
      row.level = masteryLevelForXp(Number(row.xp));
      await repo.save(row);
    }
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
      const normalized = normalizeDietState(character.diet, character.dietLevels);
      character.diet = normalized.diet;
      character.dietLevels = normalized.dietLevels;
      const diet = normalized.diet;
      let consumedThisPass = false;

      for (const entry of diet) {
        const itemId = entry?.itemId;
        if (!itemId) continue;

        const definition = this.dataService.getItemById(itemId);
        if (definition?.type !== 'food' || definition.effect?.type !== 'food_buff') continue;

        const digestUntil = Date.parse(character.dietLevels?.[itemId]?.lastDigestUntil ?? entry?.digestUntil ?? '') || 0;
        if (digestUntil > now) continue;

        if ((await this.inventoryService.getItemCount(character.id, itemId, manager)) <= 0) continue;

        let updated: Character;
        try {
          updated = await this.inventoryService.consumeFood(character.id, itemId, manager);
        } catch (error) {
          // A concurrent inventory/digestion change is a normal lost
          // eligibility race, not a battle-resolution failure. Try another food.
          if (
            error instanceof BadRequestException &&
            ['Food is still digesting', 'Insufficient item quantity'].includes(error.message)
          ) continue;
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
    const normalizedDiet = normalizeDietState(character.diet, character.dietLevels);
    let diet = normalizedDiet.diet;
    let dietLevels = normalizedDiet.dietLevels;
    let lastFoodUse: { event: any; def: any; dietLevel: number } | null = null;

    for (const event of events) {
      if (event?.action !== 'use_item') continue;
      const def = this.dataService.getItemById(event.itemId);
      if (def?.effect?.type !== 'food_buff') continue;

      const usedAt = new Date(battle.startAt).getTime() + Number(event.tick ?? 0) * MS_PER_TICK;
      const digestUntil = new Date(usedAt + Number(def.effect?.durationSeconds ?? 0) * MS_PER_TICK).toISOString();
      const previousDigestUntil = Date.parse(dietLevels[event.itemId]?.lastDigestUntil ?? '') || 0;
      if (previousDigestUntil > usedAt) continue;

      const dietState = buildDietStateAfterFoodConsumption(
        diet,
        event.itemId,
        new Date(usedAt).toISOString(),
        digestUntil,
        dietLevels,
      );
      diet = dietState.diet;
      dietLevels = dietState.dietLevels;
      lastFoodUse = { event, def, dietLevel: dietState.nextLevel };
    }

    character.diet = diet;
    character.dietLevels = dietLevels;

    if (lastFoodUse) {
      const usedAt = new Date(battle.startAt).getTime() + Number(lastFoodUse.event.tick ?? 0) * MS_PER_TICK;
      character.activeFoodBuff = {
        itemId: lastFoodUse.def.id,
        hpRegenPerTenTicks: effectiveFoodStatValue(lastFoodUse.def.effect?.hpRegenPerTenTicks, lastFoodUse.dietLevel),
        spRegenPerTenTicks: effectiveFoodStatValue(lastFoodUse.def.effect?.spRegenPerTenTicks, lastFoodUse.dietLevel),
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
