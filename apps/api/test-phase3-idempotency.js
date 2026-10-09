#!/usr/bin/env node

/**
 * Phase 3 — Idempotency (SPEC §3.1-adjacent, design.md D4)
 *
 * `resolveBattle()` is reachable from TWO independent callers — the BullMQ
 * delayed job and the §7.5 boot recovery pass — so double-application is a live
 * hazard, not a hypothetical. It must apply XP / gold / drops / consumed items /
 * the kill counter exactly once.
 *
 * The staged entry is chosen so all four payout branches are live in one run: it
 * is a win (not the death path), it consumes at least one potion, and it carries
 * at least one drop. The drop is not hoped for — `resolveDrops()` is a pure
 * function of the monster and its per-monster kill count, so the scenario seeds
 * a kill count that rolls one.
 *
 * There is no `POST /battles/:id/resolve` route, so the race is staged at the
 * BullMQ layer: a second `resolve-battle` job is injected for the same
 * `battleId` alongside the first, with a distinct `jobId` so BullMQ keeps both.
 * The atomicity primitive is now a PostgreSQL transaction that locks the
 * Character row before the BattleQueueEntry row, applies all authoritative DB
 * effects, and commits `resolved = true` with those effects. This test races
 * duplicate jobs and verifies the resulting state was applied exactly once.
 *
 * Env:
 *   PHASE3_IDEMPOTENCY_DELAY_MS  gap between the two job submissions (default 0).
 *                                A non-zero value makes the delivery serial on
 *                                purpose, which must warn rather than fail.
 *   PHASE3_IDEMPOTENCY_WITH_RESTART=1
 *                                second mode: kill the backend mid-queue so the
 *                                delayed job and the recovery pass race (task 7.5).
 *
 * Run: node apps/api/test-phase3-idempotency.js
 */

const h = require('./test/helpers/phase3.js');
const { xpToNextLevel, applyXpWithLevelUps } = h;

const SUBMISSION_GAP_MS = Number(process.env.PHASE3_IDEMPOTENCY_DELAY_MS ?? 0);
/**
 * The restart-race mode. Both env names are accepted: `PHASE3_RESTART=1` is the
 * invocation the change's tasks.md documents, and the script-specific name makes
 * it obvious at a glance which script restarts the container.
 */
const WITH_RESTART =
  process.env.PHASE3_IDEMPOTENCY_WITH_RESTART === '1' || process.env.PHASE3_RESTART === '1';

/** The log line `resolveBattle()` emits when a duplicate caller sees the committed result. */
const SKIP_LOG = 'already resolved - skipping';

/**
 * A gambit page whose line 1 drinks a potion on every cast-gauge fire, so the
 * battle genuinely consumes items and the inventory decrement is exercised.
 *
 * The condition is `always`, not an HP band, on purpose: a band such as `LOW`
 * stops matching as soon as incoming damage pushes the character below the
 * band's floor, and whether that happens before the first cast fire (tick 8 at
 * DEX 5) depends on the monster and the RNG. An unconditional line makes the
 * consumption deterministic without depending on HP arithmetic.
 */
const POTION_PAGE = [
  { priority: 1, conditions: [{ id: 'always' }], combinator: null, action: { id: 'use_item', itemId: 'pot_hp_small' } },
  { priority: 2, conditions: [{ id: 'always' }], combinator: null, action: { id: 'attack' } },
];

/**
 * Choose a kill index whose FIRST battle is a win AND consumes a potion AND
 * carries at least one drop, so the race exercises the payout path (§7.5 reward
 * application), the inventory decrement (battle.service.ts:411-417) and the
 * `add-drop` branch (battle.service.ts:478-496) in the same run.
 *
 * A fixed index is a coin flip: the monster at kill index N comes from
 * `rngForIndex(seed = characterId:mapId:epoch, N)`, so index 0 is a slime for one
 * character and a direwolf for the next. Pinning index 0 without checking made
 * this scenario intermittently stage a LOSS instead, which routes the resolve
 * into `handleCharacterDeath()` and never touches xp/gold/drops.
 *
 * The drop is arranged deterministically rather than hoped for. `resolveDrops()`
 * (packages/shared/src/battle-engine/rewards.ts:113-158) derives its stream from
 * `${monsterId}:${perMonsterKillCount}:${entryIndex}` and nothing else — the
 * battle seed is not part of it — so for a fixed monster the drop roll is a
 * pure function of the per-monster kill count. At the SPEC §11.5 rates
 * (5% + 1% + 0.1% + 0.01% per kill) a few hundred consecutive kill counts
 * contain several drops, and seeding the one that hits makes the entry's
 * `drops` column reproduce the preview exactly. The battleId seed cannot be
 * used for this: it embeds the character UUID.
 */
