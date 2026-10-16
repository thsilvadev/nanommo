const assert = require('node:assert/strict');
const { ResetAllCharactersToCurrentTown1799000000000 } = require('../dist/apps/api/src/database/migrations/1799000000000-ResetAllCharactersToCurrentTown');

(async()=>{
  const queries=[];
  const migration=new ResetAllCharactersToCurrentTown1799000000000();
  await migration.up({async query(sql){queries.push(String(sql).replace(/\s+/g,' ').trim());}});
  assert.equal(queries.length,3,'migration uses one preservation snapshot, one queue cleanup and one character update');
  const preserve=queries[0];
  assert.match(preserve,/CREATE TEMP TABLE "town_reset_preserved_battles" ON COMMIT DROP/);
  assert.match(preserve,/WHERE "resolved" = false AND "startAt" <= NOW\(\)/);
  assert.match(preserve,/SELECT DISTINCT ON \("characterId"\)/);
  assert.match(preserve,/ORDER BY "characterId", "startAt" ASC, "sequenceIndex" ASC, "id" ASC/,'preserves the earliest already-started unresolved row per character');
  const deletion=queries[1];
  assert.match(deletion,/DELETE FROM "battle_queue_entries" b/);
  assert.match(deletion,/WHERE b\."resolved" = false/,'only unresolved battle rows can be deleted');
  assert.match(deletion,/NOT EXISTS \(SELECT 1 FROM "town_reset_preserved_battles" p WHERE p\."id" = b\."id"\)/,'preserved battle remains queued');
  assert.doesNotMatch(deletion,/resolved"\s*=\s*true/,'resolved battle history is never deleted');
  const update=queries[2];
  assert.match(update,/SET "currentMapId" = 'map_town'/);
  assert.match(update,/"status" = 'town'/);
  assert.match(update,/"pendingMapTransition" = CASE/);
  assert.match(update,/"stateVersion" = c\."stateVersion" \+ CASE/);
  assert.match(update,/"updatedAt" = NOW\(\)/);
  assert.doesNotMatch(update,/SET[^;]*"xp"\s*=|"level"\s*=|"gold"\s*=|"hpCurrent"\s*=|"spCurrent"\s*=|"diet"\s*=|"knownItemIds"\s*=/s,'unrelated character progression/state remains untouched');
  await assert.rejects(()=>migration.down(),/forward-only/);
  console.log('town-reset-migration: passed preservation boundary, resolved-history protection, location-only mutation and forward-only guard');
})().catch(error=>{console.error(error);process.exit(1)});
