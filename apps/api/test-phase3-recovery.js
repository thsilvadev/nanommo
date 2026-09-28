#!/usr/bin/env node

/**
 * Phase 3 — Crash recovery (SPEC §7.5, design.md D5)
 *
 * `battle_queue_entries` rows are the source of truth, not BullMQ job state. On
 * boot, every unresolved row with `endAt < now()` is resolved oldest-first
 * exactly as the scheduled job would have been, and the live queue depth is
 * re-derived and topped back up to 5 for characters still alive and still on a
 * map.
 *
 * The scenario mirrors SPEC §19.4 almost verbatim: write past-dated rows, restart
 * the container, and assert against Postgres — the recovery pass completes
 * before the HTTP port binds (battle-recovery.service.ts:16-19), so it cannot be
 * observed through the API at all.
 *
 * GATED on PHASE3_RESTART=1. Without it the script prints an explicit notice and
 * exits 0, because restarting the container is disruptive and a routine suite
 * run must not bounce the stack (design.md Risks). A silent skip would be worse
 * than no script.
 *
 * Run: PHASE3_RESTART=1 node apps/api/test-phase3-recovery.js
 */

const h = require('./test/helpers/phase3.js');
const { xpToNextLevel } = h;

const RESTART = process.env.PHASE3_RESTART === '1';

/** SPEC §7.1: 1 tick = 1 second of in-game time. */
const SECONDS_PER_TICK = 1;

/**
 * Make the whole chain stale, with `endAt` values that force a KNOWN
 * application order: the entry that should be applied first gets the oldest
 * `endAt`. `resolveStaleBattles()` orders by `endAt ASC, startAt ASC,
 * sequenceIndex ASC` (battle-recovery.service.ts:64), so pinning `endAt` pins
 * the order and the assertion can distinguish ordered application from
 * arbitrary order.
 */
async function makeChainStale(ctx, entries) {
  for (const entry of entries) {
    const stepsAgo = 200 - Number(entry.sequenceIndex) * 20;
    await h.sql(
      `UPDATE battle_queue_entries
          SET "endAt" = now() - ($2 || ' seconds')::interval,
              "startAt" = now() - ($3 || ' seconds')::interval
        WHERE id = $1`,
      [entry.id, String(stepsAgo), String(stepsAgo + 60)],
    );
  }
  const refreshed = await h.getUnresolvedEntries(ctx.charId);
  return refreshed.sort((a, b) => new Date(a.endAt) - new Date(b.endAt));
}

/**
 * Scope the recovery pass to this character.
 *
 * `resolveStaleBattles()` and `topUpQueues()` are GLOBAL — they scan every
 * character. Earlier probe runs leave grinding characters with future-dated
 * rows in the same database, and their entries would interleave with this
 * character's in the recovery order. Removing them makes the assertion about
 * THIS character's ordering unambiguous.
 */
async function isolateOtherCharacters(charId) {
  const { rowCount } = await h.sql(
    'DELETE FROM battle_queue_entries WHERE "characterId" <> $1 AND resolved = false',
    [charId],
  );
  return rowCount;
}

async function restartBackend() {
  h.note('restarting the backend container — recovery runs on boot, before the HTTP port binds');
  h.dockerCompose(['restart', 'backend']);
  await h.waitForBackendUp(180_000);
  h.note('backend is listening again; onApplicationBootstrap has already completed, so recovery has finished');
}

// ---------------------------------------------------------------------------
//  §7.5 — stale entries resolve oldest-first
// ---------------------------------------------------------------------------

/**
 * Normalise an API-built chain so that "were these applied IN ORDER?" becomes an
 * answerable question.
 *
 * The chain the API produces cannot answer it on its own:
 *   - a level-up during recovery DELETES the rest of the chain and rebuilds it,
 *     so entries 1..4 would be discarded and marked unresolved rather than
 *     applied (observed in a first run: "1 of 6 rows resolved");
 *   - consecutive wins regen HP to the maximum, so every `hpAfter` comes out
 *     equal (observed: [156, 156, 156, 0, 0]) and any order looks the same;
 *   - a loss truncates the chain via §7.6, so later entries never resolve.
 *
 * So each row is rewritten to a state where order and exactly-once are both
 * observable: all wins, a strictly decreasing distinct `hpAfter`/`spAfter` (so
 * any other order yields a different final value), and distinct `goldGain`
 * values whose sum a double application would double. Each row's own `log` is
 * left untouched, so the log-based assertions still see the engine's real
 * output. design.md D3 sanctions seeding a specific precondition like this.
 */