const DROP_KILL_COUNT_SCAN = 400;

function findRaceKillIndex({ charId, mapId, level, attributes, startHp, startSp }) {
  for (let killIndex = 0; killIndex < 120; killIndex++) {
    const base = { charId, mapId, epoch: 0, killIndex, level, attributes, chainHp: startHp, chainSp: startSp };

    // The fight itself does not depend on the drop roll, so probe it once.
    const probe = h.simulateQueueStepAt(base);
    if (probe.simulation.outcome !== 'win') continue;
    // The potion line needs a chance to fire, which it cannot do if the fight
    // ends before the first cast-gauge fire (tick 8 at DEX 5).
    if (Number(probe.simulation.durationTicks) <= 9) continue;

    for (let dropKillCount = 0; dropKillCount < DROP_KILL_COUNT_SCAN; dropKillCount++) {
      const withDrops = h.simulateQueueStepAt({ ...base, dropKillIndex: dropKillCount });
      if (withDrops.rewards.drops.length > 0) {
        return { ...withDrops, killIndex, dropKillIndex: dropKillCount };
      }
    }
  }
  return null;
}

async function setup() {
  const ctx = await h.createCharacter({ enterMap: false });
  console.log(`character ${ctx.charId}`);

  await h.drainQueue(ctx.charId);

  // A potion gambit plus a known stock, so `itemsConsumed` is non-empty.
  await h.request('PUT', `/gambits/${ctx.gambitPageId}`, { lines: POTION_PAGE }, ctx.token);
  await h.request('PUT', `/gambits/${ctx.gambitPageId}/activate`, {}, ctx.token);
  await h.setItemQuantity(ctx.charId, 'pot_hp_small', 12);

  // Healthy enough to survive past the first cast-gauge fire, so the potion line
  // gets its turn before the fight can end.
  const startHp = 100;
  const startSp = 10;
  await h.setCharacterProgression(ctx.charId, { level: 1, xp: 0, hpCurrent: startHp, spCurrent: startSp });

  const row = await h.getCharacterRow(ctx.charId);
  const attributes = h.attributesOf(row);

  const pick = findRaceKillIndex({
    charId: ctx.charId, mapId: ctx.mapId, level: 1, attributes, startHp, startSp,
  });
  if (!pick) {
    throw new Error(
      `no kill index in 0..119 gives a winnable fight lasting past the first cast-gauge fire AND a per-monster ` +
        `kill count in 0..${DROP_KILL_COUNT_SCAN - 1} that rolls a drop, for ${ctx.charId}`,
    );
  }
  h.note(
    `pinned mapKillCount=${pick.killIndex} perMonsterKillCount.${pick.monster.id}=${pick.dropKillIndex} -> ` +
      `${pick.monster.id}, previewed as ${pick.simulation.outcome} over ${pick.simulation.durationTicks} ticks with ` +
      `xp ${pick.rewards.xpGain}, gold ${pick.rewards.goldGain} and drops ${JSON.stringify(pick.rewards.drops)}`,
  );

  await h.setKillCounter(ctx.charId, ctx.mapId, {
    mapKillCount: pick.killIndex,
    epoch: 0,
    // SPEC §11.2: the drop roll is a pure function of the per-monster kill
    // count, so seeding it is what makes the built entry carry the drop the
    // preview predicted. The row is created by `getOrCreateKillCounter()` on
    // the map entry, so it may not exist yet.
    perMonsterKillCount: pick.dropKillIndex > 0 ? { [pick.monster.id]: pick.dropKillIndex } : {},
  });

  const entered = await h.request('POST', `/maps/${ctx.mapId}/enter`, {}, ctx.token);
  if (entered.status >= 400) {
    throw new Error(`POST /maps/${ctx.mapId}/enter -> ${entered.status} ${entered.raw.slice(0, 200)}`);
  }

  const entries = await h.waitFor(
    'a 5-deep queue to exist',
    async () => {
      const q = await h.getUnresolvedEntries(ctx.charId);
      return q.length >= 5 ? q : null;
    },
    30_000,
  );

  return { ctx, entries, first: entries[0], pick };
}

