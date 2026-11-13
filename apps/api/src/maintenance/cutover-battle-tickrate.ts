import Bull, { Queue, Job } from 'bull';
import { AppDataSource } from '../database/data-source';
import { inspectMigrationHistory, assertSafeMigrationHistory } from '../database/migration-safety';
import { Character } from '../database/entities/character.entity';
import { BattleQueueEntry } from '../database/entities/battle-queue-entry.entity';
import { getRedisConnectionOptions } from '../config/redis.config';

/** Only jobs whose payloads depend on the obsolete combat/encounter queue are removed. */
export const TICKRATE_CUTOVER_JOB_NAMES = new Set([
  'resolve-battle',
  'queue-battles',
  'idle-journal-precombat',
  'advance-travel',
  'advance-stationary-activity',
  'attempt-flee',
  'resume-world-activities',
]);

const REQUIRED_MIGRATION = 'BattleTickDuration1800300000000';
const QUEUE_NAME = 'battle-queue';
const QUEUE_STATES = ['waiting', 'active', 'delayed', 'paused', 'completed', 'failed'] as const;

export interface CutoverPlan {
  database: string;
  characters: number;
  battleQueueEntries: number;
  activeBullJobs: number;
  obsoleteBullJobs: number;
  preservedCookingJobs: number;
  preservedCraftingJobs: number;
  obsoleteJobsByName: Record<string, number>;
}

export function isObsoleteTickrateJob(name: string): boolean {
  return TICKRATE_CUTOVER_JOB_NAMES.has(name);
}

export function buildTickrateCutoverCharacterPatch(): Partial<Character> {
  return {
    status: 'town',
    currentMapId: 'map_town',
    pendingMapTransition: null,
    travelIntent: null,
    gatheringCycle: { progress: 0, cycleIndex: 0, varianceSeconds: null, lastUpdatedAt: null },
    encounterCycle: { cycleIndex: 0, nextAt: null },
    fleeAttemptIndex: 0,
    fleeNextAttemptAt: null,
  };
}

function assertExplicitMaintenanceConfirmation(args: string[], env: NodeJS.ProcessEnv): boolean {
  const execute = args.includes('--execute');
  if (!execute && args.length === 0) return false;
  if (args.length !== 1 || args[0] !== '--execute') {
    throw new Error('Only --execute is supported. The default invocation is a read-only dry run.');
  }
  if (env.BATTLE_QUEUE_MAINTENANCE_ONLY !== 'true'
    || env.CONFIRM_QUEUE_CONSUMERS_STOPPED !== '1'
    || env.CONFIRM_BATTLE_TICKRATE_CUTOVER !== '500MS') {
    throw new Error('Refusing destructive cutover. Require BATTLE_QUEUE_MAINTENANCE_ONLY=true, CONFIRM_QUEUE_CONSUMERS_STOPPED=1, and CONFIRM_BATTLE_TICKRATE_CUTOVER=500MS after all API/Bull consumers have stopped.');
  }
  return true;
}

async function collectPlan(queue: Queue, dataSource = AppDataSource): Promise<{ plan: CutoverPlan; jobs: Job[] }> {
  const [databaseRow] = await dataSource.query('SELECT current_database() AS name');
  const characters = await dataSource.getRepository(Character).count();
  const battleQueueEntries = await dataSource.getRepository(BattleQueueEntry).count();
  const jobs = await queue.getJobs([...QUEUE_STATES], 0, -1, true);
  const obsoleteJobsByName: Record<string, number> = {};
  for (const job of jobs) {
    if (isObsoleteTickrateJob(job.name)) obsoleteJobsByName[job.name] = (obsoleteJobsByName[job.name] ?? 0) + 1;
  }
  const counts = await queue.getJobCounts();
  const plan: CutoverPlan = {
    database: String(databaseRow?.name ?? 'unknown'),
    characters,
    battleQueueEntries,
    activeBullJobs: Number(counts.active ?? 0),
    obsoleteBullJobs: jobs.filter(job => isObsoleteTickrateJob(job.name)).length,
    preservedCookingJobs: jobs.filter(job => job.name === 'complete-cooking').length,
    preservedCraftingJobs: jobs.filter(job => job.name === 'complete-crafting').length,
    obsoleteJobsByName,
  };
  return { plan, jobs };
}

async function assertCutoverSchema(dataSource = AppDataSource): Promise<void> {
  const history = await inspectMigrationHistory(dataSource);
  assertSafeMigrationHistory(history);
  if (history.pendingMigrationNames.length > 0) {
    throw new Error(`Pending migrations remain (${history.pendingMigrationNames.join(', ')}). Run the explicit guarded migration command while all consumers are stopped, then rerun this dry run.`);
  }
  if (!history.executedMigrationNames.includes(REQUIRED_MIGRATION)) {
    throw new Error(`Required migration ${REQUIRED_MIGRATION} is not recorded as applied; refusing to cut over an unmigrated battle_queue_entries table.`);
  }
}

