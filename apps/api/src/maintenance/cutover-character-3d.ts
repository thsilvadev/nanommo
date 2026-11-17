import Bull, { Queue, Job } from 'bull';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../database/data-source';
import { inspectMigrationHistory, assertSafeMigrationHistory } from '../database/migration-safety';
import { Character } from '../database/entities/character.entity';
import { BattleQueueEntry } from '../database/entities/battle-queue-entry.entity';
import { getRedisConnectionOptions } from '../config/redis.config';

/**
 * 3D character cutover: park every Character in Town with nothing queued.
 * After it, a Character without an appearance stays in Town (the API blocks
 * its game actions) until its owner goes through the 3D creator.
 *
 * Mirrors the 500 ms cutover (cutover-battle-tickrate.ts). The job list and
 * the Character patch are intentionally the same; a test keeps them in step.
 */
export const CHARACTER_3D_CUTOVER_JOB_NAMES = new Set([
  'resolve-battle',
  'queue-battles',
  'idle-journal-precombat',
  'advance-travel',
  'advance-stationary-activity',
  'attempt-flee',
  'resume-world-activities',
]);

const REQUIRED_MIGRATION = 'CharacterAppearance1800400000000';
const QUEUE_NAME = 'battle-queue';
const QUEUE_STATES = ['waiting', 'active', 'delayed', 'paused', 'completed', 'failed'] as const;
const TAG = '[Character3dCutover]';

export interface Character3dCutoverPlan {
  database: string;
  characters: number;
  charactersWithoutAppearance: number;
  charactersOutsideTown: number;
  battleQueueEntries: number;
  activeBullJobs: number;
  cutoverBullJobs: number;
  cutoverJobsByName: Record<string, number>;
  preservedCookingJobs: number;
  preservedCraftingJobs: number;
}

export function isCharacter3dCutoverJob(name: string): boolean {
  return CHARACTER_3D_CUTOVER_JOB_NAMES.has(name);
}

