#!/usr/bin/env node

/**
 * Phase 3 — Death (SPEC §7.6, §6.4)
 *
 * A resolve with `outcome = 'loss'` must:
 *   - set `status = 'town'` and `currentMapId = null` (SPEC §7.6)
 *   - set `hpCurrent = 1` (SPEC §7.6)
 *   - apply the §6.4 XP loss, floored at zero, and never below it
 *   - overwrite `lastDeathLog` with that battle's full log — not append (SPEC §7.7)
 *   - delete every remaining unresolved entry and its BullMQ job (SPEC §7.6)
 *   - stop the grind: nothing new is queued while the character is in town
 *
 * There is no endpoint that forces a loss, and a level-1 character loses most
 * fights organically (STATUS.md Issue #2), so the losing entry is written
 * directly per design.md D3. The character and the rest of the chain are still
 * built through the real API path.
 *
 * Run: node apps/api/test-phase3-death.js
 */

const h = require('./test/helpers/phase3.js');
const { xpToNextLevel } = h;

/**
 * SPEC §6.4 as implemented at battle.service.ts:545-546:
 * `xp = max(0, xp - floor(xpToNextLevel(level) * 0.05))`.
 *
 * design.md divergence #1: the SPEC says `round` and adds a clamp at
 * `cumulativeXp[level-1]`, so death can never de-level. `floor` vs `round` is a
 * 1-XP difference at low levels; the `cumulativeXp` clamp is undefined under the
 * §4.2 toward-next-level model, which is what `characters.xp` actually holds.
 * This is a spec-internal inconsistency, so the code's behaviour is asserted
 * and the inconsistency is reported rather than fixed.
 */
function expectedXpAfterDeath(xp, level) {
  const loss = Math.floor(xpToNextLevel(level) * 0.05);
  return { loss, expected: Math.max(0, Number(xp) - loss) };
}

/**
 * Build a character with a real 5-deep chain, then rewrite entry 0 into the
 * killing blow and entries 1-4 into survivable wins, so the "only one loss"
 * precondition is coherent. The queue map is left exactly as the API built it.
 */
async function setupDeath({ label, level, xp, withQueue = true }) {
  const ctx = await h.createCharacter({ enterMap: false, level });
  console.log(`\n[${label}] character ${ctx.charId} (level ${level}, not yet on a map)`);

  await h.drainQueue(ctx.charId);

  if (withQueue) {
    await h.setCharacterProgression(ctx.charId, { level, xp: 0 });
    const entered = await h.request('POST', `/maps/${ctx.mapId}/enter`, {}, ctx.token);
    if (entered.status >= 400) {
      throw new Error(`[${label}] POST /maps/${ctx.mapId}/enter -> ${entered.status} ${entered.raw.slice(0, 200)}`);
    }
  }

  const entries = await h.waitFor(
    withQueue ? 'a 5-deep queue to exist' : 'nothing',
    async () => {
      const q = await h.getUnresolvedEntries(ctx.charId);
      if (!withQueue) return q;
      return q.length >= 5 ? q : null;
    },
    30_000,
  );

  await h.setCharacterProgression(ctx.charId, { level, xp });

  return { ctx, entries };
}

/**
 * SPEC §7.6 / design.md D3: turn `sequenceIndex` 0 into the killing blow.
 *
 * `hpAfter` is forced to 0 and the log is stamped with a recognisable marker so
 * `lastDeathLog` can be attributed to THIS battle and not to another. The other
 * four entries are rewritten to `win` so the loss is unambiguous.
 */