async function executeCutover(queue: Queue, jobs: Job[], dataSource = AppDataSource): Promise<void> {
  const counts = await queue.getJobCounts();
  if (Number(counts.active ?? 0) > 0) {
    throw new Error(`Refusing cutover while ${counts.active} Bull job(s) are active. Stop every API/worker consumer and rerun the dry run.`);
  }

  // Pause the shared Bull queue and leave it paused. The normal API startup gate
  // performs fresh DB/Redis/map-presence reconciliation before it resumes jobs.
  await queue.pause(false);
  // Close the race between the first preflight count and Bull's global pause.
  // If a consumer began one last handler before pause took effect, leave the
  // queue paused and do not touch PostgreSQL until the operator drains it.
  const pausedCounts = await queue.getJobCounts();
  if (Number(pausedCounts.active ?? 0) > 0) {
    throw new Error(`Refusing cutover after Bull pause: ${pausedCounts.active} job(s) are still active. Queue remains paused; stop/drain every consumer and rerun the dry run.`);
  }

  await dataSource.transaction(async manager => {
    const characterRepo = manager.getRepository(Character);
    const battleRepo = manager.getRepository(BattleQueueEntry);
    const characters = await characterRepo.find({
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    const patch = buildTickrateCutoverCharacterPatch();
    for (const character of characters) Object.assign(character, patch);
    if (characters.length) await characterRepo.save(characters);

    // Preserve the Character → BattleQueueEntry lock ordering used by normal battle resolution.
    await battleRepo.createQueryBuilder().delete().from(BattleQueueEntry).execute();
  });

  // The DB transaction is already authoritative and safe to retry. If Redis job
  // removal fails, the queue remains paused; a second run can remove leftovers.
  for (const job of jobs) {
    if (!isObsoleteTickrateJob(job.name)) continue;
    await job.remove();
  }

  const remaining = await queue.getJobs([...QUEUE_STATES], 0, -1, true);
  const leftovers = remaining.filter(job => isObsoleteTickrateJob(job.name));
  if (leftovers.length) {
    throw new Error(`Cutover is incomplete: ${leftovers.length} obsolete Bull job(s) remain. Queue is paused; rerun the utility after investigating Redis.`);
  }
  const [remainingBattles] = await dataSource.query('SELECT COUNT(*)::int AS count FROM "battle_queue_entries"');
  if (Number(remainingBattles?.count ?? 0) !== 0) {
    throw new Error(`Cutover is incomplete: ${remainingBattles.count} battle queue row(s) remain. Queue is paused; rerun after investigating PostgreSQL.`);
  }
}

async function main(): Promise<void> {
  const execute = assertExplicitMaintenanceConfirmation(process.argv.slice(2), process.env);
  let queue: Queue | undefined;
  try {
    await AppDataSource.initialize();
    await assertCutoverSchema();
    queue = new Bull(QUEUE_NAME, { redis: getRedisConnectionOptions() });
    await queue.isReady();
    const { plan, jobs } = await collectPlan(queue);
    console.log(`[BattleTickrateCutover] ${execute ? 'EXECUTION PLAN' : 'READ-ONLY DRY RUN'}: ${JSON.stringify(plan, null, 2)}`);
    console.log('[BattleTickrateCutover] preserved persisted Cooking/Crafting sessions and complete-cooking/complete-crafting Bull jobs; no Character progression, inventory, currency, quests, Mastery, equipment, timed wall-clock buffs/cooldowns, or saved Town waypoint is modified.');
    if (!execute) {
      console.log('[BattleTickrateCutover] no writes performed. To execute, stop every API/Bull consumer and use the three explicit confirmation environment variables plus --execute.');
      return;
    }
    if (plan.activeBullJobs > 0) {
      throw new Error(`Refusing cutover while ${plan.activeBullJobs} Bull job(s) are active. Stop every API/worker consumer and rerun the dry run.`);
    }
    await executeCutover(queue, jobs);
    console.log('[BattleTickrateCutover] completed. All Characters are in map_town; battle_queue_entries and obsolete combat/encounter jobs are cleared. Bull remains globally paused. Start the new API only after reviewing this report; startup revalidates migration history, tick metadata, jobs and map presence before it resumes consumers.');
  } finally {
    await queue?.close().catch(() => undefined);
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

main().catch(error => {
  console.error('[BattleTickrateCutover] FAILED CLOSED:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
