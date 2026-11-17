const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const cutover = require('../dist/apps/api/src/maintenance/cutover-character-3d.js');
const { assertCharacter3dCutoverComplete, CHARACTER_3D_CUTOVER_FLAG } = require('../dist/apps/api/src/config/character-3d-cutover.config.js');

const CONFIRMED = { BATTLE_QUEUE_MAINTENANCE_ONLY: 'true', CONFIRM_QUEUE_CONSUMERS_STOPPED: '1', CONFIRM_CHARACTER_3D_CUTOVER: 'TOWN' };

function fakeJob(name, removed) {
  return { name, remove: async () => { removed.push(name); } };
}
function harness({ active = 0, activeAfterPause = 0, characters, battles = 3, jobNames } = {}) {
  const log = [];
  const removed = [];
  const rows = characters ?? [
    { id: 'a', status: 'grinding', currentMapId: 'map_lv_1', travelIntent: { kind: 'route' }, pendingMapTransition: { destinationMapId: 'x' }, level: 9, gold: 50, str: 11, appearance: null, savedTownMapId: 'map_town_2', fleeAttemptIndex: 2, fleeNextAttemptAt: new Date() },
    { id: 'b', status: 'dead_pending_return', currentMapId: 'map_lv_6', travelIntent: null, pendingMapTransition: null, level: 3, gold: 7, str: 5, appearance: null, savedTownMapId: 'map_town' },
    { id: 'c', status: 'town', currentMapId: 'map_town', travelIntent: null, pendingMapTransition: null, level: 1, gold: 0, str: 5, appearance: null, savedTownMapId: 'map_town' },
  ];
  let battleRows = battles;
  let paused = false;
  const jobs = (jobNames ?? ['resolve-battle', 'queue-battles', 'advance-travel', 'attempt-flee', 'complete-cooking', 'complete-crafting']).map((name) => fakeJob(name, removed));
  const queue = {
    getJobCounts: async () => ({ active: paused ? activeAfterPause : active }),
    pause: async (local) => { assert.equal(local, false, 'the pause must be global'); paused = true; log.push('pause'); },
    getJobs: async () => jobs.filter((job) => !removed.includes(job.name)),
  };
  const characterRepo = {
    find: async (options) => { log.push(`find:${options?.lock?.mode}:${JSON.stringify(options?.order)}`); return rows; },
    save: async (entities) => { log.push('save'); return entities; },
    count: async () => rows.length,
  };
  const battleRepo = {
    createQueryBuilder: () => ({ delete: () => ({ from: () => ({ execute: async () => { log.push('delete-battles'); battleRows = 0; } }) }) }),
    count: async () => battleRows,
  };
  const dataSource = {
    transaction: async (work) => { log.push('tx'); return work({ getRepository: (entity) => (entity.name === 'Character' ? characterRepo : battleRepo) }); },
    getRepository: (entity) => (entity.name === 'Character' ? characterRepo : battleRepo),
    query: async (sql) => {
      if (/current_database/.test(sql)) return [{ name: 'nanommo_test' }];
      if (/"battle_queue_entries"/.test(sql)) return [{ count: battleRows }];
      if (/"appearance" IS NULL/.test(sql) && /<> 'town'/.test(sql)) return [{ count: rows.filter((r) => r.status !== 'town').length }];
      if (/"appearance" IS NULL/.test(sql)) return [{ count: rows.filter((r) => r.appearance == null).length }];
      return [{ count: 0 }];
    },
  };
  return { queue, jobs, dataSource, rows, log, removed, get paused() { return paused; } };
}