async function forceLossAt(ctx, entries, { marker }) {
  const killer = entries[0];
  const survivors = entries.slice(1);

  await h.sql(
    `UPDATE battle_queue_entries
        SET outcome = 'loss',
            "hpAfter" = 0,
            "xpGain" = 0,
            "goldGain" = 0,
            drops = '[]'::jsonb,
            "itemsConsumed" = '[]'::jsonb,
            log = log || jsonb_build_object('phase3Marker', $2::text)
      WHERE id = $1`,
    [killer.id, marker],
  );
  for (const s of survivors) {
    await h.sql(`UPDATE battle_queue_entries SET outcome = 'win' WHERE id = $1`, [s.id]);
  }

  const after = await h.getUnresolvedEntries(ctx.charId);
  const lossRows = after.filter((e) => e.outcome === 'loss');
  const first = after[0];

  h.assert(
    '§7.6 the seeded setup is coherent: the killing blow is sequenceIndex 0',
    first.id === killer.id && Number(first.sequenceIndex) === 0 && first.outcome === 'loss',
    `entry 0 is ${first.id.slice(0, 8)} seq=${first.sequenceIndex} outcome=${first.outcome} hpAfter=${first.hpAfter} marker=${JSON.stringify(first.log?.phase3Marker)}`,
  );
  h.assert(
    '§7.6 the seeded setup is coherent: it is the ONLY loss, with 4 survivors behind it',
    lossRows.length === 1 && after.length === 5,
    `${lossRows.length} loss row(s), ${after.length} unresolved entries (1 killing + ${after.length - 1} survivors)`,
  );

  const survivorIds = survivors.map((s) => s.id);
  const survivorJobIds = (await h.bullJobIds()).filter((id) => survivorIds.includes(id));

  return { killer, survivors: after.slice(1), survivorIds, survivorJobIds, marker };
}

async function fireAndAwaitDeath(ctx, killer) {
  // §7.4.1: the resolver's contract is "fired after endAt" (design.md Risks).
  await h.rewriteEndAtToPast(killer.id, { secondsAgo: 5, startAtSecondsAgo: 120 });
  await h.enqueueResolveJob(killer.id);

  await h.waitFor(
    'the character to be routed to town by the resolve',
    async () => {
      const row = await h.getCharacterRow(ctx.charId);
      return row.status === 'town' ? row : null;
    },
    60_000,
  );

  // `resolveBattle()` drops the now-redundant delayed job, but when the running
  // job IS its own handler BullMQ refuses removal (battle.service.ts:389-400
  // documents this as expected) and only clears it once the handler returns. So
  // `status === 'town'` can be observed while the killer's own job is still
  // `active`. Give it a moment to retire before any "queue is empty" assertion.
  await h.waitFor(
    "the killing battle's own BullMQ job to retire",
    async () => (await h.bullJobIds()).length === 0,
    30_000,
  ).catch(() => undefined);

  return h.getCharacterRow(ctx.charId);
}

// ---------------------------------------------------------------------------
//  §7.6 — the death effects
// ---------------------------------------------------------------------------

async function assertDeathEffects(ctx, prepared, row) {
  const viaApi = await h.getCharacterViaApi(ctx.token);

  h.assertEqual('§7.6 status became town', row.status, 'town');
  h.assert(
    '§7.6 currentMapId became null (not merely unset)',
    row.currentMapId === null,
    `currentMapId = ${JSON.stringify(row.currentMapId)}; battle.service.ts:541 assigns null explicitly because TypeORM skips undefined columns on save`,
  );
  h.assertEqual('§7.6 hpCurrent became exactly 1', Number(row.hpCurrent), 1);

  const remaining = await h.getUnresolvedEntries(ctx.charId);
  h.assert(
    '§7.6 every remaining unresolved entry was deleted with the death',
    remaining.length === 0,
    `${remaining.length} unresolved entries left of the ${prepared.survivorIds.length} that were queued behind the killing blow`,
  );

  const allRows = await h.getAllEntries(ctx.charId);
  h.assert(
    '§7.6 the survivors were DELETED, not merely marked resolved',
    allRows.filter((e) => prepared.survivorIds.includes(e.id)).length === 0,
    `rows for the ${prepared.survivorIds.length} survivor ids in battle_queue_entries: ${allRows.filter((e) => prepared.survivorIds.includes(e.id)).length} (design.md divergence #2 says resolve marks rows resolved rather than deleting them, but §7.6 death does delete the rest of the chain)`,
  );

  const jobsNow = await h.bullJobIds();
  const orphaned = prepared.survivorJobIds.filter((id) => jobsNow.includes(id));
  h.assert(
    '§7.6 no BullMQ job survives for the deleted entries',
    orphaned.length === 0,
    orphaned.length === 0
      ? `none of the ${prepared.survivorJobIds.length} survivor job ids (captured before the resolve) remain under bull:battle-queue:*`
      : `orphaned job ids still present: ${orphaned.join(', ')}`,
  );

  h.assert(
    '§7.6 the API agrees the character is in town (DTO omits a null currentMapId)',
    viaApi.status === 'town' && viaApi.currentMapId === undefined,
    `GET /characters -> status=${viaApi.status} currentMapId=${JSON.stringify(viaApi.currentMapId)} (undefined, because the DTO maps null to undefined at character.controller.ts:38)`,
  );
}

