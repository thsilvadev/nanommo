#!/usr/bin/env node

/**
 * Re-runnable integration verification for OpenSpec change
 * character-mutation-queue-invalidation.
 *
 * Run: node apps/api/test-phase3-character-mutation-queue-invalidation.js
 * Uses the repository phase3 HTTP + PostgreSQL + Redis/Bull harness.
 */
const h = require('./test/helpers/phase3.js');

function ids(entries) { return entries.map(function (e) { return e.id; }); }
async function state(charId) {
  return { entries: await h.getUnresolvedEntries(charId), jobs: await h.bullJobIds() };
}
function assertRebuilt(label, before, after, predicate) {
  h.assert(label + ': old unresolved rows deleted', before.entries.every(function (old) { return !after.entries.some(function (e) { return e.id === old.id; }); }), 'old=' + ids(before.entries).join(',') + ' new=' + ids(after.entries).join(','));
  h.assert(label + ': old Bull jobs cancelled', before.jobs.every(function (id) { return !after.jobs.includes(id); }), 'oldJobs=' + before.jobs.join(',') + ' liveJobs=' + after.jobs.join(','));
  h.assert(label + ': replacement queue depth is 5', after.entries.length === 5, 'depth=' + after.entries.length);
  h.assert(label + ': replacement snapshot matches mutation', predicate(after.entries[0]), JSON.stringify(after.entries[0] && after.entries[0].log && after.entries[0].log.header && after.entries[0].log.header.characterSnapshot));
}

