import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { forwardRef, Inject } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { MapKillCounter, BattleQueueEntry, Character, User } from '../../database/entities';
import { DataService } from '../data/data.service';
import { BattleService } from '../battle/battle.service';
import { MapPresenceService } from '../presence/map-presence.service';
import { TOWN_MAP_ID, findCardinalRoute, isInstantTownExitEdge, calculateWorldMoveSpeed, calculateTravelDurationSeconds, accrueTravelSegmentProgress, deterministicIntInclusive, calculateGatheringDurationSeconds, calculateFleeChancePercent, Mulberry32 } from '@nanommo/shared';
import { EquipmentService } from '../equipment/equipment.service';
import { InventoryService } from '../inventory/inventory.service';
import { IdleJournalService } from '../chat/chat-history.service';

const TOWN_GUARD_HUNGER_MESSAGE = 'Town Guard: You are hungry! Eat something or go cleanse your sins for a change.';

@Injectable()
export class MapService {
  private readonly logger = new Logger(MapService.name);

  constructor(
    @InjectQueue('battle-queue') private readonly bullQueue: Queue,
    @InjectRepository(MapKillCounter)
    private readonly mapKillCounterRepo: Repository<MapKillCounter>,
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataService: DataService,
    @Inject(forwardRef(() => BattleService)) private readonly battleService: BattleService,
    private readonly equipmentService: EquipmentService,
    private readonly inventoryService: InventoryService,
    private readonly mapPresenceService: MapPresenceService,
    private readonly idleJournal: IdleJournalService,
  ) {}

  /**
   * Get all available maps
   */
  async getMaps(): Promise<any[]> {
    // Map topology and monster-presence weights have their own canonical catalogue.
    return this.dataService.getMaps();
  }