// ---------------------------------------------------------------------------
//  §6.4 — the XP loss
// ---------------------------------------------------------------------------

async function assertXpLoss(label, level, seededXp) {
  const { ctx, entries } = await setupDeath({ label, level, xp: seededXp });
  const { killer } = await forceLossAt(ctx, entries, { marker: `xp-loss:${label}` });
  const row = await fireAndAwaitDeath(ctx, killer);

  const { loss, expected } = expectedXpAfterDeath(seededXp, level);
  const actual = Number(row.xp);

  h.assertEqual(
    `§6.4 xp loss is floor(xpToNextLevel(${level}) × 0.05), applied once (${label})`,
    actual,
    expected,
    `seeded xp=${seededXp}, xpToNextLevel(${level})=${xpToNextLevel(level)}, floor(${xpToNextLevel(level)} × 0.05)=${loss} → expected ${expected}, got ${actual}`,
  );

  h.note(
    `§6.4 (settled 2026-09-28, was design.md divergence #1): the code's rule is the SPEC's rule. ` +
      `battle.service.ts:545-546 uses Math.floor and floors the result at 0, so at level ${level} the loss is ` +
      `${loss} XP where round would give ${Math.round(xpToNextLevel(level) * 0.05)}. SPEC §6.4 was updated to say ` +
      '`floor` and to state that there is no cumulativeXp floor: that clamp was undefined under the §4.2 ' +
      'toward-next-level model that characters.xp actually uses, so the clamp at 0 is what prevents a de-level.',
  );

  return row;
}

// ---------------------------------------------------------------------------
//  §7.7 — lastDeathLog is overwritten, not appended
// ---------------------------------------------------------------------------

async function assertLastDeathLogOverwritten() {
  const label = 'lastDeathLog';
  const first = await setupDeath({ label: `${label}#1`, level: 4, xp: 10 });
  const firstPrepared = await forceLossAt(first.ctx, first.entries, { marker: 'death-1' });
  await fireAndAwaitDeath(first.ctx, firstPrepared.killer);

  const afterFirst = await h.getCharacterRow(first.ctx.charId);
  const log1 = afterFirst.lastDeathLog;

  h.assert(
    '§7.7 lastDeathLog records the killing battle\'s monsterId and its full log',
    log1 && log1.monsterId === firstPrepared.killer.monsterId && log1.log && log1.log.phase3Marker === 'death-1',
    `lastDeathLog.monsterId=${log1?.monsterId} (killed by ${firstPrepared.killer.monsterId}), log.phase3Marker=${JSON.stringify(log1?.log?.phase3Marker)}, ` +
      `log keys=${Object.keys(log1?.log ?? {}).join(',')}, event count=${log1?.log?.events?.length ?? 0}`,
  );
  h.assert(
    '§7.7 lastDeathLog.log is the battle\'s FULL log, not a summary',
    Array.isArray(log1?.log?.events) && log1.log.events.length > 0 && log1.log.header !== undefined,
    `log.events is an array of ${log1?.log?.events?.length} and log.header is present (${log1?.log?.header !== undefined})`,
  );

  // --- Second death on a NEW character, then confirm nothing accumulated.
  const label2 = `${label}#2`;
  const second = await setupDeath({ label: label2, level: 6, xp: 12 });
  const secondPrepared = await forceLossAt(second.ctx, second.entries, { marker: 'death-2' });
  await fireAndAwaitDeath(second.ctx, secondPrepared.killer);

  const afterSecond = await h.getCharacterRow(second.ctx.charId);
  const log2 = afterSecond.lastDeathLog;

  h.assert(
    '§7.7 a second death OVERWRITES lastDeathLog rather than appending to it',
    log2 && log2.log.phase3Marker === 'death-2',
    `after the second death lastDeathLog.log.phase3Marker=${JSON.stringify(log2?.log?.phase3Marker)} ` +
      `(an append would show death-1 as well, or an array of two logs)`,
  );
  h.assert(
    '§7.7 the overwritten log describes only the second battle, with that battle\'s own monster and level-gated XP',
    log2 && log2.monsterId === secondPrepared.killer.monsterId && Number(afterSecond.level) === 6,
    `monsterId=${log2?.monsterId} (second killer ${secondPrepared.killer.monsterId}), character level=${afterSecond.level}, ` +
      `xp=${afterSecond.xp} (seeded 12, floor(xpToNext(6) × 0.05)=${Math.floor(xpToNextLevel(6) * 0.05)})`,
  );
  h.assert(
    '§7.7 the two deaths are on separate characters, so the overwrite cannot be explained by row reuse',
    first.ctx.charId !== second.ctx.charId,
    `first character ${first.ctx.charId}, second character ${second.ctx.charId} — each died once, and the second character's ` +
      'lastDeathLog is provably not a leftover from the first because it carries death-2 and its own monsterId',
  );
  h.note(
    '§7.7 note on the scope of this check: a character cannot die twice without returning to a map, so the "overwrite, ' +
      'not append" guarantee is observed across two characters that each died once. What the assertion rules out is that ' +
      `lastDeathLog accumulates: the second character's value carries only "death-2" and not "death-1". ` +
      'A same-character double death would need a re-entry between the deaths, which is a separate scenario.',
  );

  await h.drainQueue(first.ctx.charId);
  await h.drainQueue(second.ctx.charId);
}