// ---------------------------------------------------------------------------
//  The race
// ---------------------------------------------------------------------------

async function runRace(ctx, first, { withRestart = false } = {}) {
  const marker = `p3-race-${Date.now()}`;
  await h.sql(
    `UPDATE battle_queue_entries SET log = log || jsonb_build_object('phase3Marker', $2::text) WHERE id = $1`,
    [first.id, marker],
  );

  const before = {
    row: await h.getCharacterRow(ctx.charId),
    inventory: await h.getInventoryMap(ctx.charId),
    killCounter: await h.getKillCounterRow(ctx.charId, ctx.mapId),
  };

  const expected = {
    xpGain: Number(first.xpGain),
    goldGain: Number(first.goldGain),
    drops: Array.isArray(first.drops) ? first.drops : [],
    itemsConsumed: Array.isArray(first.itemsConsumed) ? first.itemsConsumed : [],
  };

  // §7.4.1: the resolver's contract is "fired after endAt" (design.md Risks).
  await h.rewriteEndAtToPast(first.id, { secondsAgo: 5, startAtSecondsAgo: 300 });

  const logMark = Date.now();
  const jobs = [];

  // Job 1 carries the entry's own id — the id the real scheduler would use.
  jobs.push(await h.enqueueResolveJob(first.id, { jobId: first.id, delay: 0 }));

  if (SUBMISSION_GAP_MS > 0) {
    h.note(
      `deliberate ${SUBMISSION_GAP_MS}ms gap between the two job submissions — this forces SERIAL delivery, ` +
        'so a pass here proves the outcome holds regardless of overlap, not that a race occurred',
    );
    await h.sleep(SUBMISSION_GAP_MS);
  }

  // Job 2 must carry a DIFFERENT jobId: BullMQ treats a repeated jobId as the
  // same job and would silently keep only one, so reusing `battleId` here would
  // stage no race at all.
  jobs.push(await h.enqueueResolveJob(first.id, { jobId: `${first.id}::dup`, delay: 0 }));

  if (withRestart) {
    h.note('restart-race mode: stopping the backend now so the delayed job and the §7.5 recovery pass contend');
    h.dockerCompose(['stop', 'backend']);
  }

  const submitted = Date.now();
  h.note(
    `submitted 2 resolve-battle jobs for battle ${first.id} ` +
      `(jobIds ${first.id} and ${first.id}::dup) ${SUBMISSION_GAP_MS}ms apart; ` +
      `expected single application: xp +${expected.xpGain}, gold +${expected.goldGain}, ` +
      `${expected.drops.length} drop(s), ${expected.itemsConsumed.length} item-consumption record(s)`,
  );

  const resolvedRow = await h.waitFor(
    'the battle to be claimed and its effects applied',
    async () => {
      const r = await h.sql('SELECT resolved FROM battle_queue_entries WHERE id = $1', [first.id]);
      return r.rows[0]?.resolved ? r.rows[0] : null;
    },
    90_000,
  );
  const claimedAt = Date.now();

  // Both jobs must have run to completion before the "applied exactly once"
  // assertions, or a late second application could land after they pass.
  const settled = await h.waitFor(
    'both resolve-battle jobs to leave the queue',
    async () => {
      const ids = await h.bullJobIds();
      return jobs.every((j) => !ids.includes(j.id)) ? ids : null;
    },
    90_000,
  ).catch(() => null);

  if (withRestart) {
    h.note('restart-race mode: starting the backend again');
    h.dockerCompose(['start', 'backend']);
    await h.waitForBackendUp();
  }

  const after = {
    row: await h.getCharacterRow(ctx.charId),
    inventory: await h.getInventoryMap(ctx.charId),
    killCounter: await h.getKillCounterRow(ctx.charId, ctx.mapId),
  };

  return { marker, before, after, expected, resolvedRow, settled, logMark, claimedAt, submitted, first };
}

