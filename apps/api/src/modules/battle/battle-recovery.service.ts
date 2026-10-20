import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { BattleQueueEntry } from '../../database/entities/battle-queue-entry.entity';
import { Character } from '../../database/entities/character.entity';
import { BattleService } from './battle.service';
import { BattleQueueGateService } from './battle-queue-gate.service';
import { MapPresenceService } from '../presence/map-presence.service';
import { DataService } from '../data/data.service';
import { In } from 'typeorm';
import { TOWN_MAP_ID } from '@nanommo/shared';
import { assertSafeMigrationHistory, inspectMigrationHistory } from '../../database/migration-safety';

/**
 * SPEC §7.5 — crash / restart recovery.
 *
 * `BattleQueueEntry` rows are the source of truth, not the BullMQ job state. On
 * boot, every unresolved entry whose `endAt < now()` is resolved in order
 * (oldest first) exactly as the scheduled job would have — applying effects,
 * deaths, drops and level-ups — and then the live queue depth is re-derived and
 * topped back up to 5 for any character still alive and still on a map.
 *
 * This runs from `onApplicationBootstrap`, which Nest fires inside
 * `app.listen()` *before* the HTTP port is bound, so recovery completes before
 * the API accepts its first request.
 */
@Injectable()
export class BattleRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BattleRecoveryService.name);

  constructor(
    @InjectRepository(BattleQueueEntry)
    private readonly battleQueueRepo: Repository<BattleQueueEntry>,
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly battleService: BattleService,
    private readonly mapPresenceService: MapPresenceService,
    private readonly queueGate: BattleQueueGateService,
    private readonly dataService: DataService,
    @InjectQueue('battle-queue') private readonly bullQueue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // The maintenance-only app context has no Bull processors and runs explicit
    // migrations before invoking runStoppedConsumerReconciliation().
    if (process.env.BATTLE_QUEUE_MAINTENANCE_ONLY === 'true') return;
    const startedAt = Date.now();
    await this.queueGate.acquireStartupLease();
    try {
      await this.queueGate.closeForStartup();
      await this.pauseQueueAndDrainActiveJobs();
      const migrationHistory = await inspectMigrationHistory(this.dataSource);
      assertSafeMigrationHistory(migrationHistory);
      if (migrationHistory.pendingMigrationNames.length > 0) {
        throw new Error(`Pending TypeORM migrations detected (${migrationHistory.pendingMigrationNames.join(', ')}). Run the explicit guarded migration command only after auditing migration history and while all API/Bull consumers are stopped. Queue gate remains closed.`);
      }
      this.logger.log('Battle queue startup gate closed, Bull consumers paused/drained, and migration history is current; beginning authoritative reconciliation');
      const before = await this.reconcilePersistedQueueAndJobs();
      await this.mapPresenceService.reconcileAllPresenceOrThrow();
      const resolvedCount = await this.resolveStaleBattles();
      const after = await this.reconcilePersistedQueueAndJobs();
      await this.mapPresenceService.reconcileAllPresenceOrThrow();
      const toppedUp = await this.topUpQueues();
      // Top-up creates fresh delayed jobs and can alter map membership if the
      // hunger boundary settles someone into Town, so rebuild the projection once more.
      await this.reconcilePersistedQueueAndJobs();
      await this.mapPresenceService.reconcileAllPresenceOrThrow();
      this.mapPresenceService.enablePeriodicReconciliation();
      // Bull remains globally paused while readiness is published, then resumes only after repair.
      await this.queueGate.markReady();
      await this.bullQueue.resume(false);
      await this.bullQueue.add('resume-world-activities', { requestedAt: new Date().toISOString() }, {
        jobId: `resume-world-activities-${Date.now()}`, delay: 250, removeOnComplete: true,
        attempts: 5, backoff: { type: 'exponential', delay: 1000 },
      });

      this.logger.log(
        `Battle startup reconciliation complete in ${Date.now() - startedAt}ms: ` +
          `removed ${before.removedRows + after.removedRows} stale queue row(s), resolved ${resolvedCount} stale battle(s), ` +
          `topped up ${toppedUp} character queue(s); workers may proceed`,
      );
    } catch (error) {
      // Fail closed. Do not bind the HTTP port or release processors if queue/DB/
      // Redis reconciliation cannot be proven complete.
      await this.queueGate.closeForStartup().catch(() => undefined);
      this.logger.error(
        `Battle startup reconciliation failed after ${Date.now() - startedAt}ms; queue remains paused and gate closed`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    } finally {
      try { await this.queueGate.releaseStartupLease(); }
      catch (error) { this.logger.error('Could not release battle queue startup lease; TTL will expire it', error instanceof Error ? error.stack : String(error)); }
    }
  }

  /**
   * Explicit reconciliation command for the controlled maintenance window.
   * Requires all real API/worker consumers to be stopped. Leaves Bull paused and
   * the Redis gate closed; only a later normal API startup may reopen processing.
   */
  async runStoppedConsumerReconciliation(): Promise<{ removedRows: number; resolvedBattles: number; toppedUp: number }> {
    if (process.env.BATTLE_QUEUE_MAINTENANCE_ONLY !== 'true' || process.env.CONFIRM_QUEUE_CONSUMERS_STOPPED !== '1') {
      throw new Error('Refusing queue maintenance without BATTLE_QUEUE_MAINTENANCE_ONLY=true and CONFIRM_QUEUE_CONSUMERS_STOPPED=1');
    }
    const startedAt = Date.now();
    await this.queueGate.acquireStartupLease();
    try {
      await this.queueGate.closeForStartup();
      await this.pauseQueueAndDrainActiveJobs();
      const migrationHistory = await inspectMigrationHistory(this.dataSource);
      assertSafeMigrationHistory(migrationHistory);
      if (migrationHistory.pendingMigrationNames.length > 0) {
        throw new Error(`Pending TypeORM migrations detected (${migrationHistory.pendingMigrationNames.join(', ')}). Audit and run the explicit guarded db:migrate command before queue maintenance.`);
      }
      const before = await this.reconcilePersistedQueueAndJobs();
      await this.mapPresenceService.reconcileAllPresenceOrThrow();
      const resolvedBattles = await this.resolveStaleBattles();
      const after = await this.reconcilePersistedQueueAndJobs();
      await this.mapPresenceService.reconcileAllPresenceOrThrow();
      const toppedUp = await this.topUpQueues();
      await this.reconcilePersistedQueueAndJobs();
      await this.mapPresenceService.reconcileAllPresenceOrThrow();
      this.logger.log(`Stopped-consumer reconciliation completed in ${Date.now() - startedAt}ms: removed ${before.removedRows + after.removedRows} stale row(s), resolved ${resolvedBattles} stale battle(s), topped up ${toppedUp} eligible queue(s); Bull intentionally remains paused and gate closed`);
      return { removedRows: before.removedRows + after.removedRows, resolvedBattles, toppedUp };
    } catch (error) {
      await this.queueGate.closeForStartup().catch(() => undefined);
      this.logger.error('Stopped-consumer reconciliation failed closed; Bull remains paused', error instanceof Error ? error.stack : String(error));
      throw error;
    } finally {
      try { await this.queueGate.releaseStartupLease(); }
      catch (error) { this.logger.error('Could not release maintenance lease; Redis TTL will expire it', error instanceof Error ? error.stack : String(error)); }
    }
  }

  private async pauseQueueAndDrainActiveJobs(): Promise<void> {
    // Global pause is shared by all Bull workers, not just this process. A job
    // already executing is allowed to finish before the maintenance snapshot.
    await this.bullQueue.pause(false);
    const deadline = Date.now() + 120_000;
    for (;;) {
      const counts = await this.bullQueue.getJobCounts();
      const active = Number((counts as any).active ?? 0);
      if (active === 0) return;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${active} active battle queue job(s) to drain; leaving queue paused`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  /**
   * Reconcile DB queue entries, Bull delayed jobs and Character location state
   * while every processor is held behind BattleQueueGateService.
   */
  private async reconcilePersistedQueueAndJobs(): Promise<{ removedRows: number }> {
    const characters = await this.characterRepo.find();
    const byId = new Map(characters.map(character => [character.id, character]));
    const unresolved = await this.battleQueueRepo.find({
      where: { resolved: false },
      order: { characterId: 'ASC', startAt: 'ASC', sequenceIndex: 'ASC' },
    });
    const grouped = new Map<string, BattleQueueEntry[]>();
    for (const row of unresolved) grouped.set(row.characterId, [...(grouped.get(row.characterId) ?? []), row]);
    const removeIds = new Set<string>();
    const now = Date.now();

    for (const character of characters) {
      const rows = grouped.get(character.id) ?? [];
      const currentMap = character.currentMapId ? this.dataService.getMapById(character.currentMapId) : null;
      if (character.pendingMapTransition) {
        const started = rows.find(row => new Date(row.startAt).getTime() <= now);
        for (const row of rows) if (!started || row.id !== started.id) removeIds.add(row.id);
        const targetTransition = started ? character.pendingMapTransition : null;
        const changed = character.currentMapId !== TOWN_MAP_ID || character.status !== 'town' ||
          JSON.stringify(character.pendingMapTransition ?? null) !== JSON.stringify(targetTransition);
        if (changed) {
          character.currentMapId = TOWN_MAP_ID;
          character.status = 'town';
          character.pendingMapTransition = targetTransition;
          character.lastSeenAt = new Date();
          await this.characterRepo.save(character);
        }
        continue;
      }

      const settledGrinding = character.status === 'grinding' && currentMap?.type === 'grind' && character.currentMapId !== TOWN_MAP_ID;
      if (!settledGrinding) {
        rows.forEach(row => removeIds.add(row.id));
        if (character.currentMapId !== TOWN_MAP_ID || character.status !== 'town' || character.pendingMapTransition != null) {
          character.currentMapId = TOWN_MAP_ID;
          character.status = 'town';
          character.pendingMapTransition = null;
          character.lastSeenAt = new Date();
          await this.characterRepo.save(character);
        }
        continue;
      }
      for (const row of rows) if (row.mapId !== character.currentMapId) removeIds.add(row.id);
    }

    // Orphan queue rows can remain if a Character was manually deleted without
    // its FK cascade being present in a legacy database.
    for (const [characterId, rows] of grouped) {
      if (!byId.has(characterId)) rows.forEach(row => removeIds.add(row.id));
    }

    const removed = [...removeIds];
    if (removed.length) await this.battleQueueRepo.delete({ id: In(removed), resolved: false });

    // Cancel every known delayed job whose authoritative row/Character no longer
    // permits it. Active jobs are never force-removed; after the gate opens they
    // see a missing row or ineligible Town character and exit as harmless no-ops.
    const liveRows = await this.battleQueueRepo.find({ where: { resolved: false } });
    const liveRowIds = new Set(liveRows.map(row => row.id));
    const liveByCharacter = new Map(characters.map(character => [character.id, character]));
    const jobs = await this.bullQueue.getJobs(['waiting', 'active', 'delayed', 'paused'] as any, 0, -1, true);
    for (const job of jobs) {
      let valid = true;
      if (job.name === 'resolve-battle') valid = liveRowIds.has(String(job.data?.battleId ?? job.id));
      else if (job.name === 'queue-battles') {
        const character = liveByCharacter.get(String(job.data?.characterId ?? ''));
        const map = character?.currentMapId ? this.dataService.getMapById(character.currentMapId) : null;
        valid = !!character && character.status === 'grinding' && !character.pendingMapTransition && map?.type === 'grind';
      } else continue;
      if (!valid && job.id != null) {
        const state = await job.getState().catch(() => 'unknown');
        if (state !== 'active') await job.remove().catch(error => this.logger.warn(`Unable to remove stale Bull job ${job.id}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    // Every unresolved DB battle must have a live resolve job. Repair missing or
    // already-finished jobs idempotently without changing its immutable battle row.
    for (const row of liveRows) {
      const job = await this.bullQueue.getJob(row.id);
      const state = job ? await job.getState().catch(() => 'unknown') : 'missing';
      if (job && ['waiting', 'active', 'delayed', 'paused'].includes(state)) continue;
      if (job) await job.remove().catch(() => undefined);
      await this.bullQueue.add('resolve-battle', { battleId: row.id }, {
        delay: Math.max(0, new Date(row.endAt).getTime() - Date.now()),
        jobId: row.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    }

    return { removedRows: removed.length };
  }

  /**
   * Resolve every unresolved entry whose `endAt` is already in the past,
   * oldest first. Ordering matters: a chain is sequential, so resolving seq=3
   * before seq=0 would apply HP/XP out of order.
   */
  private async resolveStaleBattles(): Promise<number> {
    const stale = await this.battleQueueRepo.find({
      where: { resolved: false, endAt: LessThan(new Date()) },
      order: { endAt: 'ASC', startAt: 'ASC', sequenceIndex: 'ASC' },
    });

    if (stale.length === 0) {
      this.logger.log('No stale unresolved battles found');
      return 0;
    }

    this.logger.log(
      `Found ${stale.length} stale unresolved battle(s) with endAt < now() - resolving oldest first`,
    );

    let resolved = 0;
    for (const battle of stale) {
      try {
        // Another earlier stale battle in this same chain may legitimately have
        // deleted this future row after its authoritative payout committed.
        if (!(await this.battleQueueRepo.findOne({ where: { id: battle.id, resolved: false } }))) continue;
        const resolvedByThisCall = await this.battleService.resolveBattle(battle.id);
        if (resolvedByThisCall) resolved += 1;
      } catch (error) {
        this.logger.error(`Failed to recover battle ${battle.id} (char=${battle.characterId} seq=${battle.sequenceIndex} ${battle.monsterId})`, error instanceof Error ? error.stack : undefined);
        throw error;
      }
    }

    return resolved;
  }

  /**
   * Re-derive live queue depth per character and top it back up to 5 for
   * characters still alive and still on a map (§7.4.3).
   */
  private async topUpQueues(): Promise<number> {
    const characters = await this.characterRepo.find({
      where: { status: 'grinding' },
    });

    let toppedUp = 0;
    for (const character of characters) {
      if (!character.currentMapId || character.pendingMapTransition || character.status !== 'grinding' || this.dataService.getMapById(character.currentMapId)?.type !== 'grind') continue;

      try {
        const queue = await this.battleService.getBattleQueue(character.id, 100);
        if (queue.length >= 5) continue;

        await this.battleService.queueBattles(character.id, 5);
        toppedUp += 1;
      } catch (error) {
        this.logger.error(
          `Failed to top up queue for character ${character.id}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }

    return toppedUp;
  }
}