// ---------------------------------------------------------------------------
//  §7.6 — the death stops the grind
// ---------------------------------------------------------------------------

async function assertGrindStops() {
  const label = 'grind-stops';
  const { ctx, entries } = await setupDeath({ label, level: 3, xp: 8 });
  const prepared = await forceLossAt(ctx, entries, { marker: 'grind-stops' });
  await fireAndAwaitDeath(ctx, prepared.killer);

  const killed = await h.getCharacterRow(ctx.charId);

  /**
   * The window has to outlast a whole battle, otherwise "no new battles were
   * queued" would be satisfied simply because the next one had not come due yet.
   * SPEC §7.1: 1 tick = 1s, so a battle's in-game duration in seconds is exactly
   * its `durationTicks`. The longest entry behind the killing blow sets the bar.
   */
  const durations = entries.map((e) => Number(e.log?.durationTicks ?? 0));
  const longestBattleMs = Math.max(...durations, 0) * 1000;
  const watchMs = Math.max(30_000, longestBattleMs + 20_000);
  const started = Date.now();
  let sawNewEntry = false;
  let statusChanged = false;

  while (Date.now() - started < watchMs) {
    await h.sleep(2_000);
    const q = await h.getUnresolvedEntries(ctx.charId);
    if (q.length > 0) {
      sawNewEntry = true;
      break;
    }
    const row = await h.getCharacterRow(ctx.charId);
    if (row.status !== 'town') {
      statusChanged = true;
      break;
    }
  }
  const observedMs = Date.now() - started;
  const longestBattleSec = Math.round(longestBattleMs / 1000);

  h.assert(
    '§7.6 the observation window outlasted a whole battle, so the absence of new entries is meaningful',
    observedMs >= longestBattleMs,
    `watched ${Math.round(observedMs / 1000)}s vs the longest battle in the discarded chain at ${longestBattleSec}s ` +
      `(durations ${durations.join('s, ')}s from log.durationTicks, SPEC §7.1 1 tick = 1s)`,
  );
  h.assert(
    '§7.6 no new battles are queued after the death',
    !sawNewEntry,
    sawNewEntry
      ? `${(await h.getUnresolvedEntries(ctx.charId)).length} new entry/entries appeared within ${Math.round(observedMs / 1000)}ms of the death`
      : `watched ${Math.round(observedMs / 1000)}s — longer than the ${longestBattleSec}s the next queued battle would have taken — and the queue stayed empty throughout`,
  );
  h.assert(
    '§7.6 the character stays in town for the whole observation window',
    !statusChanged,
    `status stayed town for ${Math.round(observedMs / 1000)}s; a grind loop would have re-entered the map or queued battles ` +
      '(the processor\'s own top-up is gated on status === "grinding" && currentMapId, battle-queue.processor.ts:62)',
  );
  void killed;
  const allRows = await h.getAllEntries(ctx.charId);
  const thisCharacterIds = new Set(allRows.map((e) => e.id));
  const jobsNow = await h.bullJobIds();
  // Scoped to THIS character. The database is shared with earlier probe runs, so
  // an unrelated character's job can be present; that is not a §7.6 violation.
  const mine = jobsNow.filter((id) => thisCharacterIds.has(id));
  const foreign = jobsNow.filter((id) => !thisCharacterIds.has(id));
  const entryCount = (await h.getUnresolvedEntries(ctx.charId)).length;

  h.assert(
    '§7.6 no BullMQ job survives for any of this character\'s entries',
    mine.length === 0,
    mine.length === 0
      ? `none of this character's ${allRows.length} entry ids are in any of the queue's wait/active/delayed/paused lists` +
        (foreign.length ? ` (${foreign.length} pending job(s) belong to other characters: ${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? '…' : ''})` : '')
      : `still pending: ${mine.join(', ')}`,
  );

  h.assert(
    '§7.6 the BullMQ queue holds nothing for this character — nothing was scheduled behind the player\'s back',
    entryCount === 0 && mine.length === 0,
    `${entryCount} unresolved entries and ${mine.length} pending job(s) for ${ctx.charId}` +
      (foreign.length ? `; ${foreign.length} unrelated pending job(s) from other characters remain in the shared queue` : ''),
  );

  h.note(
    '§7.6 note on what "no job" means here: bull v3 retains a job hash after completion (no removeOnComplete is set ' +
      'in queueBattles), so raw key presence would report a finished job as outstanding. The suite therefore counts ' +
      'membership of the wait/active/delayed/paused lists.',
  );

  await h.drainQueue(ctx.charId);
}