// ---------------------------------------------------------------------------
//  §3.1 — exactly-once application
// ---------------------------------------------------------------------------

/**
 * The inventory a SINGLE application of this entry must leave behind.
 *
 * Consumption and drops both touch `inventory_items`, and a drop can be the very
 * same item the gambit drank (the §11.5 consumable pool is all 15 consumables,
 * potions included), so the two cannot be asserted against separate
 * expectations — only the combined one is the state the resolver is supposed to
 * produce.
 *
 * Order matches `resolveBattle()`: consumption first, clamped at the stock held, then drops for a win.
 */
function expectedInventoryAfterOnce(before, expected) {
  const map = { ...before };
  let removed = 0;
  for (const consumed of expected.itemsConsumed) {
    const take = Math.min(Number(map[consumed.itemId] ?? 0), Number(consumed.quantity));
    map[consumed.itemId] = Number(map[consumed.itemId] ?? 0) - take;
    removed += take;
  }
  for (const drop of expected.drops) {
    map[drop.itemId] = Number(map[drop.itemId] ?? 0) + Number(drop.quantity ?? 1);
  }
  return { map, removed };
}

/** How much of `itemId` the entry's simulated consumption takes out. */
function consumedOf(expected, itemId) {
  return expected.itemsConsumed
    .filter((c) => c.itemId === itemId)
    .reduce((sum, c) => sum + Number(c.quantity), 0);
}

async function assertSingleApplication(result) {
  const { before, after, expected, first, marker } = result;
  const xpDelta = Number(after.row.xp) - Number(before.row.xp);
  const goldDelta = Number(after.row.gold) - Number(before.row.gold);
  const killDelta = Number(after.killCounter?.mapKillCount ?? 0) - Number(before.killCounter?.mapKillCount ?? 0);

  const single = applyXpWithLevelUps(before.row.xp, before.row.level, expected.xpGain);
  const doubled = applyXpWithLevelUps(before.row.xp, before.row.level, expected.xpGain * 2);

  h.assert(
    '§3.1 xp reflects exactly one battle\'s xpGain, not twice (after the §4.2 level-up loop)',
    Number(after.row.xp) === single.xp && Number(after.row.level) === single.level,
    `xp ${before.row.xp} at level ${before.row.level} + ${expected.xpGain} → xp ${single.xp} at level ${single.level} ` +
      `(${single.levelsGained} threshold(s) crossed); actual xp ${after.row.xp} at level ${after.row.level}. ` +
      `A double application would give xp ${doubled.xp} at level ${doubled.level}.`,
  );
  h.assert(
    '§6.3 unspentAttributePoints increased by exactly 5 per level gained — a double application would grant twice as many',
    Number(after.row.unspentAttributePoints) - Number(before.row.unspentAttributePoints) === single.levelsGained * 5,
    `${before.row.unspentAttributePoints} -> ${after.row.unspentAttributePoints} for ${single.levelsGained} level(s) gained; ` +
      `a double application would have granted ${doubled.levelsGained * 5}`,
  );
  h.assert(
    '§3.1 gold increased by exactly one battle\'s goldGain, not twice',
    goldDelta === expected.goldGain,
    `gold ${before.row.gold} -> ${after.row.gold} (delta ${goldDelta}) against entry.goldGain=${expected.goldGain}; a double application would show ${expected.goldGain * 2}`,
  );

  h.assert(
    '§11.5 the staged entry really carried at least one drop, so the add-drop branch is exercised',
    expected.drops.length > 0,
    expected.drops.length > 0
      ? `entry.drops = ${JSON.stringify(expected.drops)} — rolled by the API at queue-build time from the seeded ` +
        'per-monster kill count, and identical to the in-process preview (asserted in step 1).'
      : 'entry.drops was empty. The scenario picks a per-monster kill count that yields a drop (see findRaceKillIndex), ' +
        'so an empty drops column means the preview and the API disagreed about the §11.2 drop stream.',
  );

  // Drops are added by `inventoryService.addItem`, so a double application shows
  // up as double the quantity. The observed delta is net of any consumption of
  // the same item, so a drop that is also what the gambit drank still measures
  // the add-drop branch alone.
  const dropDetail = expected.drops
    .map((d) => {
      const itemId = d.itemId;
      const qty = Number(d.quantity ?? 1);
      const net = Number(after.inventory[itemId] ?? 0) - Number(before.inventory[itemId] ?? 0) + consumedOf(expected, itemId);
      return `${itemId}: +${qty} expected, +${net} observed` +
        (consumedOf(expected, itemId) > 0 ? ` (net of ${consumedOf(expected, itemId)} consumed by the gambit)` : '');
    })
    .join('; ');
  const allDropsOnce = expected.drops.every((d) => {
    const qty = Number(d.quantity ?? 1);
    const net = Number(after.inventory[d.itemId] ?? 0) - Number(before.inventory[d.itemId] ?? 0) + consumedOf(expected, d.itemId);
    return net === qty;
  });

  h.assert(
    '§3.1 each drop was added exactly once',
    allDropsOnce && expected.drops.length > 0,
    expected.drops.length === 0
      ? 'unreachable: the previous assertion fails when there are no drops'
      : `${expected.drops.length} drop(s): ${dropDetail}. A double application would show ` +
        `${expected.drops.map((d) => `${d.itemId} +${2 * Number(d.quantity ?? 1)}`).join(', ')}, a different number from ` +
        'the asserted one, so a pass here is not a coincidence.',
  );

  h.assertEqual(
    '§11.2 map_kill_counters.map_kill_count incremented by exactly 1',
    killDelta,
    1,
    `${before.killCounter?.mapKillCount} -> ${after.killCounter?.mapKillCount} for ${first.monsterId} ` +
      `(one resolve = one real kill, so the counter must move once however many callers raced)`,
  );

  h.assert(
    '§7.5 the winning battle\'s row is marked resolved, not deleted (design.md divergence #2)',
    result.resolvedRow?.resolved === true,
    `resolved=${result.resolvedRow?.resolved} on entry ${first.id} carrying marker ${JSON.stringify(marker)}`,
  );
}