(async () => {
  // --- What the cutover changes, and what it must not ------------------------
  const patch = cutover.buildCharacter3dCutoverCharacterPatch();
  assert.deepEqual(patch, {
    status: 'town',
    currentMapId: 'map_town',
    pendingMapTransition: null,
    travelIntent: null,
    gatheringCycle: { progress: 0, cycleIndex: 0, varianceSeconds: null, lastUpdatedAt: null },
    encounterCycle: { cycleIndex: 0, nextAt: null },
    fleeAttemptIndex: 0,
    fleeNextAttemptAt: null,
  });
  assert.notEqual(cutover.buildCharacter3dCutoverCharacterPatch(), patch, 'each call returns a fresh patch');

  for (const name of ['resolve-battle', 'queue-battles', 'idle-journal-precombat', 'advance-travel', 'advance-stationary-activity', 'attempt-flee', 'resume-world-activities']) {
    assert.equal(cutover.isCharacter3dCutoverJob(name), true, `${name} is removed`);
  }
  for (const name of ['complete-cooking', 'complete-crafting', 'anything-else']) {
    assert.equal(cutover.isCharacter3dCutoverJob(name), false, `${name} is preserved`);
  }
  // Same job list as the proven 500 ms cutover.
  const tickrateSource = read('apps/api/src/maintenance/cutover-battle-tickrate.ts');
  const tickrateJobs = tickrateSource.slice(tickrateSource.indexOf('TICKRATE_CUTOVER_JOB_NAMES'), tickrateSource.indexOf(']);')).match(/'[a-z-]+'/g).map((s) => s.slice(1, -1));
  assert.deepEqual([...cutover.CHARACTER_3D_CUTOVER_JOB_NAMES].sort(), tickrateJobs.sort());

  // --- Explicit confirmation --------------------------------------------------
  assert.equal(cutover.assertExplicitMaintenanceConfirmation([], {}), false, 'no arguments is a read-only dry run');
  assert.equal(cutover.assertExplicitMaintenanceConfirmation(['--execute'], CONFIRMED), true);
  assert.throws(() => cutover.assertExplicitMaintenanceConfirmation(['--force'], CONFIRMED), /Only --execute/);
  assert.throws(() => cutover.assertExplicitMaintenanceConfirmation(['--execute', '--x'], CONFIRMED), /Only --execute/);
  for (const key of Object.keys(CONFIRMED)) {
    const env = { ...CONFIRMED };
    delete env[key];
    assert.throws(() => cutover.assertExplicitMaintenanceConfirmation(['--execute'], env), /Refusing/, `refuses without ${key}`);
  }
  assert.throws(() => cutover.assertExplicitMaintenanceConfirmation(['--execute'], { ...CONFIRMED, CONFIRM_CHARACTER_3D_CUTOVER: '500MS' }), /Refusing/, 'the 500 ms confirmation does not authorise this cutover');

  // --- Dry run reads only ------------------------------------------------------
  {
    const h = harness();
    const { plan } = await cutover.collectPlan(h.queue, h.dataSource);
    assert.equal(plan.database, 'nanommo_test');
    assert.equal(plan.characters, 3);
    assert.equal(plan.charactersWithoutAppearance, 3);
    assert.equal(plan.charactersOutsideTown, 2);
    assert.equal(plan.battleQueueEntries, 3);
    assert.equal(plan.cutoverBullJobs, 4);
    assert.deepEqual(plan.cutoverJobsByName, { 'resolve-battle': 1, 'queue-battles': 1, 'advance-travel': 1, 'attempt-flee': 1 });
    assert.equal(plan.preservedCookingJobs, 1);
    assert.equal(plan.preservedCraftingJobs, 1);
    assert.deepEqual(h.log, [], 'collecting the plan performs no transaction, save, delete or pause');
    assert.deepEqual(h.removed, []);
  }

  // --- Execution --------------------------------------------------------------
  {
    const h = harness();
    await cutover.executeCutover(h.queue, h.jobs, h.dataSource);
    assert.deepEqual(h.log, ['pause', 'tx', 'find:pessimistic_write:{"id":"ASC"}', 'save', 'delete-battles'], 'pause first, then lock characters in id order, then clear battles');
    for (const row of h.rows) {
      assert.equal(row.status, 'town');
      assert.equal(row.currentMapId, 'map_town');
      assert.equal(row.travelIntent, null);
      assert.equal(row.pendingMapTransition, null);
      assert.equal(row.fleeNextAttemptAt, null);
    }
    assert.deepEqual(h.rows.map((r) => [r.level, r.gold, r.str, r.savedTownMapId]), [[9, 50, 11, 'map_town_2'], [3, 7, 5, 'map_town'], [1, 0, 5, 'map_town']], 'progression and saved Town are untouched');
    assert.deepEqual(h.removed.sort(), ['advance-travel', 'attempt-flee', 'queue-battles', 'resolve-battle']);
    assert.equal(h.paused, true, 'Bull stays paused for the API startup gate to resume');

    // Safe to run again: nothing left to remove, still succeeds.
    h.log.length = 0;
    await cutover.executeCutover(h.queue, await h.queue.getJobs(), h.dataSource);
    assert.deepEqual(h.removed.sort(), ['advance-travel', 'attempt-flee', 'queue-battles', 'resolve-battle']);
  }
  {
    const h = harness({ active: 2 });
    await assert.rejects(cutover.executeCutover(h.queue, h.jobs, h.dataSource), /2 Bull job\(s\) are active/);
    assert.deepEqual(h.log, [], 'nothing is paused or written while a consumer is still running');
    assert.equal(h.rows[0].status, 'grinding');
  }
  {
    const h = harness({ activeAfterPause: 1 });
    await assert.rejects(cutover.executeCutover(h.queue, h.jobs, h.dataSource), /after Bull pause/);
    assert.deepEqual(h.log, ['pause'], 'PostgreSQL is not touched if a job slipped in before the pause');
    assert.equal(h.rows[0].status, 'grinding');
  }

  // --- Script source: guards that fakes cannot prove ---------------------------
  const source = read('apps/api/src/maintenance/cutover-character-3d.ts');
  assert.match(source, /'CharacterAppearance1800400000000'/, 'requires the appearance migration');
  assert.match(source, /pendingMigrationNames\.length > 0/);
  assert.match(source, /assertSafeMigrationHistory/);
  assert.match(source, /require\.main === module/, 'importing the module must not run the cutover');
  assert.ok(!/flushdb|flushall|DROP TABLE|TRUNCATE/i.test(source), 'never flushes Redis or drops data');
  for (const preserved of ['level', 'xp', 'gold', 'str', 'luk', 'savedTownMapId', 'hpCurrent', 'appearance', 'cookingSession', 'craftingSession']) {
    assert.ok(!(preserved in patch), `${preserved} is not part of the patch`);
  }

  // --- Startup guard -----------------------------------------------------------
  assert.equal(CHARACTER_3D_CUTOVER_FLAG, 'CHARACTER_3D_CUTOVER_COMPLETE');
  const ds = (rows) => { const calls = []; return { calls, query: async (sql) => { calls.push(sql); return rows; } }; };
  for (const env of [{}, { CHARACTER_3D_CUTOVER_COMPLETE: 'false' }, { CHARACTER_3D_CUTOVER_COMPLETE: 'TRUE' }, { CHARACTER_3D_CUTOVER_COMPLETE: '1' }, { CHARACTER_3D_CUTOVER_COMPLETE: '' }]) {
    const source = ds([]);
    await assert.rejects(assertCharacter3dCutoverComplete(env, source), /CHARACTER_3D_CUTOVER_COMPLETE/, `flag ${JSON.stringify(env)} refuses startup`);
    assert.equal(source.calls.length, 0, 'the flag is checked before any query');
  }
  {
    const clean = ds([]);
    await assertCharacter3dCutoverComplete({ CHARACTER_3D_CUTOVER_COMPLETE: 'true' }, clean);
    assert.equal(clean.calls.length, 1);
    const sql = clean.calls[0];
    assert.match(sql, /"appearance" IS NULL/);
    assert.match(sql, /"status" <> 'town'/);
    assert.match(sql, /"battle_queue_entries"/);
    assert.match(sql, /"resolved" = false/);
    assert.match(sql, /"characterId" = c\."id"/);
  }
  await assert.rejects(
    assertCharacter3dCutoverComplete({ CHARACTER_3D_CUTOVER_COMPLETE: 'true' }, ds([{ id: 'stray-1' }])),
    /stray-1.*cutover/s,
    'a character without appearance outside Town or with queued battles refuses startup even with the flag set',
  );
  const recovery = read('apps/api/src/modules/battle/battle-recovery.service.ts');
  assert.match(recovery, /await assertCharacter3dCutoverComplete\(process\.env, this\.dataSource\)/);
  assert.ok(recovery.indexOf('assertCharacter3dCutoverComplete(process.env') < recovery.indexOf('reconcilePersistedQueueAndJobs();'), 'the guard runs before any queue repair or top-up');
  assert.ok(recovery.indexOf('assertCharacter3dCutoverComplete(process.env') > recovery.indexOf('pendingMigrationNames.length > 0'), 'the guard runs after the pending-migration check, so the column exists');

  // --- Operator-facing wiring ---------------------------------------------------
  assert.match(read('.env.example'), /^CHARACTER_3D_CUTOVER_COMPLETE=false$/m);
  assert.match(read('.github/workflows/deploy-backend.yml'), /require_env CHARACTER_3D_CUTOVER_COMPLETE true/);
  const runbook = read('docs/deployment/character-3d-cutover.md');
  for (const needle of ['docker compose stop backend', 'show-migrations.js', 'run-migrations.js', 'cutover-character-3d.js', '--execute', 'CONFIRM_CHARACTER_3D_CUTOVER=TOWN', 'CHARACTER_3D_CUTOVER_COMPLETE=true', 'docker compose up -d backend', 'down -v']) {
    assert.ok(runbook.includes(needle), `runbook mentions ${needle}`);
  }
  assert.ok(runbook.indexOf('docker compose stop backend') < runbook.indexOf('--execute'), 'consumers stop before the destructive step');
  assert.ok(runbook.indexOf('--execute') < runbook.indexOf('CHARACTER_3D_CUTOVER_COMPLETE=true'), 'the flag is set only after the cutover');

  console.log('character-3d-cutover: patch, job allow-list, confirmations, dry run, guarded execution, startup guard and operator wiring passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
