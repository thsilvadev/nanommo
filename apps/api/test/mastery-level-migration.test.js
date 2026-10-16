const assert = require('node:assert/strict');
const { ReconcileMasteryLevelsForCumulativeXp1799100000000 } = require('../dist/apps/api/src/database/migrations/1799100000000-ReconcileMasteryLevelsForCumulativeXp');

(async()=>{
  const migration=new ReconcileMasteryLevelsForCumulativeXp1799100000000();
  const queries=[];
  await migration.up({async query(sql){queries.push(sql);}});
  assert.equal(queries.length,1,'migration is one conditional update');
  const sql=queries[0];
  assert.match(sql,/UPDATE "weapon_proficiencies"/);
  assert.match(sql,/WHEN GREATEST\(0, "xp"\) >= 20000 THEN 7/);
  assert.match(sql,/WHEN GREATEST\(0, "xp"\) >= 35000 THEN 8/);
  assert.match(sql,/WHERE "level" IS DISTINCT FROM CASE/,'idempotent comparison avoids needless row updates');
  const assignedColumns=[...sql.matchAll(/(?:SET|,)\s*\"([A-Za-z]+)\"\s*=/g)].map(match=>match[1]);
  assert.deepEqual(assignedColumns,['level'],'only the derived level column is assigned; XP/ranks/points/identity stay unchanged');
  await assert.rejects(()=>migration.down(),/forward-only/);
  console.log('mastery-level-migration: passed thresholds, single-field-only update, idempotency and forward-only guard');
})().catch(error=>{console.error(error);process.exit(1)});