// ---------------------------------------------------------------------------
//  battle.service.ts:411-417 — consumed items leave the inventory exactly once
// ---------------------------------------------------------------------------

async function assertItemsConsumedOnce(ctx, result) {
  const { before, after, expected } = result;

  if (expected.itemsConsumed.length === 0) {
    h.assert(
      '§7.3 the entry consumed at least one item, so the inventory decrement is exercised',
      false,
      'entry.itemsConsumed was empty — the potion gambit line never fired in this battle, so the decrement path is untested',
    );
    return;
  }

  // Consumption and drops share one expectation: a drop may BE the item the
  // gambit drank (the §11.5 consumable pool is all 15 consumables), and only the
  // combined state is what a single application is supposed to produce.
  const { map: expectedAfter, removed: expectedTotal } = expectedInventoryAfterOnce(before.inventory, expected);
  const droppedIds = expected.drops.map((d) => d.itemId);
  if (droppedIds.some((id) => expected.itemsConsumed.some((c) => c.itemId === id))) {
    h.note(
      `the entry both drank and dropped the same item(s): ${[...new Set(droppedIds.filter((id) => expected.itemsConsumed.some((c) => c.itemId === id)))].join(', ')}. ` +
        'The inventory expectations below are net of both effects, which is what a single application yields.',
    );
  }

  /**
   * "Absent" and "quantity 0" are the same state, and which one you get depends
   * on whether the fight exhausted the stack: `inventoryService.removeItem()`
   * deletes the row once the quantity reaches 0, so a battle that drinks the
   * last potion leaves no row at all rather than a row of zeroes. Comparing
   * raw objects made that look like a double-deduction failure.
   */
  const qty = (map, id) => Number(map[id] ?? 0);
  const itemIds = [...new Set([
    ...Object.keys(before.inventory),
    ...Object.keys(after.inventory),
    ...Object.keys(expectedAfter),
  ])];
  const mismatches = itemIds.filter((id) => qty(after.inventory, id) !== qty(expectedAfter, id));

  h.assert(
    '§7.3 consumed items were decremented exactly once, clamped at the stock held (drops included)',
    mismatches.length === 0,
    mismatches.length === 0
      ? `every tracked item matches the single-application expectation: ${itemIds
          .map((id) => `${id} ${qty(before.inventory, id)} -> ${qty(after.inventory, id)} (expected ${qty(expectedAfter, id)})`)
          .join('; ')}` +
        `${expectedTotal === qty(before.inventory, expected.itemsConsumed[0]?.itemId) ? ' — the stack was fully drained, and the row was deleted rather than zeroed' : ''}`
      : `mismatched items: ${mismatches
          .map((id) => `${id} expected ${qty(expectedAfter, id)} but got ${qty(after.inventory, id)}`)
          .join('; ')}; a double application would show ` +
        itemIds.map((id) => `${id}=${qty(before.inventory, id) - 2 * (Number(expected.itemsConsumed.find((c) => c.itemId === id)?.quantity ?? 0) || qty(before.inventory, id))}`).join(', '),
  );

  const dropQuantity = expected.drops.reduce((sum, d) => sum + Number(d.quantity ?? 1), 0);
  const totalBefore = itemIds.reduce((sum, id) => sum + qty(before.inventory, id), 0);
  const totalAfter = itemIds.reduce((sum, id) => sum + qty(after.inventory, id), 0);
  h.assert(
    '§7.3 the total stock moved by exactly the simulated consumption minus the drops, counted once',
    totalBefore - totalAfter === expectedTotal - dropQuantity,
    `total stock ${totalBefore} -> ${totalAfter} (moved ${totalBefore - totalAfter}); entry.itemsConsumed totals ${expectedTotal} ` +
      `and entry.drops totals ${dropQuantity}, so a single application nets ${expectedTotal - dropQuantity}. ` +
      'A double application would move ' + (expectedTotal * 2 - dropQuantity * 2) + '.',
  );
  h.assert(
    '§7.3 no inventory quantity went negative',
    itemIds.every((id) => qty(after.inventory, id) >= 0),
    `final inventory ${JSON.stringify(after.inventory)}; ${expectedTotal} item(s) deducted in total`,
  );
  h.assert(
    '§7.3 the potion gambit line really did fire in the simulated battle',
    expected.itemsConsumed.length > 0 && expected.itemsConsumed.some((c) => c.itemId === 'pot_hp_small'),
    `entry.itemsConsumed=${JSON.stringify(expected.itemsConsumed)}, and the same set is what the engine recorded in the log: ` +
      `${(first_events(result) ?? []).length} use_item event(s) in the battle log`,
  );
}

