import { forwardRef, Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
  normalizePersistentStatusEffects,
  statusEffectsForBattle,
  persistStatusEffectsAtCheckpoint,
} from '@nanommo/shared';
import { effectiveFoodStatValue, TOWN_MAP_ID, calculateWorldMoveSpeed, calculateTravelDurationSeconds, accrueTravelSegmentProgress, isInstantTownExitEdge, calculateFleeChancePercent, deterministicIntInclusive } from '@nanommo/shared';
import { DataService } from '../data/data.service';
import { CharacterService } from '../character/character.service';
import { InventoryService, buildDietStateAfterFoodConsumption, normalizeDietState } from '../inventory/inventory.service';
import { EquipmentService } from '../equipment/equipment.service';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';
import { IdleJournalService } from '../chat/chat-history.service';
import { GatewayService, BattleResolvedPayload, CharacterLeveledUpPayload, CharacterDiedPayload } from '../gateway/gateway.service';
import { MapPresenceService } from '../presence/map-presence.service';
import { getMasteryXpPolicy } from '../../config/mastery-xp-policy';
import { QuestService } from '../quests/quest.service';
export { getMasteryXpPolicy } from '../../config/mastery-xp-policy';

/** SPEC §11.2: epoch rollover once the counter reaches this many kills. */
const EPOCH_ROLLOVER_AT = 10_000;

/** SPEC §7.1: 1 tick = 1 second of in-game time. */
const MS_PER_TICK = 1000;


export function calculateEncounterSearchDelayMs(playersOnMap: number, seed = 'encounter-search'): number {
  const variable = new Mulberry32(seed).nextIntInclusive(2, 6);
  return (variable + Math.max(1, Math.floor(playersOnMap))) * 1000;
}

export function calculateNextEncounterBoundaryAt(
  battleEndAt: number,
  playersOnMap: number,
  seed = 'encounter-search',
): number {
  return battleEndAt + calculateEncounterSearchDelayMs(playersOnMap, seed);
}