  /** Request travel to a revealed map. Location/presence change only when a route segment commits. */
  async enterMap(characterId: string, mapId: string, requestedAt?: string): Promise<any> {
    const intentAt = Number.isFinite(Date.parse(String(requestedAt ?? '')))
      ? new Date(String(requestedAt)).toISOString() : new Date().toISOString();
    // Settle all non-battle stationary time before turning on Traveling. The activity
    // updater subtracts any active battle interval and persists the exact pause point.
    // A destination change during an existing route is already paused, so this is a no-op.
    const beforeTravel = await this.characterRepo.findOne({ where: { id: characterId } });
    if (beforeTravel?.status === 'grinding' && !beforeTravel.travelIntent &&
      this.dataService.getMapById(beforeTravel.currentMapId)?.type === 'grind') {
      await this.advanceStationaryActivity(characterId);
    }
    let result: any;
    try {
      result = await this.battleService.withCharacterQueueLock(characterId, async () => this.characterRepo.manager.transaction(async manager => {
      const characterRepo = manager.getRepository(Character);
      const queueRepo = manager.getRepository(BattleQueueEntry);
      const userRepo = manager.getRepository(User);
      const character = await characterRepo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      const map: any = this.dataService.getMapById(mapId);
      if (!map || map.isClickable === false || !['town', 'grind'].includes(String(map.type))) throw new BadRequestException('Map not found');
      if (map.type === 'grind') {
        const user = await userRepo.findOne({ where: { id: character.userId } });
        if (user?.emailVerified !== true) throw new BadRequestException('EMAIL_NOT_VERIFIED');
      }
      const storedDiscovered = Array.isArray(character.discoveredMapIds) ? character.discoveredMapIds : [TOWN_MAP_ID];
      const persistedDiscovered = character.currentMapId === TOWN_MAP_ID && storedDiscovered.every(id => id === TOWN_MAP_ID || id === 'map_green_grounds_4')
        ? storedDiscovered.filter(id => id !== 'map_green_grounds_4') : storedDiscovered;
      const discovered = Array.from(new Set([...persistedDiscovered, character.currentMapId || TOWN_MAP_ID]));
      const knownMaps = discovered.map(id => this.dataService.getMapById(id)).filter(Boolean);
      const revealed = knownMaps.some((known: any) => Math.abs(Number(known.coordinates.x) - Number(map.coordinates.x)) + Math.abs(Number(known.coordinates.y) - Number(map.coordinates.y)) <= 1);
      if (!revealed && mapId !== character.savedTownMapId) throw new BadRequestException('Map has not been revealed');
      if (map.type === 'grind' && mapId !== character.currentMapId) {
        const expiry = character.activeFoodBuff?.expiresAt ? Date.parse(String(character.activeFoodBuff.expiresAt)) : 0;
        const dietExpiry = (Array.isArray(character.diet) ? character.diet : []).reduce((max, row: any) => Math.max(max, Date.parse(String(row.digestUntil ?? '')) || 0), 0);
        if (Math.max(expiry, dietExpiry) <= Date.now()) throw new BadRequestException(TOWN_GUARD_HUNGER_MESSAGE);
      }

      const now = Date.now();
      const unresolved = await queueRepo.find({ where: { characterId, resolved: false }, order: { sequenceIndex: 'ASC' } });
      const active = unresolved.find(entry => entry.startAt.getTime() <= now);
      const previousMapId = character.currentMapId;
      const cancelledBattleIds = unresolved.filter(entry => !active || entry.id !== active.id).map(entry => entry.id);
      if (cancelledBattleIds.length) await queueRepo.delete({ id: In(cancelledBattleIds), resolved: false });
      const oldIntent = character.travelIntent ?? null;
      const previousJobId = oldIntent?.scheduledJobId as string | undefined;

      // Clicking the authoritative current map cancels travel without moving/rewinding location.
      if (mapId === character.currentMapId && mapId !== character.savedTownMapId) {
        character.travelIntent = null;
        character.pendingMapTransition = null;
        character.fleeNextAttemptAt = null;
        character.fleeAttemptIndex = 0;
        character.gatheringCycle = { ...(character.gatheringCycle ?? {}), lastUpdatedAt: new Date(now).toISOString() };
        character.status = map.type === 'town' ? 'town' : 'grinding';
        character.lastSeenAt = new Date();
        await characterRepo.save(character);
        return { mode: 'cancel', previousMapId, destinationMapId: mapId, character, cancelledBattleIds, previousJobId, activeBattleEndAt: active?.endAt?.getTime() };
      }

      const savedTownTeleport = mapId === character.savedTownMapId;
      const route = savedTownTeleport ? [this.dataService.getMapById(character.currentMapId), map] : findCardinalRoute(this.dataService.getMaps(), character.currentMapId, mapId);
      if (!route.length || route.some(node => !node || node.isClickable === false)) throw new BadRequestException('No canonical route to the selected map');
      const nextMapId = route.length > 1 ? route[1].id : mapId;
      const preserveSegment = !savedTownTeleport && oldIntent?.kind === 'route' && oldIntent.nextMapId === nextMapId;
      const oldLastAt = Date.parse(String(oldIntent?.lastAccruedAt ?? now));
      const oldDuration = Number(oldIntent?.lastDurationSeconds);
      const accruedSinceLastPulse = preserveSegment && !active && oldIntent?.waitingForBattle !== true && Number.isFinite(oldLastAt) && Number.isFinite(oldDuration) && oldDuration > 0
        ? Math.max(0, (now - oldLastAt) / 1000 / oldDuration) : 0;
      const oldProgress = preserveSegment
        ? Math.max(0, Math.min(0.999999, Number(oldIntent.segmentProgress ?? 0) + accruedSinceLastPulse)) : 0;
      const generation = Math.max(0, Number(oldIntent?.generation ?? 0)) + 1;
      const newIntent: any = {
        kind: savedTownTeleport ? 'saved-town-teleport' : 'route',
        destinationMapId: mapId,
        routeMapIds: route.map(node => node.id),
        segmentIndex: 0,
        nextMapId: savedTownTeleport ? mapId : nextMapId,
        segmentProgress: oldProgress,
        lastAccruedAt: active ? new Date(Math.max(now, active.endAt.getTime())).toISOString() : new Date(now).toISOString(),
        requestedAt: intentAt,
        generation,
        scheduleVersion: 0,
        fleeRequested: !!active && active.endAt.getTime() > now,
        waitingForBattle: !!active,
        // A destination change cannot reset a parallel FLEE retry stream or deadline.
        fleeAttemptIndex: active && oldIntent?.fleeRequested === true ? Math.max(0, Number(oldIntent.fleeAttemptIndex ?? 0)) : 0,
        ...(active && oldIntent?.fleeRequested === true && oldIntent.fleeNextAttemptAt ? { fleeNextAttemptAt: oldIntent.fleeNextAttemptAt } : {}),
        ...(active && active.endAt.getTime() > now && oldIntent?.fleeRequested === true ? { fleeBattleId: oldIntent.fleeBattleId ?? active.id } : (active && active.endAt.getTime() > now ? { fleeBattleId: active.id } : {})),
        ...(savedTownTeleport ? { teleportAfterBattle: !!active } : {}),
      };
      character.travelIntent = newIntent;
      character.pendingMapTransition = null; // Legacy deferred transitions may never override this intent.
      character.gatheringCycle = { ...(character.gatheringCycle ?? {}), lastUpdatedAt: new Date(now).toISOString() };
      character.lastSeenAt = new Date();
      await characterRepo.save(character);

      if (active) {
        const scheduled = this.nextTravelSchedule(characterId, newIntent);
        newIntent.scheduleVersion = scheduled.scheduleVersion;
        newIntent.scheduledJobId = scheduled.jobId;
        await characterRepo.save(character);
        return { mode: 'deferred', previousMapId, destinationMapId: mapId, character, cancelledBattleIds, previousJobId, activeBattleId: active.id, activeBattleEndAt: active.endAt.getTime(), scheduled };
      }
      return { mode: 'travel', previousMapId, destinationMapId: mapId, character, cancelledBattleIds, previousJobId };
      }));
    } catch (error) {
      if (error instanceof BadRequestException && error.message === TOWN_GUARD_HUNGER_MESSAGE &&
          beforeTravel?.status === 'town' && this.dataService.getMapById(mapId)?.type === 'grind') {
        await this.idleJournal.townGuardHungry(characterId, `town-guard-hungry:${Date.now()}`);
      }
      throw error;
    }

    if (result.previousJobId) await this.removeJob(String(result.previousJobId));
    if (result.cancelledBattleIds?.length) await this.battleService.removeBattleQueueJobs(result.cancelledBattleIds);
    if (result.mode === 'deferred' && result.scheduled) {
      if (result.activeBattleId && result.character.travelIntent?.fleeRequested) {
        const persistedRetryAt = Date.parse(String(result.character.travelIntent.fleeNextAttemptAt ?? ''));
        const firstEligibleDelay = Number.isFinite(persistedRetryAt) ? Math.max(0, persistedRetryAt - Date.now()) : 1000;
        await this.bullQueue.add('attempt-flee', { characterId, battleId: result.activeBattleId, generation: Number(result.character.travelIntent.generation) }, { jobId: `flee-${result.activeBattleId}-g${Number(result.character.travelIntent.generation)}-${Number(result.character.travelIntent.fleeAttemptIndex ?? 0)}-${Math.floor(Date.now()/1000)}`, delay: firstEligibleDelay, removeOnComplete: true, attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
      }
      await this.enqueueTravelSchedule(characterId, result.character.travelIntent, Math.max(250, Number(result.activeBattleEndAt ?? Date.now()) - Date.now() + 250));
    } else if (result.mode === 'travel') {
      await this.advanceTravel(characterId, Number(result.character.travelIntent?.generation));
    } else if (result.mode === 'cancel') {
      if (result.character.status === 'grinding' && !result.character.travelIntent && !result.activeBattleEndAt) await this.battleService.queueBattles(characterId, 5);
      if (result.character.status === 'grinding') await this.scheduleStationaryActivity(characterId);
    }
    if (result.mode === 'travel' || result.mode === 'deferred' || result.mode === 'cancel') {
      // Travel invalidates any old pre-simulated encounters; publish the authoritative queue immediately.
      await this.battleService.publishQueueUpdated(characterId);
    }
    const fresh = await this.characterRepo.findOne({ where: { id: characterId } });
    this.logger.debug(`Character ${characterId} ${result.mode === 'cancel' ? 'cancelled travel at' : 'requested travel to'} ${result.destinationMapId}`);
    return {
      deferred: result.mode === 'deferred',
      superseded: false,
      battleId: null,
      destinationMapId: result.destinationMapId,
      character: fresh ? this.mapCharacterState(fresh) : this.mapCharacterState(result.character),
    };
  }

  private mapCharacterState(character: Character): any {
    return {
      id: character.id, status: character.status, currentMapId: character.currentMapId,
      pendingMapTransition: character.pendingMapTransition ?? null, savedTownMapId: character.savedTownMapId ?? null,
      discoveredMapIds: character.discoveredMapIds ?? [TOWN_MAP_ID], lastGrindStance: character.lastGrindStance ?? 'hunting',
      travelIntent: character.travelIntent ?? null, gatheringLevel: Number(character.gatheringLevel ?? 1),
      gatheringCycle: character.gatheringCycle ?? { progress: 0, cycleIndex: 0, varianceSeconds: null, lastUpdatedAt: null },
      encounterCycle: character.encounterCycle ?? { cycleIndex: 0, nextAt: null },
      fleeAttemptIndex: Number(character.fleeAttemptIndex ?? 0), fleeNextAttemptAt: character.fleeNextAttemptAt ?? null,
    };
  }

  private nextTravelSchedule(characterId: string, intent: any): { scheduleVersion: number; jobId: string } {
    const scheduleVersion = Math.max(0, Number(intent.scheduleVersion ?? 0)) + 1;
    return { scheduleVersion, jobId: `travel-${characterId}-${Number(intent.generation ?? 0)}-${scheduleVersion}` };
  }

  private async enqueueTravelSchedule(characterId: string, intent: any, delayMs: number): Promise<void> {
    if (!intent || !intent.scheduledJobId) return;
    await this.bullQueue.add('advance-travel', {
      characterId, generation: Number(intent.generation), scheduleVersion: Number(intent.scheduleVersion),
    }, {
      jobId: String(intent.scheduledJobId), delay: Math.max(0, Math.ceil(delayMs)),
      removeOnComplete: true, removeOnFail: false,
      attempts: 5, backoff: { type: 'exponential', delay: 1000 },
    });
  }

  private async removeJob(jobId: string): Promise<void> {
    try { const job = await this.bullQueue.getJob(jobId); if (job && await job.getState() !== 'active') await job.remove(); }
    catch (error) { this.logger.debug(`Could not remove activity job ${jobId}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  /** Advance exactly one authoritative route segment. Bull jobs are hints; persisted intent and locks decide. */
  async advanceTravel(characterId: string, expectedGeneration?: number, expectedScheduleVersion?: number): Promise<void> {
    const result = await this.battleService.withCharacterQueueLock(characterId, async () => this.characterRepo.manager.transaction(async manager => {
      const characterRepo = manager.getRepository(Character);
      const queueRepo = manager.getRepository(BattleQueueEntry);
      const character = await characterRepo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character?.travelIntent) return { kind: 'stale' as const };
      const intent: any = character.travelIntent;
      if (expectedGeneration !== undefined && Number(intent.generation) !== expectedGeneration) return { kind: 'stale' as const };
      if (expectedScheduleVersion !== undefined && Number(intent.scheduleVersion) !== expectedScheduleVersion) return { kind: 'stale' as const };
      const now = Date.now();
      const unresolved = await queueRepo.find({ where: { characterId, resolved: false }, order: { startAt: 'ASC', sequenceIndex: 'ASC' } });
      const startedBattle = unresolved.find(entry => entry.startAt.getTime() <= now);
      if (startedBattle) {
        // Travel and encounters resume only after the immutable battle's full interval.
        const priorAccruedAt = Date.parse(String(intent.lastAccruedAt ?? ''));
        const encounterStartAt = startedBattle.startAt.getTime();
        const priorDuration = Number(intent.lastDurationSeconds);
        if (Number.isFinite(priorAccruedAt) && priorAccruedAt < encounterStartAt && Number.isFinite(priorDuration) && priorDuration > 0) {
          // Apply only the non-battle interval before the actual encounter start.
          const accrued = accrueTravelSegmentProgress(Number(intent.segmentProgress ?? 0), priorAccruedAt, encounterStartAt, priorDuration);
          intent.segmentProgress = accrued.progress;
        }
        intent.lastAccruedAt = new Date(startedBattle.endAt.getTime()).toISOString();
        intent.waitingForBattle = true;
        if (intent.pausedBattleId !== startedBattle.id) {
          intent.pausedBattleId = startedBattle.id;
          if (intent.fleeRequested === true) intent.fleeBattleId = startedBattle.id;
          const cycle: any = { cycleIndex: 0, nextAt: null, ...(character.encounterCycle ?? {}) };
          const population = Math.max(1, await this.mapPresenceService.countActiveGrinders(character.currentMapId));
          const delaySeconds = deterministicIntInclusive(`${character.id}:${character.currentMapId}:${cycle.cycleIndex}:search-delay`, 2, 6) + population;
          cycle.cycleIndex = Number(cycle.cycleIndex ?? 0) + 1;
          cycle.nextAt = new Date(startedBattle.endAt.getTime() + delaySeconds * 1000).toISOString();
          character.encounterCycle = cycle;
        }
        const scheduled = this.nextTravelSchedule(characterId, intent);
        intent.scheduleVersion = scheduled.scheduleVersion;
        intent.scheduledJobId = scheduled.jobId;
        character.travelIntent = intent;
        await characterRepo.save(character);
        return { kind: 'wait' as const, intent: { ...intent }, delayMs: Math.max(500, startedBattle.endAt.getTime() - now + 250) };
      }

      if (intent.speedMutationPending === true) {
        // A speed/stat/equipment mutation is rebasing the stored fill rate. Do not
        // accrue under either rate until its post-mutation transaction clears the flag.
        const scheduled = this.nextTravelSchedule(characterId, intent);
        intent.scheduleVersion = scheduled.scheduleVersion;
        intent.scheduledJobId = scheduled.jobId;
        character.travelIntent = intent;
        await characterRepo.save(character);
        return { kind: 'wait' as const, intent: { ...intent }, delayMs: 500 };
      }

      const previousMapId = character.currentMapId;
      const previouslyPausedBattleId = String(intent.pausedBattleId ?? intent.fleeBattleId ?? '');
      intent.waitingForBattle = false;
      intent.pausedBattleId = null;
      if (previouslyPausedBattleId && !unresolved.some(entry => entry.id === previouslyPausedBattleId)) {
        // Normal battle resolution won before FLEE. Do not let the old retry target
        // a future encounter; its own pre-combat roll establishes a new retry window.
        intent.fleeRequested = false;
        intent.fleeBattleId = null;
        intent.fleeNextAttemptAt = null;
        character.fleeNextAttemptAt = null;
      }

      // World encounters are selected only after the current map's persisted search deadline.
      // The cycle/roll seed is independent from the combat simulation's RNG stream.
      const currentNode = this.dataService.getMapById(character.currentMapId);
      const encounterRouteIds = Array.isArray(intent.routeMapIds) ? intent.routeMapIds.map(String) : [];
      const encounterSegmentIndex = Math.max(0, Math.floor(Number(intent.segmentIndex ?? 0)));
      const encounterNextNode = this.dataService.getMapById(String(encounterRouteIds[encounterSegmentIndex + 1] ?? ''));
      const currentEdgeIsInstant = isInstantTownExitEdge(currentNode, encounterNextNode);
      if (intent.kind === 'route' && currentNode?.type === 'grind' && !currentEdgeIsInstant) {
        const cycle: any = { cycleIndex: 0, nextAt: null, ...(character.encounterCycle ?? {}) };
        let nextAt = Date.parse(String(cycle.nextAt ?? ''));
        if (!Number.isFinite(nextAt)) {
          const population = Math.max(1, await this.mapPresenceService.countActiveGrinders(character.currentMapId));
          const delay = deterministicIntInclusive(`${character.id}:${character.currentMapId}:${cycle.cycleIndex}:search-delay`, 2, 6) + population;
          const enteredAt = Date.parse(String(intent.lastAccruedAt ?? now));
          const searchBaseAt = Number.isFinite(enteredAt) ? Math.min(now, enteredAt) : now;
          nextAt = searchBaseAt + delay * 1000;
          cycle.nextAt = new Date(nextAt).toISOString();
          character.encounterCycle = cycle;
        }
        const lastAccruedAt = Date.parse(String(intent.lastAccruedAt ?? now));
        const lastDuration = Number(intent.lastDurationSeconds);
        const segmentProgress = Math.max(0, Math.min(1, Number(intent.segmentProgress ?? 0)));
        const expectedSegmentCompletionAt = Number.isFinite(lastAccruedAt) && Number.isFinite(lastDuration) && lastDuration > 0
          ? lastAccruedAt + (1 - segmentProgress) * lastDuration * 1000 : Number.POSITIVE_INFINITY;
        // If a late search deadline falls after the segment's historical arrival,
        // commit that arrival first rather than fighting on a map already left.
        if (Number.isFinite(nextAt) && nextAt <= now && !(Number.isFinite(expectedSegmentCompletionAt) && nextAt > expectedSegmentCompletionAt)) {
          const monsters = this.dataService.getMonstersInMap(character.currentMapId);
          if (monsters.length) {
            const encounterSeed = `${character.id}:${character.currentMapId}:${Number(cycle.cycleIndex ?? 0)}:world-encounter`;
            const monster: any = new Mulberry32(encounterSeed).weightedPick(monsters);
            const population = Math.max(1, await this.mapPresenceService.countActiveGrinders(character.currentMapId));
            const delay = deterministicIntInclusive(`${character.id}:${character.currentMapId}:${cycle.cycleIndex}:search-delay`, 2, 6) + population;
            const encounterAt = nextAt;
            cycle.cycleIndex = Number(cycle.cycleIndex ?? 0) + 1;
            cycle.nextAt = new Date(encounterAt + delay * 1000).toISOString();
            character.encounterCycle = cycle;
            const monsterDef = this.dataService.getMonsterById(monster.id);
            let avoid = !monsterDef?.isAggressive;
            if (!avoid) {
              const equipmentRows = await this.equipmentService.getEquipment(characterId);
              const gear = equipmentRows.map((row: any) => ({ ...row, definition: this.dataService.getItemById(row.itemId) }));
              // calculateWorldMoveSpeed already includes active status penalties; do not subtract them again.
              const worldSpeed = calculateWorldMoveSpeed(character, gear, character.activeTempBuffs ?? [], character.statusEffects ?? []);
              const chance = calculateFleeChancePercent(worldSpeed, Number(monsterDef?.moveSpd ?? 0), Number(character.luk ?? 5));
              avoid = new Mulberry32(`${character.id}:${character.currentMapId}:${cycle.cycleIndex - 1}:pre-combat-flee`).nextPercent() < chance;
            }
            if (avoid && Number.isFinite(expectedSegmentCompletionAt) && nextAt <= expectedSegmentCompletionAt && Date.parse(String(cycle.nextAt)) <= now) {
              // More deterministic search events occurred before the estimated segment
              // completion. Re-arm immediately and process the next event before arrival.
              const scheduled = this.nextTravelSchedule(characterId, intent);
              intent.scheduleVersion = scheduled.scheduleVersion;
              intent.scheduledJobId = scheduled.jobId;
              character.travelIntent = intent;
              await characterRepo.save(character);
              return { kind: 'wait' as const, intent: { ...intent }, delayMs: 0 };
            }
            if (!avoid) {
              // Preserve the movement accumulated up to the persisted encounter
              // boundary, not up to the time this delayed/recovered job happened
              // to run. From this boundary onward, travel is frozen until the
              // newly queued battle resolves or FLEE succeeds.
              const encounterLastAtRaw = Date.parse(String(intent.lastAccruedAt ?? now));
              const encounterLastAt = Number.isFinite(encounterLastAtRaw) ? encounterLastAtRaw : now;
              const beforeEncounter = accrueTravelSegmentProgress(
                segmentProgress, encounterLastAt, nextAt, lastDuration,
              );
              intent.segmentProgress = Math.max(0, Math.min(0.999999, beforeEncounter.progress));
              intent.lastAccruedAt = new Date(nextAt).toISOString();
              intent.waitingForBattle = true;
              intent.fleeRequested = true;
              intent.fleeAttemptIndex = 1; // the failed pre-combat roll is attempt zero
              intent.fleeBattleId = null; // BattleQueueService assigns the concrete ID after this transaction.
              character.fleeAttemptIndex = Math.max(Number(character.fleeAttemptIndex ?? 0), 1);
              character.fleeNextAttemptAt = new Date(now + 10_000);
              intent.fleeNextAttemptAt = character.fleeNextAttemptAt.toISOString();
              character.travelIntent = intent;
              await characterRepo.save(character);
              return { kind: 'encounter' as const, previousMapId, monsterId: String(monster.id), intent: { ...intent } };
            }
          }
        }
      }

      if (intent.kind === 'saved-town-teleport') {
        const destination = this.dataService.getMapById(String(intent.destinationMapId));
        if (!destination || destination.type !== 'town' || destination.id !== character.savedTownMapId) {
          character.travelIntent = null; character.pendingMapTransition = null; await characterRepo.save(character);
          return { kind: 'cancelled' as const, previousMapId };
        }
        character.currentMapId = destination.id;
        character.discoveredMapIds = Array.from(new Set([...(character.discoveredMapIds ?? [TOWN_MAP_ID]), destination.id]));
        character.status = 'town'; character.travelIntent = null; character.pendingMapTransition = null;
        character.encounterCycle = { ...(character.encounterCycle ?? {}), cycleIndex: Math.max(0, Number(character.encounterCycle?.cycleIndex ?? 0)) + 1, nextAt: null };
        character.gatheringCycle = { ...(character.gatheringCycle ?? {}), progress: 0, cycleIndex: Number(character.gatheringCycle?.cycleIndex ?? 0) + 1, varianceSeconds: null, lastUpdatedAt: new Date(now).toISOString() };
        character.lastSeenAt = new Date(now);
        await characterRepo.save(character);
        const futureRows = unresolved.map(entry => entry.id);
        if (futureRows.length) await queueRepo.delete({ id: In(futureRows), resolved: false });
        return { kind: 'committed' as const, previousMapId, currentMapId: destination.id, finished: true, cancelledBattleIds: futureRows, status: character.status };
      }

      let routeIds: string[] = Array.isArray(intent.routeMapIds) ? intent.routeMapIds.map(String) : [];
      if (!routeIds.length || routeIds[Number(intent.segmentIndex ?? 0)] !== character.currentMapId || intent.kind === 'legacy-transition') {
        const route = findCardinalRoute(this.dataService.getMaps(), character.currentMapId, String(intent.destinationMapId));
        if (!route.length) {
          character.travelIntent = null; character.pendingMapTransition = null; await characterRepo.save(character);
          return { kind: 'cancelled' as const, previousMapId };
        }
        routeIds = route.map(node => node.id); intent.kind = 'route'; intent.segmentIndex = 0; intent.segmentProgress = 0;
      }
      const segmentIndex = Math.max(0, Math.floor(Number(intent.segmentIndex ?? 0)));
      const nextMapId = routeIds[segmentIndex + 1];
      if (!nextMapId || character.currentMapId === intent.destinationMapId) {
        character.travelIntent = null; character.pendingMapTransition = null; character.status = this.dataService.getMapById(character.currentMapId)?.type === 'town' ? 'town' : 'grinding';
        await characterRepo.save(character);
        return { kind: 'finished' as const, previousMapId, currentMapId: character.currentMapId, status: character.status };
      }
      const source = this.dataService.getMapById(character.currentMapId);
      const destination = this.dataService.getMapById(nextMapId);
      if (!source || !destination || destination.isClickable === false) {
        character.travelIntent = null; character.pendingMapTransition = null; await characterRepo.save(character);
        return { kind: 'cancelled' as const, previousMapId };
      }

      if (isInstantTownExitEdge(source, destination)) {
        character.currentMapId = destination.id;
        character.discoveredMapIds = Array.from(new Set([...(character.discoveredMapIds ?? [TOWN_MAP_ID]), destination.id]));
        const finished = destination.id === intent.destinationMapId;
        character.status = destination.type === 'town' && finished ? 'town' : 'grinding';
        intent.routeMapIds = routeIds; intent.segmentIndex = segmentIndex + 1; intent.nextMapId = routeIds[segmentIndex + 2] ?? null;
        intent.segmentProgress = 0;
        // Instant edges have no elapsed travel time; preserve the prior historical boundary.
        intent.lastAccruedAt = String(intent.lastAccruedAt ?? new Date(now).toISOString());
        const followingNode = this.dataService.getMapById(String(routeIds[segmentIndex + 2] ?? ''));
        if (followingNode && !isInstantTownExitEdge(destination, followingNode)) {
          const equipmentRows = await this.equipmentService.getEquipment(characterId);
          const gear = equipmentRows.map((row: any) => ({ ...row, definition: this.dataService.getItemById(row.itemId) }));
          const nextSpeed = calculateWorldMoveSpeed(character, gear, character.activeTempBuffs ?? [], character.statusEffects ?? []);
          intent.lastDurationSeconds = nextSpeed > 0
            ? calculateTravelDurationSeconds(nextSpeed, Number(destination.mapLength ?? (destination.type === 'town' ? 0 : 25))) : null;
          intent.speedPaused = nextSpeed <= 0;
        } else { intent.lastDurationSeconds = null; intent.speedPaused = false; }
        character.gatheringCycle = { ...(character.gatheringCycle ?? {}), progress: 0, cycleIndex: Number(character.gatheringCycle?.cycleIndex ?? 0) + 1, varianceSeconds: null, lastUpdatedAt: new Date(now).toISOString() };
        character.encounterCycle = { ...(character.encounterCycle ?? {}), cycleIndex: Math.max(0, Number(character.encounterCycle?.cycleIndex ?? 0)) + 1, nextAt: null };
        if (finished) { character.travelIntent = null; character.pendingMapTransition = null; }
        else character.travelIntent = intent;
        character.lastSeenAt = new Date(now);
        await characterRepo.save(character);
        return { kind: 'committed' as const, previousMapId, currentMapId: destination.id, finished, continue: !finished, status: character.status, intent: character.travelIntent };
      }

      const equipmentRows = await this.equipmentService.getEquipment(characterId);
      const gear = equipmentRows.map((row: any) => ({ ...row, definition: this.dataService.getItemById(row.itemId) }));
      const speed = calculateWorldMoveSpeed(character, gear, character.activeTempBuffs ?? [], character.statusEffects ?? []);
      const durationSeconds = calculateTravelDurationSeconds(speed, Number(source.mapLength ?? (source.type === 'town' ? 0 : 25)));
      const lastAtRaw = Date.parse(String(intent.lastAccruedAt ?? now));
      const lastAt = Number.isFinite(lastAtRaw) ? lastAtRaw : now;
      const progress = Math.max(0, Math.min(1, Number(intent.segmentProgress ?? 0)));
      const previousDuration = Number(intent.lastDurationSeconds ?? durationSeconds);
      const accrual = accrueTravelSegmentProgress(progress, lastAt, now, previousDuration);
      intent.lastDurationSeconds = Number.isFinite(durationSeconds) ? durationSeconds : null;
      intent.speedPaused = speed <= 0;
      intent.routeMapIds = routeIds; intent.segmentIndex = segmentIndex; intent.nextMapId = nextMapId;
      if (accrual.completed) {
        character.currentMapId = destination.id;
        character.discoveredMapIds = Array.from(new Set([...(character.discoveredMapIds ?? [TOWN_MAP_ID]), destination.id]));
        intent.segmentIndex = segmentIndex + 1; intent.nextMapId = routeIds[segmentIndex + 2] ?? null;
        intent.segmentProgress = 0;
        const segmentCompletedAt = accrual.completedAt ?? now;
        intent.lastAccruedAt = new Date(segmentCompletedAt).toISOString();
        const followingNode = this.dataService.getMapById(String(routeIds[segmentIndex + 2] ?? ''));
        if (followingNode && !isInstantTownExitEdge(destination, followingNode)) {
          const followingEquipment = await this.equipmentService.getEquipment(characterId);
          const followingGear = followingEquipment.map((row: any) => ({ ...row, definition: this.dataService.getItemById(row.itemId) }));
          const followingSpeed = calculateWorldMoveSpeed(character, followingGear, character.activeTempBuffs ?? [], character.statusEffects ?? []);
          intent.lastDurationSeconds = followingSpeed > 0
            ? calculateTravelDurationSeconds(followingSpeed, Number(destination.mapLength ?? (destination.type === 'town' ? 0 : 25))) : null;
          intent.speedPaused = followingSpeed <= 0;
        } else { intent.lastDurationSeconds = null; intent.speedPaused = false; }
        character.gatheringCycle = { ...(character.gatheringCycle ?? {}), progress: 0, cycleIndex: Number(character.gatheringCycle?.cycleIndex ?? 0) + 1, varianceSeconds: null, lastUpdatedAt: new Date(now).toISOString() };
        character.encounterCycle = { ...(character.encounterCycle ?? {}), cycleIndex: Math.max(0, Number(character.encounterCycle?.cycleIndex ?? 0)) + 1, nextAt: null };
        const finished = destination.id === intent.destinationMapId || !intent.nextMapId;
        character.status = destination.type === 'town' && finished ? 'town' : 'grinding';
        character.travelIntent = finished ? null : intent;
        character.pendingMapTransition = null; character.lastSeenAt = new Date(now);
        await characterRepo.save(character);
        return { kind: 'committed' as const, previousMapId, currentMapId: destination.id, finished, continue: !finished, status: character.status, intent: character.travelIntent };
      }
      intent.segmentProgress = accrual.progress; intent.lastAccruedAt = new Date(now).toISOString();
      const scheduled = this.nextTravelSchedule(characterId, intent);
      intent.scheduleVersion = scheduled.scheduleVersion; intent.scheduledJobId = scheduled.jobId;
      character.travelIntent = intent;
      await characterRepo.save(character);
      const delayMs = 1000;
      return { kind: 'wait' as const, intent: { ...intent }, delayMs };
    }));

    if (result.kind === 'stale') return;
    if (result.kind === 'encounter') {
      const battle = await this.battleService.queueTravelEncounter(characterId, result.monsterId);
      if (battle) {
        // The failed pre-combat roll counts as attempt zero. The route resumes only after
        // battle resolution unless the independent retry succeeds and cancels this entry.
        const fresh = await this.characterRepo.findOne({ where: { id: characterId } });
        const intent: any = fresh?.travelIntent;
        if (intent) {
          intent.lastAccruedAt = battle.endAt.toISOString();
          intent.waitingForBattle = true;
          intent.fleeBattleId = battle.id;
          const scheduled = this.nextTravelSchedule(characterId, intent);
          intent.scheduleVersion = scheduled.scheduleVersion; intent.scheduledJobId = scheduled.jobId;
          const cycle: any = { cycleIndex: 0, nextAt: null, ...(fresh?.encounterCycle ?? {}) };
          const population = Math.max(1, await this.mapPresenceService.countActiveGrinders(String(fresh?.currentMapId ?? '')));
          const nextSearchSeconds = deterministicIntInclusive(`${characterId}:${fresh?.currentMapId}:${cycle.cycleIndex}:search-delay`, 2, 6) + population;
          cycle.cycleIndex = Number(cycle.cycleIndex ?? 0) + 1;
          cycle.nextAt = new Date(battle.endAt.getTime() + nextSearchSeconds * 1000).toISOString();
          await this.characterRepo.update({ id: characterId }, { travelIntent: intent, encounterCycle: cycle });
          await this.enqueueTravelSchedule(characterId, intent, Math.max(500, battle.endAt.getTime() - Date.now() + 250));
          await this.bullQueue.add('attempt-flee', { characterId, battleId: battle.id, generation: Number(intent.generation) }, { jobId: `flee-${battle.id}-g${Number(intent.generation)}-1-${Math.floor(Date.now()/1000)}`, delay: Math.max(0, Number(fresh?.fleeNextAttemptAt ? new Date(fresh.fleeNextAttemptAt).getTime() - Date.now() : 10_000)), removeOnComplete: true, attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
        }
      } else {
        await this.advanceTravel(characterId, Number(result.intent.generation));
      }
      return;
    }
    if (result.kind === 'wait') { await this.enqueueTravelSchedule(characterId, result.intent, result.delayMs); return; }
    if ('cancelledBattleIds' in result && result.cancelledBattleIds?.length) await this.battleService.removeBattleQueueJobs(result.cancelledBattleIds);
    if ('previousMapId' in result && result.previousMapId && result.currentMapId && result.previousMapId !== result.currentMapId) {
      try { await this.mapPresenceService.syncCharacter(characterId, result.previousMapId); }
      catch (error) { this.logger.warn(`Map presence sync failed during travel for ${characterId}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (result.kind === 'committed' && result.continue && result.intent) { await this.advanceTravel(characterId, Number(result.intent.generation)); return; }
    if (result.kind === 'committed' && result.finished && result.status === 'grinding') await this.scheduleStationaryActivity(characterId);
    if ((result.kind === 'finished' || (result.kind === 'committed' && result.finished)) && result.status === 'grinding') {
      await this.battleService.queueBattles(characterId, 5);
      await this.scheduleStationaryActivity(characterId);
    }
  }

  /** Restart durable travel/Gathering work when Redis jobs were lost or legacy transitions were migrated. */
  async recoverPendingActivities(): Promise<{ travel: number; gathering: number; flee: number }> {
    const characters = await this.characterRepo.find({ select: ['id', 'status', 'currentMapId', 'travelIntent', 'gatheringCycle', 'fleeNextAttemptAt', 'fleeAttemptIndex'] });
    let travel = 0, gathering = 0, flee = 0;
    for (const character of characters) {
      const intent: any = character.travelIntent;
      if (intent) {
        const jobId = String(intent.scheduledJobId ?? '');
        const currentJob = jobId ? await this.bullQueue.getJob(jobId).catch(() => null) : null;
        const currentState = currentJob ? await currentJob.getState().catch(() => 'missing') : 'missing';
        if (!currentJob || !['waiting', 'delayed', 'active', 'paused'].includes(String(currentState))) {
          if (currentJob && currentState === 'failed') await currentJob.remove().catch(() => undefined);
          try { await this.advanceTravel(character.id, Number(intent.generation)); travel += 1; }
          catch (error) { this.logger.warn(`Travel recovery failed for ${character.id}: ${error instanceof Error ? error.message : String(error)}`); }
        }
        if (intent.fleeRequested === true) {
          const active = await this.characterRepo.manager.getRepository(BattleQueueEntry).find({ where: { characterId: character.id, resolved: false }, order: { startAt: 'ASC' } });
          const now = Date.now();
          const battle = active.find(entry => entry.startAt.getTime() <= now && entry.endAt.getTime() > now);
          if (battle) {
            const jobs = await this.bullQueue.getJobs(['waiting', 'delayed', 'active', 'paused']).catch(() => [] as any[]);
            const existing = jobs.some(job => job.name === 'attempt-flee' && job.data?.characterId === character.id && job.data?.battleId === battle.id && Number(job.data?.generation) === Number(intent.generation));
            if (!existing) {
              const due = character.fleeNextAttemptAt ? new Date(character.fleeNextAttemptAt).getTime() : now + 1000;
              const dueAt = Math.max(now, Number.isFinite(due) ? due : now + 1000);
              await this.bullQueue.add('attempt-flee', { characterId: character.id, battleId: battle.id, generation: Number(intent.generation) }, {
                jobId: `flee-recovery-${battle.id}-g${Number(intent.generation)}-${Math.floor(dueAt/1000)}`,
                delay: Math.max(0, dueAt-now), removeOnComplete: true, attempts: 5, backoff: { type: 'exponential', delay: 1000 },
              });
              flee += 1;
            }
          }
        }
      } else if (character.status === 'grinding' && this.dataService.getMapById(character.currentMapId)?.type === 'grind') {
        const cycle: any = character.gatheringCycle ?? {};
        const jobId = String(cycle.scheduledJobId ?? '');
        const job = jobId ? await this.bullQueue.getJob(jobId).catch(() => null) : null;
        const state = job ? await job.getState().catch(() => 'missing') : 'missing';
        if (!job || !['waiting', 'delayed', 'active', 'paused'].includes(String(state))) {
          if (job && state === 'failed') await job.remove().catch(() => undefined);
          try { await this.scheduleStationaryActivity(character.id, 1000); gathering += 1; }
          catch (error) { this.logger.warn(`Gathering recovery failed for ${character.id}: ${error instanceof Error ? error.message : String(error)}`); }
        }
      }
    }
    return { travel, gathering, flee };
  }

  async resumeTravel(characterId: string): Promise<void> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (character?.travelIntent) await this.advanceTravel(characterId, Number(character.travelIntent.generation));
  }

  async setStance(characterId: string, stance: 'hunting' | 'gathering'): Promise<any> {
    if (!['hunting', 'gathering'].includes(stance)) throw new BadRequestException('Invalid stationary stance');
    const result = await this.battleService.withCharacterQueueLock(characterId, async () => this.characterRepo.manager.transaction(async manager => {
      const repo = manager.getRepository(Character); const queueRepo = manager.getRepository(BattleQueueEntry);
      const character = await repo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      const oldIntent = character.travelIntent; const previousJobId = oldIntent?.scheduledJobId;
      character.lastGrindStance = stance; character.travelIntent = null; character.pendingMapTransition = null; character.fleeNextAttemptAt = null; character.fleeAttemptIndex = 0;
      const pauseAt = new Date();
      if (oldIntent) character.gatheringCycle = { ...(character.gatheringCycle ?? {}), lastUpdatedAt: pauseAt.toISOString() };
      const map = this.dataService.getMapById(character.currentMapId);
      character.status = map?.type === 'town' ? 'town' : 'grinding';
      const unresolved = await queueRepo.find({ where: { characterId, resolved: false }, order: { startAt: 'ASC' } });
      const now = Date.now(); const active = unresolved.find(entry => entry.startAt.getTime() <= now);
      const cancelledBattleIds = unresolved.filter(entry => !active || entry.id !== active.id).map(entry => entry.id);
      if (cancelledBattleIds.length) await queueRepo.delete({ id: In(cancelledBattleIds), resolved: false });
      await repo.save(character);
      return { character, previousJobId, cancelledBattleIds, hasActiveBattle: !!active };
    }));
    if (result.previousJobId) await this.removeJob(String(result.previousJobId));
    if (result.cancelledBattleIds.length) await this.battleService.removeBattleQueueJobs(result.cancelledBattleIds);
    if (!result.hasActiveBattle && result.character.status === 'grinding') await this.battleService.queueBattles(characterId, 5);
    else await this.battleService.publishQueueUpdated(characterId);
    if (result.character.status === 'grinding') await this.scheduleStationaryActivity(characterId);
    const fresh = await this.characterRepo.findOne({ where: { id: characterId } });
    return fresh ? this.mapCharacterState(fresh) : this.mapCharacterState(result.character);
  }

  private async scheduleStationaryActivity(characterId: string, delayMs = 10_000): Promise<void> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character || character.status !== 'grinding' || character.travelIntent || this.dataService.getMapById(character.currentMapId)?.type !== 'grind') return;
    const cycle: any = character.gatheringCycle ?? { progress: 0, cycleIndex: 0, varianceSeconds: null, lastUpdatedAt: new Date().toISOString() };
    const jobId = `activity-${characterId}-${Number(cycle.cycleIndex ?? 0)}-${Math.floor(Date.now()/1000)}`;
    cycle.scheduledJobId = jobId;
    character.gatheringCycle = cycle;
    await this.characterRepo.save(character);
    await this.bullQueue.add('advance-stationary-activity', { characterId, cycleIndex: Number(cycle.cycleIndex ?? 0) }, { jobId, delay: Math.max(0, Math.ceil(delayMs)), removeOnComplete: true, attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
  }

  /** Accrue collection using persisted non-battle time, excluding every overlapping battle interval. */
  async advanceStationaryActivity(characterId: string, expectedCycleIndex?: number): Promise<void> {
    const result = await this.battleService.withCharacterQueueLock(characterId, async () => this.characterRepo.manager.transaction(async manager => {
      const repo = manager.getRepository(Character); const queueRepo = manager.getRepository(BattleQueueEntry);
      const character = await repo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) return { kind: 'stale' as const };
      if (character.status !== 'grinding' || character.travelIntent || this.dataService.getMapById(character.currentMapId)?.type !== 'grind') return { kind: 'stale' as const };
      const cycle: any = { progress: 0, cycleIndex: 0, varianceSeconds: null, lastUpdatedAt: new Date().toISOString(), ...(character.gatheringCycle ?? {}) };
      if (expectedCycleIndex !== undefined && Number(cycle.cycleIndex) !== expectedCycleIndex) return { kind: 'stale' as const };
      const now = Date.now();
      const lastAtRaw = Date.parse(String(cycle.lastUpdatedAt ?? now));
      const startAt = Number.isFinite(lastAtRaw) ? Math.min(now, lastAtRaw) : now;
      const fights = await queueRepo.createQueryBuilder('battle')
        .where('battle."characterId" = :characterId', { characterId })
        .andWhere('battle."startAt" < :now AND battle."endAt" > :startAt', { now: new Date(now), startAt: new Date(startAt) })
        .orderBy('battle."startAt"', 'ASC').getMany();
      const population = Math.max(1, await this.mapPresenceService.countActiveGrinders(character.currentMapId));
      const map = this.dataService.getMapById(character.currentMapId);
      const variance = cycle.varianceSeconds === null || cycle.varianceSeconds === undefined
        ? deterministicIntInclusive(`${character.id}:${character.currentMapId}:${cycle.cycleIndex}:gathering`, 0, 5)
        : Math.max(0, Math.min(5, Number(cycle.varianceSeconds)));
      cycle.varianceSeconds = variance;
      let cursor = startAt;
      let availableSeconds = 0;
      for (const battle of fights) {
        const from = Math.max(cursor, battle.startAt.getTime());
        // Successful FLEE truncates the actual occupied combat interval. Its immutable
        // scheduled endAt remains untouched for audit/replay and must not suppress
        // Gathering for the rest of a battle that was already cancelled.
        const cancelledAt = battle.cancellationReason === 'flee' && battle.cancelledAt
          ? battle.cancelledAt.getTime() : Number.POSITIVE_INFINITY;
        const effectiveBattleEndAt = Math.min(battle.endAt.getTime(), cancelledAt);
        const to = Math.min(now, effectiveBattleEndAt);
        if (from > cursor) availableSeconds += Math.max(0, from - cursor) / 1000;
        cursor = Math.max(cursor, to);
      }
      if (cursor < now) availableSeconds += (now - cursor) / 1000;
      let progress = Math.max(0, Math.min(0.999999999, Number(cycle.progress ?? 0)));
      let granted = 0;
      const grantedJournalRows: Array<{ itemId: string; cycleIndex: number }> = [];
      let cycleIndex = Math.max(0, Number(cycle.cycleIndex ?? 0));
      let remainingSeconds = availableSeconds;
      // Catch up in timestamp order. If a cycle's inventory grant cannot fit, that material is simply skipped.
      while (remainingSeconds > 0) {
        const duration = calculateGatheringDurationSeconds(Number(map.mapLength ?? 25), population, Number(character.gatheringLevel ?? 1), `${character.id}:${character.currentMapId}:${cycleIndex}:gathering`);
        const requiredSeconds = Math.max(0, (1 - progress) * duration);
        if (remainingSeconds + 1e-9 < requiredSeconds) { progress += remainingSeconds / duration; remainingSeconds = 0; break; }
        remainingSeconds -= requiredSeconds;
        if (Array.isArray(map.gatheringPool) && map.gatheringPool.length) {
          const roll = deterministicIntInclusive(`${character.id}:${character.currentMapId}:${cycleIndex}:material`, 1, 100);
          let total = 0; let selected: any = null;
          for (const entry of map.gatheringPool) { total += Number(entry.weight); if (roll <= total) { selected = entry; break; } }
          if (selected && await this.inventoryService.canFitInventoryDrop(characterId, String(selected.itemId), 1, manager)) {
            await this.inventoryService.addItem(characterId, String(selected.itemId), 1, 'inventory', undefined, manager);
            if (!(character.knownItemIds ?? []).includes(String(selected.itemId))) character.knownItemIds = [...(character.knownItemIds ?? []), String(selected.itemId)];
            grantedJournalRows.push({ itemId: String(selected.itemId), cycleIndex });
            granted += 1;
          }
        }
        cycleIndex += 1; progress = 0; cycle.varianceSeconds = null;
        // Avoid unbounded catch-up if a malformed persisted timestamp spans many years.
        if (cycleIndex > Number(cycle.cycleIndex ?? 0) + 1000) { remainingSeconds = 0; }
      }
      cycle.progress = progress;
      cycle.cycleIndex = cycleIndex;
      cycle.lastUpdatedAt = new Date(now).toISOString();
      character.gatheringCycle = cycle;
      await repo.save(character);
      return { kind: 'updated' as const, cycleIndex, granted, grantedJournalRows, mapId: String(character.currentMapId), hasProgress: progress > 0 };
    }));
    if (result.kind === 'updated') {
      await this.scheduleStationaryActivity(characterId, 10_000);
      if (result.granted > 0) await this.battleService.publishQueueUpdated(characterId);
      const mapName = String(this.dataService.getMapById(result.mapId)?.name ?? result.mapId);
      for (const awarded of result.grantedJournalRows) {
        const itemName = String(this.dataService.getItemById(awarded.itemId)?.name ?? awarded.itemId);
        await this.idleJournal.gathered(characterId, 1, itemName, mapName, `gather:${result.mapId}:${awarded.cycleIndex}`);
      }
    }
  }

  /** Save the exact Town map the character is settled in as their teleport waypoint. */
  async saveCurrentTown(characterId: string): Promise<{ savedTownMapId: string }> {
    return this.battleService.withCharacterQueueLock(characterId, () => this.characterRepo.manager.transaction(async manager => {
      const repo = manager.getRepository(Character);
      const character = await repo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      if (this.dataService.getMapById(character.currentMapId)?.type !== 'town' || character.status !== 'town' || (character.pendingMapTransition != null || character.travelIntent != null)) {
        throw new BadRequestException('Save here is only available while settled in a Town');
      }
      character.savedTownMapId = character.currentMapId;
      await repo.save(character);
      return { savedTownMapId: character.currentMapId };
    }));
  }

  async leaveMap(characterId: string): Promise<any> {
    const character=await this.characterRepo.findOne({where:{id:characterId}});
    if(!character) throw new NotFoundException('Character not found');
    if(this.dataService.getMapById(character.currentMapId)?.type==='town') return {deferred:false,character:{id:character.id,status:'town',currentMapId:character.currentMapId,lastSeenAt:character.lastSeenAt}};
    return this.enterMap(characterId,TOWN_MAP_ID);
  }

  /**
   * Get kill counter for a character on a map
   */
  async getKillCounter(characterId: string, mapId: string): Promise<MapKillCounter | null> {
    return this.mapKillCounterRepo.findOne({
      where: { characterId, mapId },
    });
  }

  /**
   * Get recommended maps for a character's level
   */
  async getRecommendedMaps(characterId: string): Promise<any[]> {
    const character = await this.characterRepo.findOne({
      where: { id: characterId },
    });
    if (!character) throw new NotFoundException('Character not found');

    return (await this.getMaps()).filter(map => map.type === 'grind' && map.id !== TOWN_MAP_ID)
      .filter(map => Number(map.recommendedLevel ?? 1) <= Number(character.level) + 5)
      .sort((a,b)=>Math.abs(Number(a.recommendedLevel??1)-character.level)-Math.abs(Number(b.recommendedLevel??1)-character.level)).slice(0,5);
  }

  async incrementKillCounter(characterId: string, monsterId: string): Promise<number> {
    // TODO: Implement counter increment
    // - Find or create counter entry
    // - Increment count
    // - Return updated count
    throw new Error('Not implemented');
  }

  /**
   * Get map details with encounter rates
   */
  async getMapDetails(mapId: string): Promise<any> {
    // TODO: Return detailed map info with monster pool
    throw new Error('Not implemented');
  }

  /**
   * Validate character level for map
   */
  async validateMapAccess(characterId: string, mapId: string): Promise<{ allowed: boolean; reason?: string }> {
    // TODO: Check level/quest requirements
    throw new Error('Not implemented');
  }
}