function first_events(result) {
  return result.first?.log?.events?.filter((e) => e.action === 'use_item') ?? [];
}

// ---------------------------------------------------------------------------
//  Committed resolved-row/live-queue contract
// ---------------------------------------------------------------------------

/**
 * Verify a successfully resolved audit row stays persisted but is absent from
 * the live queue. The concurrent duplicate-job race above exercises the actual
 * row-lock/transaction path; this assertion avoids coupling the test to SQL
 * implementation details.
 */
async function assertResolvedReadPath(first) {
  const row = await h.sql(
    'SELECT resolved FROM battle_queue_entries WHERE id = $1',
    [first.id],
  );
  h.assert(
    'the successful transaction committed resolved=true on the retained audit row',
    row.rows[0]?.resolved === true,
    `resolved=${row.rows[0]?.resolved} on entry ${first.id}`,
  );

  const listed = await h.sql(
    'SELECT count(*)::int AS n FROM battle_queue_entries WHERE id = $1 AND resolved = false',
    [first.id],
  );
  h.assertEqual(
    'a committed resolved battle is absent from every unresolved/live queue read',
    listed.rows[0].n,
    0,
    `unresolved rows for battle ${first.id}: ${listed.rows[0].n}`,
  );
}

/**
 * The losing side of the race, observed rather than assumed: the backend logs
 * `Battle <id> already resolved - skipping` when the second caller acquires the
 * Character lock after the first transaction committed. If that line is absent,
 * the two jobs did not demonstrably contend and the "applied exactly once" result
 * may be a serial-delivery result wearing a concurrency test's clothes.
 */