/** Independent deterministic stream identity for pre-combat FLEE. Cycle zero preserves the original seed. */
export function buildPreCombatFleeSeed(characterId: string, mapId: string, epoch: number, killIndex: number, cycle = 0): string {
  const base = `${characterId}:${mapId}:${epoch}:${killIndex}:pre-combat-flee`;
  const normalizedCycle = Math.max(0, Math.floor(Number(cycle) || 0));
  return normalizedCycle === 0 ? base : `${base}:cycle:${normalizedCycle}`;
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
    private readonly idleJournal: IdleJournalService,
    private readonly questService: QuestService,
  ) {}

  /** Serialize operations that may change a character's encounter chain across API/worker replicas. */
  async withCharacterQueueLock<T>(characterId: string, operation: () => Promise<T>): Promise<T> {
    const lockKey = `battle:character-queue-lock:${characterId}`;
    const token = randomUUID();
    const ttlMs = 300_000;
    const deadline = Date.now() + 60_000;
    let acquired = false;
    while (Date.now() < deadline) {
      const result = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');
      if (result === 'OK') { acquired = true; break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!acquired) throw new Error(`Timed out acquiring encounter-chain lock for character ${characterId}`);

    // Renew well before expiry so a slow queue simulation cannot silently lose exclusivity.
    const renewScript = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end';
    const releaseScript = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
    const renewal = setInterval(() => {
      void this.redis.eval(renewScript, 1, lockKey, token, String(ttlMs)).then((renewed: any) => {
        if (Number(renewed) !== 1) this.logger.error(`Lost encounter-chain lock for character ${characterId}`);
      }).catch(error => this.logger.error(`Could not renew encounter-chain lock for ${characterId}: ${error instanceof Error ? error.message : String(error)}`));
    }, 60_000);
    (renewal as any).unref?.();
    try {
      return await operation();
    } finally {
      clearInterval(renewal);
      try { await this.redis.eval(releaseScript, 1, lockKey, token); }
      catch (error) { this.logger.error(`Could not release encounter-chain lock for ${characterId}; TTL will expire it`, error instanceof Error ? error.stack : String(error)); }
    }
  }

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

    await this.pauseTravelProgressForSpeedMutation(characterId);
    let result: T;
    try {
      result = await mutation();
    } finally {
      // Even if an equipment/stat mutation fails, clear the short-lived pause using
      // the currently persisted loadout so a route cannot remain frozen forever.
      await this.resumeTravelProgressAfterSpeedMutation(characterId);
    }
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

  /** Accrue a route's progress under the old movement rate before a loadout/stat mutation. */
  private async pauseTravelProgressForSpeedMutation(characterId: string): Promise<void> {
    await this.characterRepo.manager.transaction(async manager => {
      const repo = manager.getRepository(Character);
      const character = await repo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      const intent: any = character?.travelIntent;
      if (!character || !intent || intent.kind !== 'route' || intent.waitingForBattle === true || intent.speedMutationPending === true) return;
      const routeIds = Array.isArray(intent.routeMapIds) ? intent.routeMapIds.map(String) : [];
      const segmentIndex = Math.max(0, Math.floor(Number(intent.segmentIndex ?? 0)));
      if (routeIds[segmentIndex] !== character.currentMapId) return;
      const source = this.dataService.getMapById(character.currentMapId);
      const destination = this.dataService.getMapById(String(routeIds[segmentIndex + 1] ?? ''));
      if (!source || !destination || isInstantTownExitEdge(source, destination)) return;
      const unresolved = await manager.getRepository(BattleQueueEntry).find({ where: { characterId, resolved: false } });
      const now = Date.now();
      if (unresolved.some(entry => entry.startAt.getTime() <= now && entry.endAt.getTime() > now)) return;
      const equipment = (await this.equipmentService.getEquipment(characterId)).map((row: any) => ({ ...row, definition: this.dataService.getItemById(row.itemId) }));
      const oldSpeed = calculateWorldMoveSpeed(character, equipment, character.activeTempBuffs ?? [], character.statusEffects ?? []);
      const oldDuration = calculateTravelDurationSeconds(oldSpeed, Number(source.mapLength ?? (source.type === 'town' ? 0 : 25)));
      const rawLastAt = Date.parse(String(intent.lastAccruedAt ?? now));
      const lastAt = Number.isFinite(rawLastAt) ? rawLastAt : now;
      const previousDuration = Number(intent.lastDurationSeconds ?? oldDuration);
      const accrued = accrueTravelSegmentProgress(Number(intent.segmentProgress ?? 0), lastAt, now, previousDuration);
      // If the segment hits its boundary during a mutation, leave it one scheduler pulse short.
      intent.segmentProgress = Math.max(0, Math.min(0.999999, accrued.progress));
      intent.lastAccruedAt = new Date(now).toISOString();
      intent.lastDurationSeconds = Number.isFinite(oldDuration) ? oldDuration : null;
      intent.speedPaused = oldSpeed <= 0;
      intent.speedMutationPending = true;
      character.travelIntent = intent;
      await repo.save(character);
    });
  }

  /** Resume only after the speed-affecting mutation has committed, without losing accrued progress. */
  private async resumeTravelProgressAfterSpeedMutation(characterId: string): Promise<void> {
    await this.characterRepo.manager.transaction(async manager => {
      const repo = manager.getRepository(Character);
      const character = await repo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      const intent: any = character?.travelIntent;
      if (!character || !intent || intent.speedMutationPending !== true) return;
      const routeIds = Array.isArray(intent.routeMapIds) ? intent.routeMapIds.map(String) : [];
      const segmentIndex = Math.max(0, Math.floor(Number(intent.segmentIndex ?? 0)));
      const source = routeIds[segmentIndex] === character.currentMapId ? this.dataService.getMapById(character.currentMapId) : null;
      const destination = this.dataService.getMapById(String(routeIds[segmentIndex + 1] ?? ''));
      if (source && destination && !isInstantTownExitEdge(source, destination)) {
        const equipment = (await this.equipmentService.getEquipment(characterId)).map((row: any) => ({ ...row, definition: this.dataService.getItemById(row.itemId) }));
        const newSpeed = calculateWorldMoveSpeed(character, equipment, character.activeTempBuffs ?? [], character.statusEffects ?? []);
        const newDuration = calculateTravelDurationSeconds(newSpeed, Number(source.mapLength ?? (source.type === 'town' ? 0 : 25)));
        intent.lastDurationSeconds = Number.isFinite(newDuration) ? newDuration : null;
        intent.speedPaused = newSpeed <= 0;
      }
      intent.lastAccruedAt = new Date().toISOString();
      intent.speedMutationPending = false;
      character.travelIntent = intent;
      await repo.save(character);
    });
  }

  private async invalidateAndRebuildFutureCombatQueue(characterId: string): Promise<void> {
    await this.discardUnresolvedBattles(characterId);
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');

    const grinding =
      character.status === 'grinding' &&
      !!character.currentMapId &&
      !character.pendingMapTransition &&
      !character.travelIntent &&
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
    return rows.filter((battle) => !battle.cancelledAt && !battle.cancellationReason).map((battle) => {
      const monster = this.dataService.getMonsterById(battle.monsterId);
      const map = this.dataService.getMapById(battle.mapId);
      return { id:battle.id, outcome:battle.outcome, monsterId:battle.monsterId, monsterName:monster?.name ?? battle.monsterId,
        monsterLevel:Number(monster?.level ?? 0), mapId:battle.mapId, mapName:map?.name ?? battle.mapId,
        startAt:battle.startAt, endAt:battle.endAt, xpGain:Number(battle.xpGain ?? 0), goldGain:Number(battle.goldGain ?? 0) };
    });
  }

  async getResolvedBattleDetail(characterId: string, battleId: string): Promise<any | null> {
    const battle = await this.battleQueueRepo.findOne({ where: { id:battleId, characterId, resolved:true } });
    if (!battle || battle.cancelledAt || battle.cancellationReason) return null;
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
      // Manual off-battle consumables persist absolute cooldown deadlines. Convert
      // them at this immutable encounter's projected start so cooldown time keeps
      // elapsing during travel/search and then naturally counts down on combat ticks.
      cooldowns: Object.fromEntries(Object.entries(character.consumableCooldowns ?? {}).flatMap(([key, until]) => {
        const expiry = Date.parse(String(until));
        if (!Number.isFinite(expiry) || expiry <= atTime) return [];
        return [[key, Math.ceil((expiry - atTime) / MS_PER_TICK) + 1]];
      })),
      skills,
      skillDefs,
      masteryEquipment,
      statusEffects: statusEffectsForBattle(character.statusEffects ?? [], atTime),
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
    return this.withCharacterQueueLock(characterId, () => this.queueBattlesLocked(characterId, targetDepth, publishQueueEvent));
  }

  async queueTravelEncounter(characterId: string, monsterId: string): Promise<BattleQueueEntry | null> {
    // A travel encounter can begin while the frontend is extrapolating Traveling
    // from an older Character snapshot. Publish the queue and authoritative
    // Character/Inventory together so BattleStore sees the still-current source
    // map and can render the encounter instead of leaving only the travel gauge
    // visible until the battle has already resolved.
    const rows = await this.withCharacterQueueLock(characterId, () =>
      this.queueBattlesLocked(characterId, 1, false, {
        allowTravel: true,
        immediateEncounter: true,
        forcedMonsterId: monsterId,
      }),
    );
    const liveQueue = await this.getBattleQueue(characterId, 5);
    const snapshot = await this.buildAuthoritativeBattleSnapshot(characterId);
    await this.safePublishQueueUpdated(characterId, liveQueue, snapshot);
    return rows[0] ?? null;
  }

  private async queueBattlesLocked(
    characterId: string,
    targetDepth: number = this.QUEUE_DEPTH_TARGET,
    publishQueueEvent = true,
    options: { allowTravel?: boolean; immediateEncounter?: boolean; forcedMonsterId?: string } = {},
  ): Promise<BattleQueueEntry[]> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');

    if (character.pendingMapTransition || (character.travelIntent && !options.allowTravel)) return this.getBattleQueue(characterId, 100);
    if (character.status !== 'grinding' || !character.currentMapId || this.dataService.getMapById(character.currentMapId)?.type !== 'grind') {
      const existing = await this.getBattleQueue(characterId, 100);
      if (existing.length === 0 && publishQueueEvent) await this.safePublishQueueUpdated(characterId, []);
      return existing.filter(entry => entry.mapId === character.currentMapId);
    }
    if (!character.currentMapId) {
      throw new BadRequestException('Character is not on a map');
    }

    // Character rows written before absolute status expiry was introduced contain
    // battle-local expiresAtTick values. Normalize once, then invalidate only queued
    // future simulations that baked those untrustworthy statuses into their Gambits.
    const normalizedStatuses = normalizePersistentStatusEffects(character.statusEffects ?? [], Date.now());
    if (normalizedStatuses.changed) {
      character.statusEffects = normalizedStatuses.statusEffects;
      await this.characterRepo.save(character);

      const now = Date.now();
      const previouslyQueued = await this.getBattleQueue(characterId, 100);
      // Keep any already-started battle immutable, including an overdue row waiting
      // for its resolver. Only discard later, not-yet-started projections.
      const startedBattle = previouslyQueued.find(entry => entry.startAt.getTime() <= now);
      await this.discardUnresolvedBattles(characterId, startedBattle?.id);
      if (startedBattle) {
        const remaining = await this.getBattleQueue(characterId, 100);
        await this.safePublishQueueUpdated(characterId, remaining, await this.buildAuthoritativeBattleSnapshot(characterId));
        return remaining;
      }
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
        const autoFedItems = await this.tryAutoFeed(character, now);
        if (autoFedItems.length) {
          await this.characterRepo.save(character);
          for (let index = 0; index < autoFedItems.length; index++) {
            const itemId = autoFedItems[index];
            await this.idleJournal.ate(characterId, String(this.dataService.getItemById(itemId)?.name ?? itemId), `auto-feed-queue:${characterId}:${itemId}:${index}:${Date.now()}`);
          }
          await this.discardUnresolvedBattles(characterId);
          return this.queueBattlesLocked(characterId, targetDepth, publishQueueEvent);
        }

        const leavingMapId = character.currentMapId;
        const savedTown = this.dataService.getMapById(String(character.savedTownMapId ?? ''));
        const fallbackTownId = savedTown?.type === 'town' ? savedTown.id : TOWN_MAP_ID;
        character.currentMapId = fallbackTownId;
        character.status = 'town';
        character.travelIntent = null;
        character.gatheringCycle = { ...(character.gatheringCycle ?? {}), progress: 0, cycleIndex: Number(character.gatheringCycle?.cycleIndex ?? 0) + 1, varianceSeconds: null, lastUpdatedAt: new Date().toISOString() };
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
    const itemCatalog = this.dataService.getItems() ?? {};
    const itemDefinitions = Object.fromEntries([...(itemCatalog.consumables ?? []), ...(itemCatalog.equipment ?? []), ...(itemCatalog.monsterParts ?? []), ...(itemCatalog.materials ?? [])].map((item: any) => [item.id, item]));

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

    // DB-backed gameplay presence includes the character and disconnected residents.
    const mapPlayers = await this.mapPresenceService.countActiveGrinders(mapId);

    // One loadout read for the whole batch: equipment and proficiency cannot
    // change between the chained battles, so re-reading them per battle would
    // multiply identical queries without changing any simulated result.
    const loadout = await this.loadCombatantLoadout(characterId);
    const worldEquipmentRows = (await this.equipmentService.getEquipment(characterId)).map((row: any) => ({ ...row, definition: this.dataService.getItemById(row.itemId) }));
    const weaponBaseAttackTicks = this.getWeaponBaseAttackTicks(loadout.weaponTypes);

    let blockedByFoodExpiryBeforeNextStart = false;
    const persistedEncounterCycle: any = character.encounterCycle ?? {};
    let preCombatFleeCycle = Math.max(0, Math.floor(Number(persistedEncounterCycle.preCombatFleeCycle ?? 0)));
    let performedPreCombatCheck = false;
    let lastPreCombatFleeAt: string | null = null;
    const preCombatJournalEvents: Array<{ monsterId: string; monsterName: string; aggressive: boolean; key: string; occurredAt: string; activityKind: 'gathering' | 'travel' }> = [];
    for (let i = 0; i < battlesToAdd + 100; i++) {
      if (newBattles.length >= battlesToAdd) break;
      const sequenceIndex = maxSequenceIndex + 1 + newBattles.length;
      const killIndex = projectedMapKillCount;

      // Every encounter has its own independently seeded 2–6 second + population search interval.
      const searchStartTime = new Date(nextStartTime);
      const encounterSearchMs = options.immediateEncounter && i === 0 ? 0 : calculateEncounterSearchDelayMs(mapPlayers, `${characterId}:${mapId}:${counter.epoch}:${killIndex}:search`);
      const encounterStartAt = nextStartTime.getTime() + encounterSearchMs;
      // Eligibility is evaluated at the actual battle start, after encounter
      // search, not at the beginning of the search gap.
      if (!projectedFoodExpiresAt || projectedFoodExpiresAt <= encounterStartAt) {
        blockedByFoodExpiryBeforeNextStart = true;
        break;
      }
      nextStartTime = new Date(encounterStartAt);

      // Cycle zero preserves the established kill-counter stream. Later Gathering
      // batches vary selection identity too, so a full batch of passive/dodged picks
      // cannot repeat the exact same roster sequence forever.
      const monsterSelectionSeed = character.lastGrindStance === 'gathering' && preCombatFleeCycle > 0
        ? mulberry32Seed(`${characterId}:${mapId}:${counter.epoch}:pre-combat-cycle:${preCombatFleeCycle}`)
        : encounterSeed;
      const forcedMonster = options.forcedMonsterId ? monsters.find((entry: any) => entry.id === options.forcedMonsterId) : null;
      const monster = forcedMonster ?? rngForIndex(monsterSelectionSeed, killIndex).weightedPick(monsters);
      if (!forcedMonster && (character.lastGrindStance === 'gathering' || options.allowTravel === true)) {
        performedPreCombatCheck = true;
        const monsterDef = this.dataService.getMonsterById(monster.id);
        const equippedRows = await this.equipmentService.getEquipment(characterId);
        const gear = equippedRows.map((row: any) => ({ ...row, definition: this.dataService.getItemById(row.itemId) }));
        const worldSpeed = calculateWorldMoveSpeed(character, gear, character.activeTempBuffs ?? [], character.statusEffects ?? []);
        const attrBonuses = sumAttributeBonuses(loadout.equipmentStats.statBonus, masteryPassiveAttributeBonuses(loadout.skillDefs));
        const totalLuk = Number(character.luk ?? 5) + Number(attrBonuses.LUK ?? 0);
        const fleeChance = calculateFleeChancePercent(worldSpeed, Number(monsterDef?.moveSpd ?? 0), totalLuk);
        const fleeSeed = buildPreCombatFleeSeed(characterId, mapId, Number(counter.epoch), killIndex, preCombatFleeCycle);
        const aggressive = monsterDef?.isAggressive === true;
        const fleeRoll = aggressive ? new Mulberry32(fleeSeed).nextPercent() : null;
        const avoid = !aggressive || Number(fleeRoll) < fleeChance;
        if (aggressive) {
          this.logger.log(`Gathering pre-combat FLEE ${avoid ? 'succeeded' : 'failed'} character=${characterId} map=${mapId} monster=${monster.id} chance=${fleeChance}% roll=${fleeRoll}`);
          if (avoid) lastPreCombatFleeAt = new Date(encounterStartAt).toISOString();
        }
        if (avoid) {
          const journalName = String(monsterDef?.name ?? monster.id);
          preCombatJournalEvents.push({
            monsterId: String(monster.id), monsterName: journalName, aggressive,
            key: `precombat:${mapId}:${counter.epoch}:${killIndex}:${preCombatFleeCycle}`,
            occurredAt: new Date(encounterStartAt).toISOString(),
            activityKind: options.allowTravel === true ? 'travel' : 'gathering',
          });
          projectedMapKillCount += 1;
          nextStartTime = new Date(encounterStartAt);
          continue;
        }
      }
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
      const startingInventory = { ...workingInventory };
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
        globalItemDrops: this.dataService.getGlobalItemDrops()?.drops ?? [],
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
        startingSnapshot: {
          snapshot: JSON.parse(JSON.stringify(snapshot)),
          gambitPage: JSON.parse(JSON.stringify(gambitPage ?? null)),
          inventory: startingInventory,
          regenTickOffset,
          worldEquipment: worldEquipmentRows.map((row: any) => ({ slot: row.slot, itemId: row.itemId, definition: row.definition })),
          worldSpeedBuffs: JSON.parse(JSON.stringify(character.activeTempBuffs ?? [])),
          worldBaseMoveSpd: calculateWorldMoveSpeed(character, worldEquipmentRows, [], []),
          worldMoveSpd: calculateWorldMoveSpeed(character, worldEquipmentRows, character.activeTempBuffs ?? [], []),
        },
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

    if (lastPreCombatFleeAt) {
      character.encounterCycle = { ...(character.encounterCycle ?? {}), lastFleeSuccessAt: lastPreCombatFleeAt };
      await this.characterRepo.save(character);
    }

    const liveQueue = [...currentQueue, ...newBattles];
    // Only advance the separate pre-combat cycle when this batch added no battle
    // and the queue is actually empty. Ordinary batches that queued fights keep the
    // established mapKillCount-based roster stream and reward determinism unchanged.
    if (liveQueue.length === 0 && performedPreCombatCheck && !blockedByFoodExpiryBeforeNextStart) {
      character.encounterCycle = { ...(character.encounterCycle ?? {}), preCombatFleeCycle: preCombatFleeCycle + 1 };
      await this.characterRepo.save(character);
      // A whole projected batch can consist only of passive monsters or successful
      // pre-combat dodges. No resolve-battle job will fire to refill an empty queue,
      // so arm the next search boundary explicitly rather than waiting for a UI action.
      const nextSearchAt = nextStartTime.getTime();
      const retryDelayMs = Math.max(1_000, nextSearchAt - Date.now());
      await this.bullQueue.add(
        'queue-battles',
        { characterId },
        {
          delay: retryDelayMs,
          jobId: `precombat-continue-${characterId}-${mapId}-${preCombatFleeCycle + 1}-${Math.floor(nextSearchAt / 1000)}`,
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
      this.logger.debug(`Pre-combat encounter batch avoided all candidates for ${characterId}; next search recheck in ${retryDelayMs}ms`);
    }
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
    // The rolls may be projected while building a future queue, but user-facing messages
    // must arrive at the projected encounter boundary, not when this batch is generated.
    for (const event of preCombatJournalEvents) {
      const safeKey = event.key.replace(/[^a-zA-Z0-9_-]/g, '-');
      const dueAt = Date.parse(event.occurredAt);
      await this.bullQueue.add('idle-journal-precombat', {
        characterId, mapId, ...event,
      }, {
        jobId: `journal-precombat-${characterId}-${safeKey}`,
        delay: Math.max(0, dueAt - Date.now()),
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
    }
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

    const result = await this.withCharacterQueueLock(reference.characterId, () => this.battleQueueRepo.manager.transaction(async (manager) => {
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

      // A stale queue row must never restore HP/SP from an old map after the
      // Character has already settled elsewhere (especially in Town). Normal
      // travel waits for the active battle, so a map/status mismatch here means
      // this immutable simulation is no longer eligible to resolve.
      if (character.status !== 'grinding' || character.currentMapId !== battle.mapId) {
        await battleRepo.delete({ id: battle.id, resolved: false });
        return { alreadyResolved: true as const, staleLocation: true as const };
      }

      // Rewards are derived from the immutable precomputed snapshot and events,
      // then committed under this battle's existing exactly-once transaction.
      await this.applyMasteryRewards(battle, manager);

      // Simulated consumptions and all resulting inventory changes share this
      // transaction with the battle claim and Character state.
      const committedConsumptions: Array<{ itemId: string; quantity: number }> = [];
      for (const consumed of battle.itemsConsumed ?? []) {
        const have = await this.inventoryService.getItemCount(character.id, consumed.itemId, manager);
        const take = Math.min(have, consumed.quantity);
        if (take > 0) {
          await this.inventoryService.removeItem(character.id, consumed.itemId, take, manager);
          const existing = committedConsumptions.find(row => row.itemId === consumed.itemId);
          if (existing) existing.quantity += take;
          else committedConsumptions.push({ itemId: consumed.itemId, quantity: take });
        }
      }

      if (battle.outcome === 'loss') {
        this.applyResolvedFoodState(character, battle);
        // The immutable battle owns every 10-tick regen boundary through endAt.
        // Advance the off-battle checkpoint before the death path resets HP to 1.
        this.advanceResourceRegenCheckpoint(character, battle.endAt);
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
          committedConsumptions,
          autoFedItems: [],
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
      this.advanceResourceRegenCheckpoint(character, battle.endAt);
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
      const autoFedItems = await this.tryAutoFeed(character, 0, manager);
      const autoFed = autoFedItems.length > 0;
      if (autoFed) await characterRepo.save(character);

      await this.questService.recordBattleVictory(manager, character, battle);
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
      const movedToRequestedDestination = !!pendingDestination && pendingDestination.id !== previousMapId;
      if (pendingDestination && !hungryAfterBattle) {
        if (movedToRequestedDestination && this.dataService.getMapById(previousMapId)?.type === 'grind') {
          await this.resetEncounterSequence(character.id, previousMapId, 'left map', manager);
        }
        character.currentMapId = pendingDestination.id;
        character.status = pendingDestination.type === 'town' ? 'town' : 'grinding';
        character.pendingMapTransition = null;
        character.discoveredMapIds = Array.from(new Set([...(character.discoveredMapIds ?? [TOWN_MAP_ID]), pendingDestination.id]));
        character.lastSeenAt = new Date();
        await characterRepo.save(character);
      } else if (routedToTown) {
        const leavingMapId = character.currentMapId;
        if (leavingMapId && leavingMapId !== TOWN_MAP_ID && this.dataService.getMapById(leavingMapId)?.type === 'grind') {
          await this.resetEncounterSequence(character.id, leavingMapId, 'left map', manager);
        }
        character.pendingMapTransition = null;
        character.travelIntent = null;
        character.fleeNextAttemptAt = null;
        character.gatheringCycle = { ...(character.gatheringCycle ?? {}), progress: 0, cycleIndex: Number(character.gatheringCycle?.cycleIndex ?? 0) + 1, varianceSeconds: null, lastUpdatedAt: new Date().toISOString() };
        const savedTown = this.dataService.getMapById(String(character.savedTownMapId ?? ''));
        const fallbackTownId = savedTown?.type === 'town' ? savedTown.id : TOWN_MAP_ID;
        character.currentMapId = fallbackTownId;
        character.status = 'town';
        character.discoveredMapIds = Array.from(new Set([...(character.discoveredMapIds ?? [TOWN_MAP_ID]), fallbackTownId]));
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
        autoFedItems,
        committedConsumptions,
        discardedBattleIds,
        previousMapId: (routedToTown || movedToRequestedDestination) ? previousMapId : null,
      };
    }));

    if (result.alreadyResolved) {
      if ('staleLocation' in result && result.staleLocation) {
        this.logger.warn(`Discarded stale battle ${battleId}: character is no longer grinding on map ${reference.mapId ?? 'unknown'}`);
        try {
          await this.safePublishQueueUpdated(reference.characterId, await this.getBattleQueue(reference.characterId, 5), await this.buildAuthoritativeBattleSnapshot(reference.characterId));
        } catch (error) {
          this.logger.warn(`Could not publish queue after discarding stale battle ${battleId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        this.logger.log(`Battle ${battleId} already resolved - skipping`);
      }
      // Do not let a duplicate or stale delivery perform a second payout or
      // trigger the processor's normal queue top-up path.
      return false;
    }

    await this.publishCommittedBattleJournal(
      result.character.id,
      result.battle,
      result.committedConsumptions ?? [],
      result.autoFedItems ?? [],
    );

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

  /** Parallel FLEE roll: never advances the immutable battle's stored combat log/seed stream. */
  async attemptFlee(characterId: string, expectedGeneration?: number, expectedBattleId?: string): Promise<'failed' | 'cancelled' | 'not-active' | 'stale'> {
    this.logger.log(`FLEE attempt requested character=${characterId} battle=${expectedBattleId ?? 'active'} generation=${expectedGeneration ?? 'any'}`);
    const reference = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!reference) throw new NotFoundException('Character not found');
    const queue = await this.getBattleQueue(characterId, 100);
    const now = Date.now();
    const active = queue.find(entry => entry.startAt.getTime() <= now && entry.endAt.getTime() > now);
    if (!active || (expectedBattleId && active.id !== expectedBattleId)) return 'not-active';

    const result = await this.withCharacterQueueLock(characterId, () => this.battleQueueRepo.manager.transaction(async manager => {
      const characterRepo = manager.getRepository(Character);
      const battleRepo = manager.getRepository(BattleQueueEntry);
      const queueRepo = manager.getRepository(BattleQueueEntry);
      const character = await characterRepo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character || !character.travelIntent || character.travelIntent.kind === undefined || character.travelIntent.fleeRequested !== true) return { kind: 'stale' as const };
      const intent: any = character.travelIntent;
      if (expectedGeneration !== undefined && Number(intent.generation) !== expectedGeneration) return { kind: 'stale' as const };
      const battle = await battleRepo.findOne({ where: { id: active.id }, lock: { mode: 'pessimistic_write' } });
      if (!battle || battle.resolved || battle.cancelledAt || battle.cancellationReason) return { kind: 'not-active' as const };
      const timestamp = Date.now();
      if (timestamp >= battle.endAt.getTime()) return { kind: 'not-active' as const };
      const previousTravelJobId = String(intent.scheduledJobId ?? '');
      if (character.fleeNextAttemptAt && character.fleeNextAttemptAt.getTime() > timestamp) {
        return { kind: 'failed' as const, retryAt: character.fleeNextAttemptAt.getTime(), intent: { ...intent }, battleId: battle.id };
      }
      const start = battle.startingSnapshot;
      if (!start?.snapshot || !start?.inventory || !Number.isFinite(Number(start.worldMoveSpd))) {
        // Legacy active rows do not have the immutable starting inventory needed to safely replay theft/consumption.
        // Fail closed: leave combat and its reward path untouched and retry no sooner than ten seconds.
        character.fleeAttemptIndex = Math.max(0, Number(character.fleeAttemptIndex ?? 0)) + 1;
        character.fleeNextAttemptAt = new Date(timestamp + 10_000);
        intent.fleeAttemptIndex = Number(character.fleeAttemptIndex);
        character.travelIntent = intent;
        await characterRepo.save(character);
        return { kind: 'failed' as const, retryAt: timestamp + 10_000, intent: { ...intent }, battleId: battle.id };
      }

      const targetTick = Math.max(0, Math.floor((timestamp - battle.startAt.getTime()) / MS_PER_TICK));
      const replay = BattleEngine.simulateBattle(
        start.snapshot,
        this.dataService.getMonsterById(battle.monsterId),
        // The original log already contains the resolved Gambit choices; replay needs the same page as the original snapshot.
        start.gambitPage ?? null,
        battle.seedUsed,
        {
          inventory: { ...start.inventory },
          itemDefinitions: Object.fromEntries([...(this.dataService.getItems()?.consumables ?? []), ...(this.dataService.getItems()?.equipment ?? []), ...(this.dataService.getItems()?.monsterParts ?? []), ...(this.dataService.getItems()?.materials ?? [])].map((item: any) => [item.id, item])),
          monsterSkillDefs: Object.fromEntries(this.dataService.getMonsterSkills().map((skill: any) => [skill.id, skill])),
          statusEffectDefs: Object.fromEntries(this.dataService.getStatusEffects().map((status: any) => [status.id, status])),
          regenTickOffset: Number(start.regenTickOffset ?? 0),
          stopAfterTick: targetTick,
        },
      );
      const checkpoint: any = (replay as any).checkpoint;
      if (!checkpoint || checkpoint.battleEnded || Number(checkpoint.hp) <= 0 || Number(checkpoint.monsterHp) <= 0) {
        // A lethal character tick wins over FLEE, and a battle that has already ended resolves normally.
        return { kind: 'not-active' as const };
      }

      const monster = this.dataService.getMonsterById(battle.monsterId);
      const movePenalty = (statuses: any[]) => (statuses ?? []).reduce((sum: number, status: any) => {
        const id = String(status?.type ?? status?.id ?? '');
        const definition: any = this.dataService.getStatusEffects().find((row: any) => row.id === id) ?? {};
        return sum + Math.max(0, Number(status?.moveSpeedPenalty ?? (definition.stackable ? definition.moveSpeedPenaltyPerStack : definition.moveSpeedPenalty) ?? 0));
      }, 0);
      const timestampBuffs = (Array.isArray(start.worldSpeedBuffs) ? start.worldSpeedBuffs : character.activeTempBuffs ?? []).filter((buff: any) => {
        const expiryRaw = buff?.expiresAt ?? buff?.endsAt;
        const expiry = typeof expiryRaw === 'number' ? expiryRaw : Date.parse(String(expiryRaw ?? ''));
        return !Number.isFinite(expiry) || expiry > timestamp;
      });
      const checkpointStatuses = persistStatusEffectsAtCheckpoint(checkpoint.statusEffects, Number(checkpoint.tick), timestamp);
      const characterMoveSpd = Array.isArray(start.worldEquipment)
        ? calculateWorldMoveSpeed(start.snapshot, start.worldEquipment, timestampBuffs, checkpointStatuses, timestamp)
        : Math.max(0, Number(start.worldMoveSpd) - movePenalty(checkpointStatuses));
      const monsterMoveSpd = Math.max(0, Number(monster?.moveSpd ?? 0) - movePenalty(checkpoint.monsterStatusEffects));
      const totalLuk = Number(start.snapshot.luk ?? character.luk ?? 5);
      const chance = calculateFleeChancePercent(characterMoveSpd, monsterMoveSpd, totalLuk);
      const attemptIndex = Math.max(0, Number(intent.fleeAttemptIndex ?? 0));
      const roll = new Mulberry32(`${battle.id}:flee:${attemptIndex}`).nextPercent();
      if (roll >= chance) {
        this.logger.warn(`FLEE failed character=${characterId} battle=${battle.id} attempt=${attemptIndex + 1} chance=${chance}% roll=${roll}`);
        character.fleeAttemptIndex = attemptIndex + 1;
        character.fleeNextAttemptAt = new Date(timestamp + 10_000);
        intent.fleeAttemptIndex = character.fleeAttemptIndex;
        intent.fleeLastChancePercent = chance;
        intent.fleeNextAttemptAt = character.fleeNextAttemptAt.toISOString();
        character.travelIntent = intent;
        await characterRepo.save(character);
        return { kind: 'failed' as const, retryAt: timestamp + 10_000, intent: { ...intent }, battleId: battle.id };
      }

      this.logger.log(`FLEE succeeded character=${characterId} battle=${battle.id} attempt=${attemptIndex + 1} chance=${chance}% roll=${roll}`);
      // Inventory changes are those caused by this battle only; preserve unrelated later inventory mutations.
      const currentItems = await manager.getRepository(InventoryItem).find({ where: { characterId, location: 'inventory' }, lock: { mode: 'pessimistic_write' } });
      const currentCount: Record<string, number> = {};
      for (const row of currentItems) currentCount[row.itemId] = (currentCount[row.itemId] ?? 0) + Number(row.quantity);
      const initial = start.inventory as Record<string, number>;
      const after = checkpoint.inventoryAfter as Record<string, number>;
      const committedConsumptions: Array<{ itemId: string; quantity: number }> = [];
      for (const itemId of new Set([...Object.keys(initial), ...Object.keys(after)])) {
        const spent = Math.max(0, Number(initial[itemId] ?? 0) - Number(after[itemId] ?? 0));
        const take = Math.min(spent, Number(currentCount[itemId] ?? 0));
        if (take > 0) {
          await this.inventoryService.removeItem(characterId, itemId, take, manager);
          committedConsumptions.push({ itemId, quantity: take });
        }
      }

      character.hpCurrent = Math.max(1, Math.min(Number(checkpoint.hp), Number(start.snapshot.maxHp)));
      character.spCurrent = Math.max(0, Math.min(Number(checkpoint.sp), Number(start.snapshot.maxSp)));
      character.activeTempBuffs = (character.activeTempBuffs ?? []).filter((buff: any) => {
        const expiry = Date.parse(String(buff?.expiresAt ?? buff?.endsAt ?? ''));
        return !Number.isFinite(expiry) || expiry > timestamp;
      });
      character.statusEffects = checkpointStatuses;
      // Reuse the canonical Diet transition for only the food uses that occurred before the escape tick.
      const partialBattle = { ...battle, log: { events: (battle.log?.events ?? []).filter((event: any) => Number(event?.tick ?? 0) <= Number(checkpoint.tick)) } } as BattleQueueEntry;
      this.applyResolvedFoodState(character, partialBattle);
      const digest = checkpoint.foodDigestRemainingTicksByItem ?? {};
      for (const [itemId, ticksRaw] of Object.entries(digest)) {
        const ticks = Math.max(0, Number(ticksRaw) - 1);
        const until = new Date(timestamp + ticks * MS_PER_TICK).toISOString();
        if (character.dietLevels?.[itemId]) character.dietLevels[itemId].lastDigestUntil = until;
        for (const row of character.diet ?? []) if (row.itemId === itemId) row.digestUntil = until;
      }
      const checkpointFoods = (checkpoint.foodBuffs ?? []).filter((food: any) => Number(food.remainingTicks ?? 0) > 0);
      if (checkpointFoods.length) {
        const latest = checkpointFoods.reduce((a: any, b: any) => Number(a.remainingTicks) >= Number(b.remainingTicks) ? a : b);
        character.activeFoodBuff = {
          itemId: latest.itemId,
          expiresAt: new Date(timestamp + Math.max(0, Number(latest.remainingTicks) - 1) * MS_PER_TICK).toISOString(),
          hpRegenPerTenTicks: Number(latest.hpRegenPerTenTicks ?? 0),
          spRegenPerTenTicks: Number(latest.spRegenPerTenTicks ?? 0),
        };
      } else character.activeFoodBuff = null;

      // This is an audit marker, not a rewrite of the original precomputed outcome/log/rewards.
      battle.resolved = true;
      battle.cancellationReason = 'flee';
      battle.cancelledAt = new Date(timestamp);
      // FLEE replay has already reconstructed resources through its checkpoint;
      // never let off-battle catch-up reapply pre-FLEE intervals to that state.
      this.advanceResourceRegenCheckpoint(character, new Date(timestamp));
      await battleRepo.save(battle);
      const future = await queueRepo.find({ where: { characterId, resolved: false }, order: { sequenceIndex: 'ASC' } });
      const obsolete = future.filter(entry => entry.id !== battle.id).map(entry => entry.id);
      if (obsolete.length) await queueRepo.delete({ id: In(obsolete), resolved: false });
      character.fleeNextAttemptAt = null;
      character.fleeAttemptIndex = 0;
      intent.fleeRequested = false;
      intent.fleeBattleId = null;
      intent.waitingForBattle = false;
      intent.fleeNextAttemptAt = null;
      intent.pausedBattleId = null;
      intent.lastFleeSuccessAt = new Date(timestamp).toISOString();
      if (intent.kind !== 'saved-town-teleport') {
        const population = Math.max(1, await this.mapPresenceService.countActiveGrinders(character.currentMapId));
        const cycleIndex = Math.max(0, Number(character.encounterCycle?.cycleIndex ?? 0));
        const delaySeconds = deterministicIntInclusive(`${character.id}:${character.currentMapId}:${cycleIndex}:search-delay`, 2, 6) + population;
        character.encounterCycle = { ...(character.encounterCycle ?? {}), cycleIndex: cycleIndex + 1, nextAt: new Date(timestamp + delaySeconds * 1000).toISOString() };
      } else {
        character.encounterCycle = { ...(character.encounterCycle ?? {}), cycleIndex: Number(character.encounterCycle?.cycleIndex ?? 0) + 1, nextAt: null };
      }
      intent.lastAccruedAt = new Date(timestamp).toISOString();
      // Invalidate the old battle-end travel job. If it is already executing, its
      // persisted scheduleVersion check still makes it a no-op after this commit.
      intent.scheduleVersion = Math.max(0, Number(intent.scheduleVersion ?? 0)) + 1;
      intent.scheduledJobId = `travel-${characterId}-${Number(intent.generation ?? 0)}-${intent.scheduleVersion}`;
      character.travelIntent = intent;
      const equipmentChanged = await this.equipmentService.applyPendingEquipmentChanges(character.id, manager);
      await characterRepo.save(character);
      const journalEvents = (Array.isArray(battle.log?.events) ? battle.log.events : []).filter((event: any) => Number(event?.tick ?? 0) <= Number(checkpoint.tick));
      return { kind: 'cancelled' as const, battleId: battle.id, character, previousMapId: character.currentMapId, obsolete, intent, equipmentChanged, previousTravelJobId, committedConsumptions, journalEvents, battleForJournal: { ...battle, log: { events: journalEvents } } };
    }));

    if (result.kind === 'stale' || result.kind === 'not-active') return result.kind;
    if (result.kind === 'failed') {
      await this.scheduleFleeAttempt(characterId, result.intent, result.battleId, Math.max(250, result.retryAt - Date.now()));
      return 'failed';
    }

    await this.publishCommittedBattleJournal(characterId, result.battleForJournal, result.committedConsumptions, []);
    await this.idleJournal.fled(characterId, String(this.dataService.getMonsterById(result.battleForJournal.monsterId)?.name ?? result.battleForJournal.monsterId), `battle-flee:${result.battleId}`);
    try { await this.bullQueue.getJob(result.battleId).then(job => job?.remove()).catch(() => undefined); } catch { /* committed cancellation wins */ }
    if (result.previousTravelJobId) {
      try {
        const previousTravelJob = await this.bullQueue.getJob(result.previousTravelJobId);
        if (previousTravelJob && await previousTravelJob.getState() !== 'active') await previousTravelJob.remove();
      } catch { /* a running old job will fail the persisted scheduleVersion check */ }
    }
    if (result.obsolete?.length) await this.removeBattleQueueJobs(result.obsolete);
    await this.bullQueue.add('advance-travel', {
      characterId, generation: Number(result.intent.generation), scheduleVersion: Number(result.intent.scheduleVersion),
    }, { jobId: String(result.intent.scheduledJobId), delay: 0, removeOnComplete: true, attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
    await this.safePublishBattleResolved(characterId, await this.getBattleById(result.battleId) as BattleQueueEntry);
    await this.safePublishQueueUpdated(characterId, await this.getBattleQueue(characterId, 5), await this.buildAuthoritativeBattleSnapshot(characterId));
    return 'cancelled';
  }

  private async scheduleFleeAttempt(characterId: string, intent: any, battleId: string, delayMs: number): Promise<void> {
    await this.bullQueue.add('attempt-flee', { characterId, battleId, generation: Number(intent.generation) }, {
      jobId: `flee-${battleId}-g${Number(intent.generation)}-${Number(intent.fleeAttemptIndex ?? 0)}-${Math.floor(Date.now() / 1000)}`,
      delay: Math.max(0, Math.ceil(delayMs)), removeOnComplete: true, attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
    });
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

  private async publishCommittedBattleJournal(
    characterId: string,
    battle: BattleQueueEntry,
    committedConsumptions: Array<{ itemId: string; quantity: number }>,
    autoFedItems: string[],
  ): Promise<void> {
    const remaining = new Map<string, number>();
    for (const row of committedConsumptions) remaining.set(row.itemId, (remaining.get(row.itemId) ?? 0) + Math.max(0, Number(row.quantity ?? 0)));
    const monsterName = String(this.dataService.getMonsterById(battle.monsterId)?.name ?? battle.monsterId);
    const events = (Array.isArray(battle.log?.events) ? battle.log.events : []).slice().sort((a: any, b: any) => Number(a.tick ?? 0) - Number(b.tick ?? 0));
    for (const event of events) {
      const itemId = String(event?.itemId ?? '');
      if (!itemId) continue;
      if (event.action === 'use_item') {
        const definition = this.dataService.getItemById(itemId);
        if (definition?.effect?.type !== 'food_buff') continue;
        const available = Number(remaining.get(itemId) ?? 0);
        if (available < 1) continue;
        remaining.set(itemId, available - 1);
        await this.idleJournal.ate(characterId, String(definition.name ?? itemId), `battle-food:${battle.id}:${Number(event.tick ?? 0)}:${itemId}`);
      } else if (event.action === 'item_stolen') {
        const available = Number(remaining.get(itemId) ?? 0);
        const quantity = Math.min(available, Math.max(0, Math.floor(Number(event.quantity ?? 1))));
        if (quantity < 1) continue;
        remaining.set(itemId, available - quantity);
        await this.idleJournal.stolen(characterId, monsterName, quantity, String(this.dataService.getItemById(itemId)?.name ?? itemId), `battle-theft:${battle.id}:${Number(event.tick ?? 0)}:${itemId}`);
      }
    }
    for (let index = 0; index < autoFedItems.length; index++) {
      const itemId = autoFedItems[index];
      await this.idleJournal.ate(characterId, String(this.dataService.getItemById(itemId)?.name ?? itemId), `auto-feed-battle:${battle.id}:${index}:${itemId}`);
    }
  }

  /**
   * Move the off-battle regeneration cursor through an immutable combat boundary.
   * BattleEngine already projected every eligible 10-tick regen event in this
   * interval, and current Character HP/SP now represent the battle's terminal
   * snapshot. Replaying any pre-battle boundary on top of that terminal state
   * would grant HP/SP twice, especially after delayed-job recovery.
   */
  private advanceResourceRegenCheckpoint(character: Character, throughAt: Date): void {
    const timestamp = throughAt.getTime();
    const anchorAt = character.regenAnchorAt?.getTime?.() ?? character.createdAt?.getTime?.() ?? timestamp;
    const lastOwnedBoundaryAt = anchorAt + Math.floor((timestamp - anchorAt) / MS_PER_TICK / 10) * 10 * MS_PER_TICK;
    const currentCheckpointAt = character.resourceRegenAt?.getTime?.() ?? Number.NEGATIVE_INFINITY;
    if (lastOwnedBoundaryAt > currentCheckpointAt) character.resourceRegenAt = new Date(lastOwnedBoundaryAt);
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

  private async tryAutoFeed(character: Character, boundaryAt: number, manager?: EntityManager): Promise<string[]> {
    if (!character.autoFeed || character.pendingMapTransition) return [];

    // Auto Feed is evaluated at every authoritative battle-resolution boundary.
    // An already-active food buff does not suppress feeding: any Diet entry whose
    // digestion has reached 0 and whose food is available may be consumed now.
    // boundaryAt remains part of the caller's Grind-continuity calculation, but
    // eligibility is defined by the current Diet digestion state.
    void boundaryAt;

    const now = Date.now();
    const consumedItems: string[] = [];

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
          updated = await this.inventoryService.consumeFood(character.id, itemId, manager, true, false);
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
        consumedItems.push(itemId);
        consumedThisPass = true;
        break;
      }

      if (!consumedThisPass) break;
    }

    return consumedItems;
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
    const savedTown = this.dataService.getMapById(String(character.savedTownMapId ?? ''));
    const respawnTownId = savedTown?.type === 'town' ? savedTown.id : TOWN_MAP_ID;
    character.status = 'town';
    character.currentMapId = respawnTownId;
    const savedTownWaypointTravel = character.travelIntent &&
      (character.travelIntent.kind === 'saved-town-route-teleport' || character.travelIntent.viaSavedTownWaypoint === true)
      ? { ...character.travelIntent }
      : null;
    // A route deliberately using the saved Town as an intermediate teleport
    // survives death: respawn at that Town, then let MapService recompute the
    // remaining route to the originally requested destination.
    if (savedTownWaypointTravel) {
      savedTownWaypointTravel.segmentIndex = 0;
      savedTownWaypointTravel.segmentProgress = 0;
      savedTownWaypointTravel.lastAccruedAt = new Date().toISOString();
      savedTownWaypointTravel.lastDurationSeconds = null;
      savedTownWaypointTravel.waitingForBattle = false;
      savedTownWaypointTravel.pausedBattleId = null;
      savedTownWaypointTravel.fleeRequested = false;
      savedTownWaypointTravel.fleeBattleId = null;
      savedTownWaypointTravel.fleeNextAttemptAt = null;
      if (savedTownWaypointTravel.kind !== 'saved-town-route-teleport') {
        // Re-enter the one-time waypoint state so MapService recomputes BFS
        // from the actual respawn Town, even if death happened after the first warp.
        savedTownWaypointTravel.kind = 'saved-town-route-teleport';
        savedTownWaypointTravel.waypointMapId = respawnTownId;
        savedTownWaypointTravel.routeMapIds = [];
      }
    }
    character.travelIntent = savedTownWaypointTravel;
    character.gatheringCycle = { ...(character.gatheringCycle ?? {}), progress: 0, cycleIndex: Number(character.gatheringCycle?.cycleIndex ?? 0) + 1, varianceSeconds: null, lastUpdatedAt: new Date().toISOString() };
    character.fleeNextAttemptAt = null;
    character.fleeAttemptIndex = 0;
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
    await this.safePublishQueueUpdated(characterId, entries, await this.buildAuthoritativeBattleSnapshot(characterId));
  }

  /** Remove only Bull jobs for queue rows that have already been deleted transactionally. */
  async removeBattleQueueJobs(battleIds: string[]): Promise<void> {
    for (const battleId of [...new Set(battleIds)]) {
      try {
        const job = await this.bullQueue.getJob(battleId);
        if (!job) continue;
        const state = await job.getState();
        // A processor already running for a deleted row will harmlessly observe
        // the missing row; never force-remove an active Bull job.
        if (state !== 'active') await job.remove();
      } catch (error) {
        this.logger.warn(`Could not remove stale Bull job ${battleId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async cancelPendingBattlesAfter(characterId: string, activeBattleId: string): Promise<void> {
    const pending = await this.battleQueueRepo.find({
      where: { characterId, resolved: false },
    });
    const future = pending.filter((entry) => entry.id !== activeBattleId);
    if (!future.length) return;
    await this.battleQueueRepo.delete({ id: In(future.map((entry) => entry.id)), resolved: false });
    await this.removeBattleQueueJobs(future.map(entry => entry.id));
  }

  async cancelPendingBattles(characterId: string): Promise<void> {
    const pending = await this.battleQueueRepo.find({
      where: { characterId, resolved: false },
    });
    if (!pending.length) return;

    await this.battleQueueRepo.delete({ id: In(pending.map((entry) => entry.id)), resolved: false });
    await this.removeBattleQueueJobs(pending.map(entry => entry.id));
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
        startAt: battle.startAt.toISOString(),
        endAt: battle.endAt.toISOString(),
        cancelledAt: battle.cancelledAt ? battle.cancelledAt.toISOString() : null,
        outcome: battle.outcome,
        xpGain: battle.cancellationReason === 'flee' || battle.cancelledAt ? 0 : Number(battle.xpGain ?? 0),
        goldGain: battle.cancellationReason === 'flee' || battle.cancelledAt ? 0 : Number(battle.goldGain ?? 0),
        drops: battle.cancellationReason === 'flee' || battle.cancelledAt ? [] : battle.drops ?? [],
        ...(battle.cancellationReason || battle.cancelledAt ? { cancelled: true, cancellationReason: battle.cancellationReason ?? 'cancelled' } : {}),
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
      await repo.createQueryBuilder()
        .insert()
        .into(MapKillCounter)
        .values({ characterId, mapId, epoch: 0, mapKillCount: 0, perMonsterKillCount: {} })
        .orIgnore()
        .execute();
      counter = await repo.findOne({ where: { characterId, mapId } });
    }
    if (!counter) throw new Error(`Unable to create or read map kill counter for ${characterId}/${mapId}`);
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