async function main() {
  console.log('=== Phase 3 · Character mutation queue invalidation ===');
  await h.preflight();
  const ctx = await h.createCharacter({ gambit: true, enterMap: false });
  await h.setCharacterProgression(ctx.charId, { unspentAttributePoints: 5 });
  await h.clearQueue(ctx.charId);
  await h.clearBullJobs();

  const entered = await h.request('POST', '/maps/' + ctx.mapId + '/enter', {}, ctx.token);
  h.assert('baseline map entry succeeds', entered.status === 200 || entered.status === 201, 'status=' + entered.status);
  let baseline = await h.waitFor('five-entry baseline queue', async function () {
    const q = await state(ctx.charId);
    return q.entries.length === 5 ? q : null;
  }, 30000);

  const beforeRow = await h.getCharacterRow(ctx.charId);
  const beforeStr = Number(beforeRow.str);
  const attr = await h.request('POST', '/characters/attributes/spend', { attributes: { str: 1 } }, ctx.token);
  h.assert('attribute spend succeeds between battles', attr.status === 200 || attr.status === 201, 'status=' + attr.status + ' body=' + attr.raw.slice(0, 160));
  const afterAttr = await h.waitFor('attribute queue rebuild', async function () {
    const q = await state(ctx.charId);
    return q.entries.length === 5 && q.entries.some(function (e) { return !baseline.entries.some(function (old) { return old.id === e.id; }); }) ? q : null;
  }, 30000);
  assertRebuilt('attribute spend', baseline, afterAttr, function (entry) {
    const s = entry.log && entry.log.header && entry.log.header.characterSnapshot;
    return s && Number(s.str) === beforeStr + 1;
  });
  baseline = afterAttr;

  const pageBRes = await h.request('POST', '/gambits', { slotIndex: 1, title: 'Mutation Test B', lines: [
    { priority: 1, conditions: [{ id: 'always' }], combinator: null, action: { id: 'defend' } },
    { priority: 2, conditions: [{ id: 'always' }], combinator: null, action: { id: 'attack' } },
  ] }, ctx.token);
  h.assert('inactive Gambit B creation succeeds', pageBRes.status === 200 || pageBRes.status === 201, 'status=' + pageBRes.status);
  const pageB = pageBRes.data;
  let q = await state(ctx.charId);
  h.assert('inactive Gambit creation does not invalidate queue', JSON.stringify(ids(q.entries)) === JSON.stringify(ids(baseline.entries)), 'queue changed');

  const inactiveEdit = await h.request('PUT', '/gambits/' + pageB.id, { title: 'Prepared B' }, ctx.token);
  h.assert('inactive Gambit edit succeeds', inactiveEdit.status === 200, 'status=' + inactiveEdit.status);
  q = await state(ctx.charId);
  h.assert('inactive Gambit edit preserves queue ids', JSON.stringify(ids(q.entries)) === JSON.stringify(ids(baseline.entries)), 'queue changed');

  const activateB = await h.request('PUT', '/gambits/' + pageB.id + '/activate', {}, ctx.token);
  h.assert('different Gambit activation succeeds', activateB.status === 200, 'status=' + activateB.status);
  const afterActivation = await h.waitFor('activation queue rebuild', async function () {
    const x = await state(ctx.charId);
    return x.entries.length === 5 && x.entries.some(function (e) { return !baseline.entries.some(function (old) { return old.id === e.id; }); }) ? x : null;
  }, 30000);
  assertRebuilt('Gambit activation', baseline, afterActivation, function (entry) {
    return Array.isArray(entry.log && entry.log.events) && entry.log.events.some(function (e) { return e.actor === 'character' && e.action === 'defend'; });
  });

  const noOpBefore = await state(ctx.charId);
  const noop = await h.request('PUT', '/gambits/' + pageB.id + '/activate', {}, ctx.token);
  h.assert('already-active activation is a no-op', noop.status === 200, 'status=' + noop.status);
  const noOpAfter = await state(ctx.charId);
  h.assert('already-active activation preserves queue ids', JSON.stringify(ids(noOpAfter.entries)) === JSON.stringify(ids(noOpBefore.entries)), 'queue changed');
  h.assert('already-active activation preserves Bull jobs', noOpBefore.jobs.every(function (id) { return noOpAfter.jobs.includes(id); }), 'jobs changed');

  const activeEdit = await h.request('PUT', '/gambits/' + pageB.id, { title: 'Edited Active B', lines: [
    { priority: 1, conditions: [{ id: 'always' }], combinator: null, action: { id: 'attack' } },
  ] }, ctx.token);
  h.assert('active Gambit edit succeeds', activeEdit.status === 200, 'status=' + activeEdit.status);
  const afterActiveEdit = await h.waitFor('active edit queue rebuild', async function () {
    const x = await state(ctx.charId);
    return x.entries.length === 5 && x.entries.some(function (e) { return !noOpBefore.entries.some(function (old) { return old.id === e.id; }); }) ? x : null;
  }, 30000);
  assertRebuilt('active Gambit edit', noOpBefore, afterActiveEdit, function (entry) {
    return !Array.isArray(entry.log && entry.log.events) || !entry.log.events.some(function (e) { return e.actor === 'character' && e.action === 'defend'; });
  });
  baseline = afterActiveEdit;

  const invalid = await h.request('PUT', '/gambits/' + pageB.id, { lines: [{ priority: 1, conditions: [{ id: 'not_a_real_condition' }], action: { id: 'attack' } }] }, ctx.token);
  h.assert('invalid active Gambit edit returns 400', invalid.status === 400, 'status=' + invalid.status);
  q = await state(ctx.charId);
  h.assert('failed Gambit validation preserves queue ids', JSON.stringify(ids(q.entries)) === JSON.stringify(ids(baseline.entries)), 'queue changed');

  const activeBefore = await state(ctx.charId);
  const first = activeBefore.entries[0];
  const activeSnapshotBefore = JSON.stringify(first.log && first.log.header && first.log.header.characterSnapshot);
  await h.sql('UPDATE battle_queue_entries SET "startAt" = NOW() - INTERVAL \'1 second\', "endAt" = NOW() + INTERVAL \'60 seconds\' WHERE id = $1', [first.id]);
  await h.enqueueResolveJob(first.id, { delay: 60_000 });
  await h.setCharacterProgression(ctx.charId, { unspentAttributePoints: 1 });
  const protectedBefore = await state(ctx.charId);
  const rowBefore = await h.getCharacterRow(ctx.charId);
  const activePageBefore = rowBefore.activeGambitPageId;

  const attrDuringBattle = await h.request('POST', '/characters/attributes/spend', { attributes: { agi: 1 } }, ctx.token);
  h.assert('attribute spend during battle succeeds', attrDuringBattle.status === 200 || attrDuringBattle.status === 201, 'status=' + attrDuringBattle.status + ' body=' + attrDuringBattle.raw.slice(0, 160));

  const afterAttrBattle = await state(ctx.charId);
  h.assert('attribute mutation preserves active battle id', afterAttrBattle.entries.some(function (e) { return e.id === first.id; }), 'active battle removed');
  h.assert('attribute mutation preserves active Bull job', afterAttrBattle.jobs.includes(first.id), 'active job removed');
  h.assert('attribute mutation preserves active snapshot', JSON.stringify(afterAttrBattle.entries.find(function (e) { return e.id === first.id; }).log && afterAttrBattle.entries.find(function (e) { return e.id === first.id; }).log.header.characterSnapshot) === activeSnapshotBefore, 'active snapshot changed');
  h.assert('attribute mutation removes stale future entries', afterAttrBattle.entries.length === 1, 'remaining=' + afterAttrBattle.entries.length);

  const activationDuringBattle = await h.request('PUT', '/gambits/' + ctx.gambitPageId + '/activate', {}, ctx.token);
  h.assert('Gambit activation during battle succeeds', activationDuringBattle.status === 200, 'status=' + activationDuringBattle.status);
  const editDuringBattle = await h.request('PUT', '/gambits/' + ctx.gambitPageId, { title: 'Edited During Active Battle' }, ctx.token);
  h.assert('active Gambit edit during battle succeeds', editDuringBattle.status === 200, 'status=' + editDuringBattle.status);

  const protectedAfter = await state(ctx.charId);
  const rowAfter = await h.getCharacterRow(ctx.charId);
  h.assert('active-battle mutations preserve queue ids', JSON.stringify(ids(protectedAfter.entries)) === JSON.stringify([first.id]), 'queue=' + ids(protectedAfter.entries).join(','));
  h.assert('active-battle mutations preserve Bull job', protectedAfter.jobs.includes(first.id), 'jobs=' + protectedAfter.jobs.join(','));
  h.assert('active-battle mutations update active Gambit', rowAfter.activeGambitPageId === ctx.gambitPageId, 'active page=' + rowAfter.activeGambitPageId);
  h.assert('active-battle mutations update attributes', Number(rowAfter.agi) === Number(rowBefore.agi) + 1, 'AGI=' + rowAfter.agi);
  h.assert('active-battle mutations preserve active snapshot', JSON.stringify(protectedAfter.entries[0].log && protectedAfter.entries[0].log.header.characterSnapshot) === activeSnapshotBefore, 'active snapshot changed');

  await h.sql('UPDATE battle_queue_entries SET "endAt" = NOW() - INTERVAL \'1 second\' WHERE id = $1', [first.id]);
  await h.enqueueResolveJob(first.id, { delay: 0 });
  const rebuiltAfterResolution = await h.waitFor('post-active-battle queue rebuild', async function () {
    const x = await state(ctx.charId);
    return x.entries.length === 5 && x.entries.some(function (e) { return e.id !== first.id; }) ? x : null;
  }, 30000);
  h.assert('post-resolution rebuild restores five-entry queue', rebuiltAfterResolution.entries.length === 5, 'depth=' + rebuiltAfterResolution.entries.length);
  h.assert('post-resolution rebuild uses updated attribute', rebuiltAfterResolution.entries.some(function (e) {
    const s = e.log && e.log.header && e.log.header.characterSnapshot;
    return s && Number(s.agi) === Number(rowBefore.agi) + 1;
  }), 'updated AGI not found in rebuilt snapshots');
  h.assert('post-resolution rebuild uses newly active Gambit', rebuiltAfterResolution.entries.some(function (e) {
    return Array.isArray(e.log && e.log.events) && e.log.events.some(function (event) {
      return event.actor === 'character' && event.action === 'attack';
    });
  }), 'rebuilt Gambit snapshot not observed');

  await h.clearQueue(ctx.charId);
  await h.clearBullJobs();
  await h.closeQueueAndRedis();
  await h.closePg();
  h.summarize();
}

main().catch(async function (error) {
  console.error('\n[FATAL] ' + (error.stack || error.message || error));
  try { await h.closeQueueAndRedis(); } catch {}
  try { await h.closePg(); } catch {}
  process.exit(1);
});
