const assert = require('node:assert/strict');
const { WorldTravelGatheringFlee1799600000000 } = require('../dist/apps/api/src/database/migrations/1799600000000-WorldTravelGatheringFlee');

(async () => {
  const migration = new WorldTravelGatheringFlee1799600000000();
  const statements = [];
  await migration.up({ query: async sql => { statements.push(String(sql)); return undefined; } });
  const sql = statements.join('\n');
  for (const column of ['lastGrindStance','travelIntent','gatheringLevel','gatheringCycle','encounterCycle','fleeAttemptIndex','fleeNextAttemptAt','startingSnapshot','cancellationReason','cancelledAt']) {
    assert.ok(sql.includes(`"${column}"`), `migration adds ${column}`);
  }
  assert.ok(sql.includes("DEFAULT 'hunting'"));
  assert.ok(sql.includes("DEFAULT 1"));
  assert.ok(sql.includes("'legacy-transition'"));
  assert.ok(sql.includes('"pendingMapTransition" = NULL'));
  assert.ok(sql.includes('battle."startAt" > now()'), 'only future unresolved legacy projections are removed');
  assert.ok(!sql.includes('savedTownMapId" = NULL'), 'existing saved Town waypoint is not erased');
  assert.equal(migration.name, 'WorldTravelGatheringFlee1799600000000');
  await assert.rejects(() => migration.down(), /forward-only/);
  console.log('world-travel-gathering-flee migration contract tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