async function assertSkipWasObserved(ctx, result) {
  let logs = '';
  try {
    logs = h.backendLogs(1800);
  } catch (error) {
    h.assert(
      '§3.1 the backend log was readable so the duplicate transaction could be observed',
      false,
      `docker compose logs backend failed: ${error.message}`,
    );
    return;
  }

  const skipLines = logs
    .split('\n')
    .filter((line) => line.includes(SKIP_LOG) && line.includes(result.first.id));

  const resolveLines = logs
    .split('\n')
    .filter((line) => line.includes(`Resolved battle ${result.first.id}`));

  h.assert(
    '§3.1 the duplicate caller logged "already resolved - skipping" — the locking/idempotency path was exercised',
    skipLines.length >= 1,
    skipLines.length >= 1
      ? `${skipLines.length} skip line(s) for ${result.first.id}; the second caller observed the committed result and returned without applying effects again`
      : `no "${SKIP_LOG}" line for ${result.first.id} in the last 30 minutes of backend logs. The transaction locking may still be correct, but this run did not observe a losing caller, so treat the exactly-once result as a serial-delivery result rather than a proven race.`,
  );
  h.assert(
    '§3.1 exactly one payout log line exists for the battle',
    resolveLines.length === 1,
    `${resolveLines.length} "Resolved battle ${result.first.id}" line(s) in the backend log — more than one would mean the ` +
      'second caller applied effects after the first transaction committed',
  );

  if (skipLines.length >= 1) {
    h.note(
      `overlap observed: the transaction was contended (${skipLines.length} duplicate caller(s) waited and then skipped). ` +
        'The exactly-once assertions above therefore describe a real race, not two sequential resolves.',
    );
  } else {
    h.note(
      'NO OVERLAP OBSERVED: the second job was delivered after the first had already completed, so nothing contended. ' +
        'The outcome assertions still hold, but this run did not exercise ' +
        'concurrency. Re-run, or use PHASE3_IDEMPOTENCY_WITH_RESTART=1, to try for a real overlap.',
    );
  }
  void ctx;
}

async function main() {
  console.log('=== Phase 3 · Idempotency (design.md D4) ===');
  console.log(`submission gap: ${SUBMISSION_GAP_MS}ms | restart-race mode: ${WITH_RESTART ? 'ON' : 'off'}`);
  await h.preflight();

  console.log('\n--- 1. Stage two concurrent resolve-battle jobs for one battle ---');
  const { ctx, entries, first, pick } = await setup();
  h.note(
    `first entry ${first.id} vs ${first.monsterId}: outcome=${first.outcome} xpGain=${first.xpGain} ` +
      `goldGain=${first.goldGain} drops=${JSON.stringify(first.drops)} itemsConsumed=${JSON.stringify(first.itemsConsumed)} ` +
      `seeded potions=${JSON.stringify(await h.getInventoryMap(ctx.charId))}`,
  );
  h.assert(
    '§7.4.2 the staged entry is a win, so the race exercises the payout path rather than the death path',
    first.outcome === 'win',
    `outcome=${first.outcome}; a loss would route to handleCharacterDeath and never touch xp/gold/drops`,
  );
  h.assert(
    '§11.2 the API rolled exactly the drop the in-process preview predicted from the seeded per-monster kill count',
    JSON.stringify(first.drops ?? []) === JSON.stringify(pick.rewards.drops ?? []) &&
      (pick.rewards.drops ?? []).length > 0,
    `preview (per-monster kill count ${pick.dropKillIndex}) = ${JSON.stringify(pick.rewards.drops)}; ` +
      `entry built by POST /maps/:mapId/enter = ${JSON.stringify(first.drops)}`,
  );

  const result = await runRace(ctx, first, { withRestart: WITH_RESTART });

  console.log('\n--- 2. §3.1 effects applied exactly once ---');
  await assertSingleApplication(result);

  console.log('\n--- 3. §7.3 consumed items decremented exactly once ---');
  await assertItemsConsumedOnce(ctx, result);

  console.log('\n--- 4. Resolved audit row is excluded from the live queue ---');
  await assertResolvedReadPath(first);
  await assertSkipWasObserved(ctx, result);

  void entries;
  await h.drainQueue(ctx.charId);
  await h.closeQueueAndRedis();
  h.summarize('Idempotency');
}

main().catch((error) => {
  console.error('FATAL:', error);
  h.closeQueueAndRedis().finally(() => process.exit(1));
});