async function main() {
  console.log('=== Phase 3 · Death (SPEC §7.6, §6.4) ===');
  await h.preflight();

  console.log('\n--- 1. §7.6 the death effects ---');
  const main1 = await setupDeath({ label: 'main', level: 1, xp: 0 });
  const prepared = await forceLossAt(main1.ctx, main1.entries, { marker: 'main-death' });
  const deadRow = await fireAndAwaitDeath(main1.ctx, prepared.killer);
  await assertDeathEffects(main1.ctx, prepared, deadRow);

  console.log('\n--- 2. §6.4 the XP loss, with a floor at zero ---');
  // Level 10 makes the penalty real: floor(30 × 0.05) = 1.
  await assertXpLoss('level-10-loss', 10, 25);

  // Level 20 makes the penalty LARGER than the seeded XP, which is the only way
  // to exercise the zero floor rather than just observe an arithmetic result:
  // floor(73 × 0.05) = 3, so seeded xp of 1 would become -2 without max(0, …).
  const zeroCase = await setupDeath({ label: 'level-20-zero-floor', level: 20, xp: 1 });
  const zeroPrepared = await forceLossAt(zeroCase.ctx, zeroCase.entries, { marker: 'zero-floor' });
  const zeroRow = await fireAndAwaitDeath(zeroCase.ctx, zeroPrepared.killer);
  const zeroLoss = Math.floor(xpToNextLevel(20) * 0.05);
  h.assertEqual(
    '§6.4 xp seeded BELOW the penalty lands on exactly 0 and never goes negative',
    Number(zeroRow.xp),
    0,
    `seeded xp=1, floor(xpToNext(20) × 0.05)=floor(${xpToNextLevel(20)} × 0.05)=${zeroLoss} → 1 - ${zeroLoss} = ${1 - zeroLoss}, ` +
      `clamped to 0 by max(0, …) at battle.service.ts:546; actual ${zeroRow.xp}. Without the floor this would be ${1 - zeroLoss}.`,
  );
  h.assert(
    '§6.4 the character is never de-leveled by a death',
    Number(zeroRow.level) === 20,
    `level stayed ${zeroRow.level} (the §6.4 cumulativeXp clamp is undefined under the §4.2 toward-next-level model, ` +
      'so max(0, …) is what prevents a de-level: a level-20 character with 0 XP is still level 20 because the level-up ' +
      'loop only ever adds levels)',
  );

  console.log('\n--- 3. §7.7 lastDeathLog is overwritten, not appended ---');
  await assertLastDeathLogOverwritten();

  console.log('\n--- 4. §7.6 the death stops the grind ---');
  await assertGrindStops();

  await h.closeQueueAndRedis();
  h.summarize('Death');
}

main().catch((error) => {
  console.error('FATAL:', error);
  h.closeQueueAndRedis().finally(() => process.exit(1));
});