/** Transient world state only. Progression, inventory, equipment, saved Town and HP/SP are never touched. */
export function buildCharacter3dCutoverCharacterPatch(): Partial<Character> {
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

/** Returns true only for an explicitly confirmed `--execute`; no arguments is a read-only dry run. */
export function assertExplicitMaintenanceConfirmation(args: string[], env: NodeJS.ProcessEnv): boolean {
  const execute = args.includes('--execute');
  if (!execute && args.length === 0) return false;
  if (args.length !== 1 || args[0] !== '--execute') {
    throw new Error('Only --execute is supported. The default invocation is a read-only dry run.');
  }
  if (env.BATTLE_QUEUE_MAINTENANCE_ONLY !== 'true'
    || env.CONFIRM_QUEUE_CONSUMERS_STOPPED !== '1'
    || env.CONFIRM_CHARACTER_3D_CUTOVER !== 'TOWN') {
    throw new Error('Refusing destructive cutover. Require BATTLE_QUEUE_MAINTENANCE_ONLY=true, CONFIRM_QUEUE_CONSUMERS_STOPPED=1, and CONFIRM_CHARACTER_3D_CUTOVER=TOWN after all API/Bull consumers have stopped.');
  }
  return true;
}

async function countQuery(dataSource: DataSource, sql: string): Promise<number> {
  const [row] = await dataSource.query(sql);
  return Number(row?.count ?? 0);
}

/** Read-only. */
export async function collectPlan(queue: Queue, dataSource: DataSource = AppDataSource): Promise<{ plan: Character3dCutoverPlan; jobs: Job[] }> {
  const [databaseRow] = await dataSource.query('SELECT current_database() AS name');
  const jobs = await queue.getJobs([...QUEUE_STATES], 0, -1, true);
  const cutoverJobsByName: Record<string, number> = {};
  for (const job of jobs) {
    if (isCharacter3dCutoverJob(job.name)) cutoverJobsByName[job.name] = (cutoverJobsByName[job.name] ?? 0) + 1;
  }
  const counts = await queue.getJobCounts();
  const plan: Character3dCutoverPlan = {
    database: String(databaseRow?.name ?? 'unknown'),
    characters: await dataSource.getRepository(Character).count(),
    charactersWithoutAppearance: await countQuery(dataSource, 'SELECT COUNT(*)::int AS count FROM "characters" WHERE "appearance" IS NULL'),
    charactersOutsideTown: await countQuery(dataSource, `SELECT COUNT(*)::int AS count FROM "characters" WHERE "appearance" IS NULL AND "status" <> 'town'`),
    battleQueueEntries: await dataSource.getRepository(BattleQueueEntry).count(),
    activeBullJobs: Number(counts.active ?? 0),
    cutoverBullJobs: jobs.filter(job => isCharacter3dCutoverJob(job.name)).length,
    cutoverJobsByName,
    preservedCookingJobs: jobs.filter(job => job.name === 'complete-cooking').length,
    preservedCraftingJobs: jobs.filter(job => job.name === 'complete-crafting').length,
  };
  return { plan, jobs };
}

async function assertCutoverSchema(dataSource: DataSource = AppDataSource): Promise<void> {
  const history = await inspectMigrationHistory(dataSource);
  assertSafeMigrationHistory(history);
  if (history.pendingMigrationNames.length > 0) {
    throw new Error(`Pending migrations remain (${history.pendingMigrationNames.join(', ')}). Run the explicit guarded migration command while all consumers are stopped, then rerun this dry run.`);
  }
  if (!history.executedMigrationNames.includes(REQUIRED_MIGRATION)) {
    throw new Error(`Required migration ${REQUIRED_MIGRATION} is not recorded as applied; refusing to cut over a characters table without the appearance columns.`);
  }
}

/** Safe to rerun: every step is idempotent and Bull is left paused on any failure. */
export async function executeCutover(queue: Queue, jobs: Job[], dataSource: DataSource = AppDataSource): Promise<void> {
  const counts = await queue.getJobCounts();
  if (Number(counts.active ?? 0) > 0) {
    throw new Error(`Refusing cutover while ${counts.active} Bull job(s) are active. Stop every API/worker consumer and rerun the dry run.`);
  }

  // Pause the shared Bull queue and leave it paused. The normal API startup gate
  // performs fresh DB/Redis/map-presence reconciliation before it resumes jobs.
  await queue.pause(false);
  // Close the race between the first count and Bull's global pause: if a consumer
  // began one last handler, leave the queue paused and do not touch PostgreSQL.
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
    for (const character of characters) Object.assign(character, buildCharacter3dCutoverCharacterPatch());
    if (characters.length) await characterRepo.save(characters);

    // Preserve the Character → BattleQueueEntry lock ordering used by normal battle resolution.
    await battleRepo.createQueryBuilder().delete().from(BattleQueueEntry).execute();
  });

  // The DB transaction is already authoritative and safe to retry. If Redis job
  // removal fails, the queue remains paused; a second run removes the leftovers.
  for (const job of jobs) {
    if (!isCharacter3dCutoverJob(job.name)) continue;
    await job.remove();
  }

  const remaining = await queue.getJobs([...QUEUE_STATES], 0, -1, true);
  const leftovers = remaining.filter(job => isCharacter3dCutoverJob(job.name));
  if (leftovers.length) {
    throw new Error(`Cutover is incomplete: ${leftovers.length} combat/encounter Bull job(s) remain. Queue is paused; rerun the utility after investigating Redis.`);
  }
  const remainingBattles = await countQuery(dataSource, 'SELECT COUNT(*)::int AS count FROM "battle_queue_entries"');
  if (remainingBattles !== 0) {
    throw new Error(`Cutover is incomplete: ${remainingBattles} battle queue row(s) remain. Queue is paused; rerun after investigating PostgreSQL.`);
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
    console.log(`${TAG} ${execute ? 'EXECUTION PLAN' : 'READ-ONLY DRY RUN'}: ${JSON.stringify(plan, null, 2)}`);
    console.log(`${TAG} every Character goes to map_town and all battle_queue_entries rows are deleted. Preserved: identity, level/XP, attributes, points, equipment, inventory, Gold, Soul Tokens, quests, Mastery, saved Town, HP/SP, Diet, and Cooking/Crafting sessions and their Bull jobs.`);
    if (!execute) {
      console.log(`${TAG} no writes performed. To execute, stop every API/Bull consumer and use the three explicit confirmation environment variables plus --execute.`);
      return;
    }
    if (plan.activeBullJobs > 0) {
      throw new Error(`Refusing cutover while ${plan.activeBullJobs} Bull job(s) are active. Stop every API/worker consumer and rerun the dry run.`);
    }
    await executeCutover(queue, jobs);
    console.log(`${TAG} completed. All Characters are in map_town; battle_queue_entries and combat/encounter jobs are cleared. Bull remains globally paused. Set CHARACTER_3D_CUTOVER_COMPLETE=true in the server .env, then start the API.`);
  } finally {
    await queue?.close().catch(() => undefined);
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`${TAG} FAILED CLOSED:`, error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