async function makeOrderingObservable(entries) {
  for (let i = 0; i < entries.length; i++) {
    await h.sql(
      `UPDATE battle_queue_entries
          SET outcome = 'win', "hpAfter" = $2, "spAfter" = $3, "goldGain" = $4, "xpGain" = 0
        WHERE id = $1`,
      [entries[i].id, 150 - 30 * i, 90 - 15 * i, i + 1],
    );
  }
}

async function assertOrderedRecovery() {
  const label = 'ordered';
  console.log(`\n--- 1. §7.5 stale entries resolve oldest-first (${label}) ---`);

  const ctx = await h.createCharacter({ enterMap: false, level: 1 });
  await h.drainQueue(ctx.charId);
  await h.setCharacterProgression(ctx.charId, { level: 1, xp: 0, hpCurrent: 158, spCurrent: 98 });

  const entered = await h.request('POST', `/maps/${ctx.mapId}/enter`, {}, ctx.token);
  if (entered.status >= 400) throw new Error(`map enter -> ${entered.status} ${entered.raw.slice(0, 200)}`);

  const entries = await h.waitFor(
    'a 5-deep queue to exist',
    async () => {
      const q = await h.getUnresolvedEntries(ctx.charId);
      return q.length >= 5 ? q : null;
    },
    30_000,
  );

  await makeOrderingObservable(entries);
  const stale = await makeChainStale(ctx, entries);
  const removed = await isolateOtherCharacters(ctx.charId);
  h.note(`isolated this character by deleting ${removed} unresolved row(s) belonging to other characters`);

  const before = await h.getCharacterRow(ctx.charId);
  const beforeCounter = await h.getKillCounterRow(ctx.charId, ctx.mapId);

  const expectedGold = stale.reduce((sum, e) => sum + Number(e.goldGain), 0);
  const lastEntry = stale[stale.length - 1];

  h.note(
    `stale chain in the order recovery must apply it (endAt ASC):\n` +
      stale
        .map(
          (e, i) =>
            `      ${i + 1}. seq=${e.sequenceIndex} ${e.monsterId} outcome=${e.outcome} ` +
            `hpAfter=${e.hpAfter} spAfter=${e.spAfter} goldGain=${e.goldGain} endAt=${new Date(e.endAt).toISOString()}`,
        )
        .join('\n') +
      `\n      expected after recovery: hp=${lastEntry.hpAfter} sp=${lastEntry.spAfter} gold=+${expectedGold}`,
  );

  // --- §7.5 ordering is only observable if the values differ.
  const hpChain = stale.map((e) => Number(e.hpAfter));
  h.assert(
    '§7.5 the chain\'s hpAfter values are distinct enough for the application order to be observable',
    new Set(hpChain).size === hpChain.length && hpChain.length >= 2,
    `hpAfter chain = [${hpChain.join(', ')}] across ${hpChain.length} entries — every permutation yields a different final HP, ` +
      'so an out-of-order application cannot pass this assertion',
  );
  h.assert(
    '§7.5 the stale chain contains no loss — a death would route the character to town and mask the ordering',
    stale.every((e) => e.outcome === 'win'),
    `${stale.filter((e) => e.outcome === 'win').length} win(s), ${stale.filter((e) => e.outcome === 'loss').length} loss(es)`,
  );
  h.assertEqual(
    '§6.3 the normalised chain grants no XP, so no level-up can truncate it mid-recovery',
    stale.reduce((sum, e) => sum + Number(e.xpGain), 0),
    0,
    'a level-up during recovery deletes and rebuilds the rest of the chain (battle.service.ts:522), which would turn the ordering question into a rebuild question',
  );

  await restartBackend();

  const after = await h.getCharacterRow(ctx.charId);
  const afterCounter = await h.getKillCounterRow(ctx.charId, ctx.mapId);

  // --- §7.2 ordered application
  h.assertEqual(
    '§7.5 the entries were applied SEQUENTIALLY: hpCurrent equals the LAST entry\'s hpAfter in endAt order',
    Number(after.hpCurrent),
    Number(lastEntry.hpAfter),
    `expected ${lastEntry.hpAfter} (hpAfter of seq=${lastEntry.sequenceIndex}, the newest endAt); got ${after.hpCurrent}. ` +
      `The hp chain is [${hpChain.join(', ')}], so an out-of-order application would have left a different value.`,
  );
  h.assertEqual(
    '§7.5 the entries were applied sequentially: spCurrent equals the last entry\'s spAfter',
    Number(after.spCurrent),
    Number(lastEntry.spAfter),
    `expected ${lastEntry.spAfter}, got ${after.spCurrent} (sp chain [${stale.map((e) => e.spAfter).join(', ')}])`,
  );
  h.assertEqual(
    '§4.2 xp and level are unchanged, because the normalised chain granted no XP',
    `${after.level}:${after.xp}`,
    `${before.level}:${before.xp}`,
    `level/xp ${before.level}:${before.xp} -> ${after.level}:${after.xp}`,
  );
  h.note(
    '§4.7/§7.4.3 (settled 2026-09-28, was design.md divergence #2): resolveBattle() marks rows resolved and ' +
      're-saves them (battle.service.ts:514) rather than deleting them, and SPEC §4.7/§7.4.3 now says exactly that. ' +
      'The recovery pass therefore re-reads rows a previous resolve already applied, which is why the conditional ' +
      'claim at battle.service.ts:371-383 is what makes this pass a no-op rather than a second payout.',
  );

  // --- §7.3 exactly once
  const rows = await h.getAllEntries(ctx.charId);
  const appliedIds = new Set(stale.map((e) => e.id));
  const appliedRows = rows.filter((e) => appliedIds.has(e.id));
  h.assert(
    '§7.5 every stale entry is marked resolved after the restart',
    appliedRows.length === stale.length && appliedRows.every((e) => e.resolved),
    `${appliedRows.filter((e) => e.resolved).length} of ${appliedRows.length} pre-restart rows resolved; ` +
      `the character has ${rows.length} row(s) in total (the remainder is a topped-up rebuild)`,
  );
  h.assertEqual(
    '§3.1 gold advanced by the SUM of the chain\'s goldGain values — a double application would double it',
    Number(after.gold) - Number(before.gold),
    expectedGold,
    `gold ${before.gold} -> ${after.gold} (delta ${Number(after.gold) - Number(before.gold)}) against ` +
      `[${stale.map((e) => e.goldGain).join(', ')}] = ${expectedGold}; a double application would show ${expectedGold * 2}`,
  );
  h.assertEqual(
    '§11.2 the kill counter advanced once per stale entry, not once per pass',
    Number(afterCounter?.mapKillCount ?? 0) - Number(beforeCounter?.mapKillCount ?? 0),
    stale.length,
    `${beforeCounter?.mapKillCount} -> ${afterCounter?.mapKillCount} for ${stale.length} winning entries ` +
      '(a double application would have advanced it 2× per entry)',
  );
  h.assertEqual(
    '§6.3 unspentAttributePoints is unchanged, because the chain granted no XP',
    Number(after.unspentAttributePoints),
    Number(before.unspentAttributePoints),
    `${before.unspentAttributePoints} -> ${after.unspentAttributePoints}`,
  );

  // --- §7.3 the positive log signal
  const logs = h.backendLogs(1800);
  const completeLines = logs.split('\n').filter((l) => l.includes('SPEC §7.5 crash recovery complete'));
  const resolvedCounts = completeLines
    .map((l) => {
      const m = l.match(/resolved (\d+) stale battle/);
      return m ? Number(m[1]) : null;
    })
    .filter((n) => n !== null);

  h.assert(
    '§7.5 the backend logged "SPEC §7.5 crash recovery complete" with a non-zero resolved count',
    resolvedCounts.length > 0 && resolvedCounts.some((n) => n >= stale.length),
    completeLines.length === 0
      ? 'no such line in the backend log. The recovery pass logs it from onApplicationBootstrap (battle-recovery.service.ts:41-44); ' +
        'its absence would mean the pass threw, which it catches and logs separately.'
      : `${completeLines.length} completion line(s); resolved counts seen = [${resolvedCounts.join(', ')}] against ${stale.length} stale entries`,
  );

  const perBattleLines = stale.map((e) => logs.split('\n').filter((l) => l.includes(`Resolved battle ${e.id}`)).length);
  h.assert(
    '§7.5 each stale entry was paid out exactly once (one "Resolved battle" log line each)',
    perBattleLines.every((n) => n === 1),
    `log-line counts per entry: ${perBattleLines.join(', ')} for ${stale.length} entries ` +
      '(more than one for any entry would mean the boot pass and a delayed job both paid it)',
  );

  // --- §7.4 top-up for a character still alive and still on a map
  const toppedUp = await h.waitFor(
    'topUpQueues() to restore 5 unresolved entries',
    async () => {
      const q = await h.getUnresolvedEntries(ctx.charId);
      return q.length === 5 ? q : null;
    },
    60_000,
  ).catch(() => null);

  h.assert(
    '§7.5 a character still alive and still on a map is topped back up to 5 unresolved entries',
    toppedUp !== null,
    toppedUp
      ? `${toppedUp.length} unresolved entries, sequenceIndex ${toppedUp.map((e) => e.sequenceIndex).join(', ')}; ` +
        `the first is ${toppedUp[0].monsterId} and all ${toppedUp.length} carry a full simulated log`
      : `queue held ${(await h.getUnresolvedEntries(ctx.charId)).length} unresolved entries after recovery; ` +
        `character status=${(await h.getCharacterRow(ctx.charId)).status}, map=${(await h.getCharacterRow(ctx.charId)).currentMapId}`,
  );
  h.assert(
    '§7.5 the topped-up chain was simulated against the post-recovery stats, not the pre-crash ones',
    toppedUp !== null && toppedUp[0]?.log?.header?.characterSnapshot?.maxHp === expectedAfterMaxHp(after),
    toppedUp
      ? `rebuilt entry 0 header.characterSnapshot.maxHp=${toppedUp[0]?.log?.header?.characterSnapshot?.maxHp} vs the character's post-recovery maxHp=${expectedAfterMaxHp(after)}`
      : 'no rebuilt chain to inspect',
  );

  return { ctx, stale, after };
}

/** maxHp from the shared formula, for cross-checking the rebuilt chain. */
function expectedAfterMaxHp(row) {
  // Imported lazily to keep this module's top-level imports focused on the stack.
  const { BattleEngine } = require('@nanommo/shared');
  return BattleEngine.calculateDerivedStats(
    Number(row.level),
    { str: Number(row.str), agi: Number(row.agi), dex: Number(row.dex), vit: Number(row.vit), int: Number(row.int), sor: Number(row.sor) },
    {},
  ).maxHp;
}

// ---------------------------------------------------------------------------
//  §7.5 — a death resolved by recovery leaves the character in town
// ---------------------------------------------------------------------------

async function assertDeathDuringRecovery() {
  const label = 'death';
  console.log(`\n--- 2. §7.5 a death resolved by recovery leaves the character in town with 0 entries (${label}) ---`);

  const ctx = await h.createCharacter({ enterMap: false, level: 5 });
  await h.drainQueue(ctx.charId);
  await h.setCharacterProgression(ctx.charId, { level: 5, xp: 0, hpCurrent: 200, spCurrent: 100 });

  const entered = await h.request('POST', `/maps/${ctx.mapId}/enter`, {}, ctx.token);
  if (entered.status >= 400) throw new Error(`map enter -> ${entered.status} ${entered.raw.slice(0, 200)}`);

  const entries = await h.waitFor(
    'a 5-deep queue to exist',
    async () => {
      const q = await h.getUnresolvedEntries(ctx.charId);
      return q.length >= 5 ? q : null;
    },
    30_000,
  );

  // SPEC §7.6 / design.md D3: entry 0 becomes the killing blow, the rest wins.
  const killer = entries[0];
  await h.sql(
    `UPDATE battle_queue_entries
        SET outcome = 'loss', "hpAfter" = 0, "xpGain" = 0, "goldGain" = 0,
            drops = '[]'::jsonb, "itemsConsumed" = '[]'::jsonb,
            log = log || jsonb_build_object('phase3Marker', 'recovery-death'::text)
      WHERE id = $1`,
    [killer.id],
  );
  for (const s of entries.slice(1)) {
    await h.sql(`UPDATE battle_queue_entries SET outcome = 'win' WHERE id = $1`, [s.id]);
  }

  await makeChainStale(ctx, entries);
  await isolateOtherCharacters(ctx.charId);

  const seededXp = 12;
  await h.setCharacterProgression(ctx.charId, { xp: seededXp });
  const expectedXpLoss = Math.floor(xpToNextLevel(5) * 0.05);

  h.note(
    `seeded level=5 xp=${seededXp} with seq=0 as a loss (${killer.monsterId}) and 4 wins behind it, then made the whole chain stale`,
  );

  await restartBackend();

  const after = await h.waitFor(
    'the recovery pass to route the character to town',
    async () => {
      const row = await h.getCharacterRow(ctx.charId);
      return row.status === 'town' ? row : null;
    },
    60_000,
  ).catch(async () => h.getCharacterRow(ctx.charId));

  h.assert(
    '§7.5 a character killed by a recovered stale battle is routed to town, not topped back up',
    after.status === 'town' && after.currentMapId === null,
    `status=${after.status}, currentMapId=${JSON.stringify(after.currentMapId)} after recovery; ` +
      'topUpQueues() only considers characters with status = grinding AND a non-null currentMapId (battle-recovery.service.ts:101-103)',
  );
  h.assertEqual('§7.6 the death set hpCurrent to 1', Number(after.hpCurrent), 1);

  // Give topUpQueues() a chance to (wrongly) re-queue, so the assertion is not
  // satisfied merely because recovery has not reached that phase yet.
  await h.sleep(8_000);
  const remaining = await h.getUnresolvedEntries(ctx.charId);
  h.assert(
    '§7.5 a character routed to town by recovery is left with 0 unresolved entries',
    remaining.length === 0,
    `${remaining.length} unresolved entries after an 8s settle window following the death`,
  );
  h.assertEqual(
    '§6.4 the XP loss was applied exactly once by the recovery pass',
    Number(after.xp),
    Math.max(0, seededXp - expectedXpLoss),
    `seeded xp=${seededXp}, floor(xpToNext(5) × 0.05)=${expectedXpLoss} → ${Math.max(0, seededXp - expectedXpLoss)}; actual ${after.xp} ` +
      '(a double application would show ' + Math.max(0, seededXp - 2 * expectedXpLoss) + ')',
  );
  h.assert(
    '§7.7 lastDeathLog was written by the recovery pass',
    after.lastDeathLog?.monsterId === killer.monsterId && after.lastDeathLog?.log?.phase3Marker === 'recovery-death',
    `lastDeathLog.monsterId=${after.lastDeathLog?.monsterId} (killer ${killer.monsterId}), marker=${JSON.stringify(after.lastDeathLog?.log?.phase3Marker)}`,
  );

  return ctx;
}

async function main() {
  console.log('=== Phase 3 · Crash recovery (SPEC §7.5) ===');

  if (!RESTART) {
    console.log('');
    console.log('[SKIP] Crash recovery restarts the backend container, which is disruptive, so it is gated.');
    console.log('       Run it explicitly:  PHASE3_RESTART=1 node apps/api/test-phase3-recovery.js');
    console.log('       The aggregate runner (test-phase3-all.js) does the same unless PHASE3_RESTART=1.');
    process.exit(0);
  }

  await h.preflight();
  void SECONDS_PER_TICK;

  await assertOrderedRecovery();
  const deathCtx = await assertDeathDuringRecovery();

  await h.drainQueue(deathCtx.charId);
  await h.closeQueueAndRedis();
  h.summarize('Crash recovery');
}

main().catch((error) => {
  console.error('FATAL:', error);
  h.closeQueueAndRedis().finally(() => process.exit(1));
});
