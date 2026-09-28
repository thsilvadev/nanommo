#!/usr/bin/env node

/**
 * Phase 3 — Gambit validation (SPEC §8.4 save-time, §7.2/§7.3 runtime)
 *
 * Split in two, because the two halves live in different places (design.md D7):
 *
 *   1. SAVE-TIME (§8.4) — over `PUT /gambits/:pageId`. Each of the six rules must
 *      answer 400 with a non-empty `fieldErrors` array naming the offending
 *      path, AND leave the stored page byte-unchanged. The second half is the
 *      one that matters: "reject the whole write" is only true if nothing
 *      reached the repository, which a status code alone does not prove.
 *
 *   2. RUNTIME (§7.2 cooldown category, §7.3 step 4 illegal-line skipping) —
 *      engine-internal, no endpoint exists, so it is driven through
 *      `BattleEngine.simulateBattle()` with a crafted page and inventory.
 *
 * Plus an HTTP round-trip proving the engine honours what was actually saved.
 *
 * Run: node apps/api/test-phase3-gambits.js
 */

const h = require('./test/helpers/phase3.js');
const { BattleEngine } = require('@nanommo/shared');
const monsters = require('../../monsters.json');
const items = require('../../items.json');

const IN_MAP = monsters.monsters.filter((m) => m.map === h.MAP_ID);
const MONSTER = IN_MAP.find((m) => m.id === 'mon_slime') ?? IN_MAP[0];
const ITEM_DEFS = Object.fromEntries((items.consumables ?? []).map((c) => [c.id, c]));
const ATTRIBUTES = { str: 5, agi: 5, dex: 5, vit: 5, int: 5, sor: 5 };
const COMBINATORS = ['AND', 'OR'];

/** SPEC §8.4: at most 20 lines per page — 21 is the first rejected count. */
const MAX_LINES_PER_PAGE = 20;

function buildSnapshot(hp, sp) {
  const derived = BattleEngine.calculateDerivedStats(1, ATTRIBUTES, {});
  return {
    level: 1,
    hp,
    sp,
    ...derived,
    skills: {},
    skillDefs: {},
    statusEffects: [],
    foodBuffTicksRemaining: 0,
    equippedWeaponTypes: [],
  };
}

/** A line the server accepts, so each rule is tested in isolation. */
const validLine = (over = {}) => ({
  priority: 1,
  conditions: [{ id: 'always' }],
  combinator: null,
  action: { id: 'attack' },
  ...over,
});

/**
 * The six §8.4 rules. `expectPath` is the `fieldErrors[].path` the rule should
 * report; `fieldErrors` is asserted non-empty separately.
 */
const RULES = [
  {
    name: '§8.4 rule 1 — at most 20 lines per page (21 lines rejected)',
    expectPath: 'lines',
    lines: Array.from({ length: MAX_LINES_PER_PAGE + 1 }, () => validLine()),
  },
  {
    name: '§8.4 rule 2 — 1 or 2 conditions per line (3 rejected)',
    expectPath: 'lines[0].conditions',
    lines: [
      validLine({
        conditions: [{ id: 'always' }, { id: 'always' }, { id: 'always' }],
        combinator: 'AND',
      }),
    ],
  },
  {
    name: '§8.4 rule 3 — 2 conditions require a non-null combinator (null rejected)',
    expectPath: 'lines[0].combinator',
    lines: [
      validLine({
        conditions: [{ id: 'always' }, { id: 'self_hp_band', band: 'LOW' }],
        combinator: null,
      }),
    ],
  },
  {
    name: '§8.4 rule 4 — 1 condition requires a null combinator (non-null rejected)',
    expectPath: 'lines[0].combinator',
    lines: [validLine({ conditions: [{ id: 'always' }], combinator: 'AND' })],
  },
  {
    name: '§8.4 rule 5 — unknown action.id is rejected',
    expectPath: 'lines[0].action.id',
    lines: [validLine({ action: { id: 'summon_dragon' } })],
  },
  {
    name: '§8.4 rule 5b — out-of-enum band value is rejected',
    expectPath: 'lines[0].conditions[0].band',
    lines: [validLine({ conditions: [{ id: 'self_hp_band', band: 'ANGRY' }] })],
  },
  {
    name: '§8.4 rule 6a — use_item with a non-existent itemId is rejected',
    expectPath: 'lines[0].action.itemId',
    lines: [validLine({ action: { id: 'use_item', itemId: 'pot_imaginary' } })],
  },
  {
    name: '§8.4 rule 6b — use_skill with a non-existent skillId is rejected',
    expectPath: 'lines[0].action.skillId',
    lines: [validLine({ action: { id: 'use_skill', skillId: 'sword_katana_slash' } })],
  },
];

/** A page the server must accept — the control for "validation is not just rejecting everything". */
const VALID_PAGE_LINES = [
  validLine({ priority: 1 }),
  validLine({
    priority: 2,
    conditions: [{ id: 'self_hp_band', band: 'LOW' }, { id: 'always' }],
    combinator: 'OR',
    action: { id: 'use_item', itemId: 'pot_hp_small' },
  }),
  validLine({
    priority: 3,
    conditions: [{ id: 'self_hp_band', band: 'CRITICAL' }, { id: 'self_hp_band', band: 'LOW' }],
    combinator: 'AND',
    action: { id: 'use_skill', skillId: 'sword_power_strike' },
  }),
  validLine({ priority: 4, conditions: [{ id: 'self_hungry' }], action: { id: 'defend' } }),
];

// ---------------------------------------------------------------------------
//  1. Save-time — §8.4 over PUT /gambits/:pageId
// ---------------------------------------------------------------------------

async function assertSaveTimeValidation(ctx) {
  // A known-good page first, so every rejection below can be proven not to have
  // touched what is stored.
  const seed = await h.request(
    'PUT',
    `/gambits/${ctx.gambitPageId}`,
    { lines: VALID_PAGE_LINES },
    ctx.token,
  );
  h.assert(
    '§8.4 a fully valid page IS accepted',
    seed.status === 200,
    `PUT /gambits/${ctx.gambitPageId} -> ${seed.status} (${Array.isArray(seed.data?.lines) ? `${seed.data.lines.length} lines stored` : seed.raw.slice(0, 160)})`,
  );
  ctx.baseline = await readStoredLines(ctx);
  h.assertEqual(
    '§8.4 the accepted page is readable back with the same 4 lines',
    ctx.baseline?.length,
    VALID_PAGE_LINES.length,
  );

  for (const rule of RULES) {
    const res = await h.request('PUT', `/gambits/${ctx.gambitPageId}`, { lines: rule.lines }, ctx.token);

    const fieldErrors = res.data?.fieldErrors;
    const paths = Array.isArray(fieldErrors) ? fieldErrors.map((e) => e.path) : [];
    const namesOffendingPath = paths.some(
      (p) => p === rule.expectPath || p.startsWith(`${rule.expectPath}`) || p.startsWith(rule.expectPath.replace(/\[0\]/, '')),
    );

    h.assert(
      rule.name,
      res.status === 400,
      `expected 400, got ${res.status}${res.status === 400 ? '' : ` — ${res.raw.slice(0, 200)}`}`,
    );
    h.assert(
      `${rule.name} → non-empty fieldErrors naming "${rule.expectPath}"`,
      Array.isArray(fieldErrors) && fieldErrors.length > 0 && namesOffendingPath,
      Array.isArray(fieldErrors) && fieldErrors.length > 0
        ? `fieldErrors paths = [${paths.join(', ')}]`
        : `fieldErrors was ${JSON.stringify(fieldErrors)} (message: ${JSON.stringify(res.data?.message).slice(0, 200)})`,
    );

    // The half a status code cannot prove: the write never reached the row.
    const after = await readStoredLines(ctx);
    h.assert(
      `${rule.name} → the stored page is unchanged`,
      JSON.stringify(after) === JSON.stringify(ctx.baseline),
      after === null
        ? 'GET /gambits/:pageId no longer returns the page'
        : `stored lines still ${after.length}, line[0].action.id=${after[0]?.action?.id}, identical to the pre-write baseline: ${JSON.stringify(after) === JSON.stringify(ctx.baseline)}`,
    );
  }
}

async function readStoredLines(ctx) {
  const res = await h.request('GET', `/gambits/${ctx.gambitPageId}`, null, ctx.token);
  return res.status === 200 ? res.data.lines : null;
}

// ---------------------------------------------------------------------------
//  2. Runtime — §7.3 step 4 and §7.2, driven through the engine
// ---------------------------------------------------------------------------

/**
 * SPEC §7.3 step 4: a line whose condition is true but whose action is illegal
 * is SKIPPED, and evaluation continues to the next line — it does not consume
 * the gauge fire.
 *
 * Case: priority 1 = `use_item` a potion the character does not hold,
 * priority 2 = `attack`. The potion line's condition is always true, so only
 * the legality check can skip it.
 */
function assertIllegalLineSkipped() {
  const page = {
    lines: [
      { priority: 1, conditions: [{ id: 'always' }], combinator: null, action: { id: 'use_item', itemId: 'pot_hp_small' } },
      { priority: 2, conditions: [{ id: 'always' }], combinator: null, action: { id: 'attack' } },
    ],
  };

  const result = BattleEngine.simulateBattle(buildSnapshot(158, 98), MONSTER, page, 'phase3:gambits:illegal', {
    // The character holds no potions at all.
    inventory: {},
    itemDefinitions: ITEM_DEFS,
    monsterSkillDefs: {},
    weaponBaseAttackTicks: 6,
  });

  const events = result.log.events;
  const first = events[0];

  h.assert(
    '§7.3 step 4 condition-true-but-illegal use_item is skipped and the next line runs (first event is the attack)',
    first?.action === 'attack' && first?.actor === 'character',
    `first event = ${JSON.stringify({ tick: first?.tick, actor: first?.actor, action: first?.action })}`,
  );
  h.assert(
    '§7.3 step 4 nothing was consumed by the skipped line',
    result.itemsConsumed.length === 0 && Object.values(result.inventoryAfter).every((q) => q === 0),
    `itemsConsumed=${JSON.stringify(result.itemsConsumed)} inventoryAfter=${JSON.stringify(result.inventoryAfter)}`,
  );
  h.assert(
    '§7.3 step 4 no use_item event was logged at all (inventory was empty)',
    !events.some((e) => e.action === 'use_item'),
    `${events.filter((e) => e.action === 'use_item').length} use_item events in a ${events.length}-event log`,
  );
}

/**
 * SPEC §7.2: potions share ONE 5-tick cooldown *category* (`item:potion`), not a
 * per-item cooldown. A different potion is gated by having used any potion.
 *
 * Making this observable needs the cast gauge to fire faster than the cooldown,
 * so the fixture uses a high-DEX character: `castGaugeThreshold(dex)` is
 * `max(3, 8 - floor(dex * 0.05))` (SPEC §7.2), so dex=100 gives a 3-tick cast
 * period against a 5-tick potion cooldown. At the default dex=5 the cast gauge
 * fires every 8 ticks and the category cooldown has always expired by the next
 * fire, so the shared category would be structurally unobservable.
 */
function assertPotionCooldownCategory() {
  const HIGH_DEX = { str: 5, agi: 5, dex: 100, vit: 5, int: 5, sor: 5 };
  const derived = BattleEngine.calculateDerivedStats(1, HIGH_DEX, {});
  const snapshot = {
    level: 1,
    hp: derived.maxHp,
    sp: derived.maxSp,
    ...derived,
    skills: {},
    skillDefs: {},
    statusEffects: [],
    foodBuffTicksRemaining: 0,
    equippedWeaponTypes: [],
  };
  const castPeriod = BattleEngine.castGaugeThreshold(HIGH_DEX.dex);

  /**
   * A monster tough enough that the fight outlives several cooldown cycles.
   * `mon_slime` (65 HP) dies to the priority-3 attack line in two hits, so the
   * fight ends before a single gap can be observed — which would make the gap
   * assertions below pass for the wrong reason.
   */
  const COOLDOWN_MONSTER = monsters.monsters.find((m) => m.id === 'mon_brokensentinel')
    ?? monsters.monsters.slice().sort((a, b) => b.hp - a.hp)[0];

  const page = (first, second) => [
    { priority: 1, conditions: [{ id: 'always' }], combinator: null, action: { id: 'use_item', itemId: first } },
    { priority: 2, conditions: [{ id: 'always' }], combinator: null, action: { id: 'use_item', itemId: second } },
    // Priority 3 is unreachable on the cast gauge, so it does not perturb the
    // cooldown measurement — but without it the character has no `attack` line,
    // never damages the monster, and the fight runs to the 200-tick stalemate
    // valve instead of ending.
    { priority: 3, conditions: [{ id: 'always' }], combinator: null, action: { id: 'attack' } },
  ];

  const simulate = (seed, lines, inventory) =>
    BattleEngine.simulateBattle(snapshot, COOLDOWN_MONSTER, lines, seed, {
      inventory,
      itemDefinitions: ITEM_DEFS,
      monsterSkillDefs: {},
      weaponBaseAttackTicks: 6,
    });

  // --- A: both potions in stock. Only the priority-1 line is ever chosen,
  //     because the priority-2 line is gated by the SAME category cooldown.
  const both = simulate('phase3:gambits:cooldown:both', page('pot_hp_small', 'pot_sp_small'), {
    pot_hp_small: 30,
    pot_sp_small: 30,
  });
  const uses = both.log.events.filter((e) => e.action === 'use_item');
  const ticks = uses.map((e) => e.tick);
  const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
  const minGap = gaps.length ? Math.min(...gaps) : Infinity;

  h.assert(
    '§7.2 the fixture produced enough potion uses to measure a gap (non-vacuous)',
    uses.length >= 3 && gaps.length >= 2,
    `${uses.length} use_item event(s) at ticks [${ticks.slice(0, 10).join(', ')}${ticks.length > 10 ? ', …' : ''}] ` +
      `against ${COOLDOWN_MONSTER.id} (${COOLDOWN_MONSTER.hp} HP), battle outcome=${both.outcome} after ${both.durationTicks} ticks`,
  );

  h.assert(
    '§7.2 the shared item:potion cooldown category blocked the second potion (the same category gates a *different* item)',
    uses.length >= 2 && gaps.every((g) => g > castPeriod),
    `distinct use_item gaps = [${[...new Set(gaps)].join(', ')}] against a ${castPeriod}-tick cast-gauge period; ` +
      `a per-item cooldown would have let pot_hp_small fire every ${castPeriod} ticks. ` +
      `pot_sp_small fired ${uses.filter((e) => e.itemId === 'pot_sp_small').length} time(s) while pot_hp_small was in stock ` +
      `(it is priority 2 and condition-true every fire, so only the shared category can be keeping it out)`,
  );

  h.assert(
    '§7.2 no two potion uses are closer together than the 5-tick POTION_COOLDOWN',
    Number.isFinite(minGap) ? minGap >= BattleEngine.POTION_COOLDOWN : false,
    `minimum tick gap between consecutive use_item events = ${minGap} (POTION_COOLDOWN = ${BattleEngine.POTION_COOLDOWN}); ` +
      `items used in order: ${uses.slice(0, 6).map((e) => `${e.itemId}@${e.tick}`).join(', ')}${uses.length > 6 ? ', …' : ''}`,
  );

  // --- B: control. With the priority-1 item out of stock, the priority-2 line
  //     fires on the very first cast fire. This is what makes A meaningful: it
  //     shows the line is reachable and its conditions are true, so the delay in
  //     A is the shared cooldown and nothing else.
  const onlySecond = simulate('phase3:gambits:cooldown:control', page('pot_hp_small', 'pot_sp_small'), {
    pot_sp_small: 30,
  });
  const controlUses = onlySecond.log.events.filter((e) => e.action === 'use_item');

  h.assert(
    '§7.2 control: with the priority-1 potion out of stock the priority-2 line fires on the first cast fire (conditions true, action legal)',
    controlUses.length > 0 && controlUses[0].tick <= castPeriod && controlUses[0].itemId === 'pot_sp_small',
    `first use_item = ${JSON.stringify({ tick: controlUses[0]?.tick, itemId: controlUses[0]?.itemId })} with a ${castPeriod}-tick cast period; ${controlUses.length} use_item event(s) total`,
  );

  h.divergence(
    5,
    'Cooldown-period note (not one of design.md\'s four divergences, recorded here because it shaped the test): ' +
      `at the default dex=5 the cast gauge fires every ${BattleEngine.castGaugeThreshold(5)} ticks, so a 5-tick potion ` +
      'category cooldown always expires before the next cast fire and the shared-category rule is structurally ' +
      'unobservable through the battle log. This assertion therefore uses a dex=100 fixture; it is a property of the ' +
      'engine, not of any character the API currently lets you build with low DEX and a potion gambit.',
  );
}

/**
 * SPEC §7.3 step 1-3: on a gauge fire, the first line that is condition-true AND
 * legal executes, and it executes alone. Two lines that are both always-legal
 * on the cast gauge (`defend` at priority 1, `wait` at priority 2): the lower
 * priority must never fire.
 */
function assertHigherPriorityExecutesAlone() {
  const page = {
    lines: [
      { priority: 1, conditions: [{ id: 'always' }], combinator: null, action: { id: 'defend' } },
      { priority: 2, conditions: [{ id: 'always' }], combinator: null, action: { id: 'wait' } },
    ],
  };

  const result = BattleEngine.simulateBattle(buildSnapshot(158, 98), MONSTER, page, 'phase3:gambits:priority', {
    inventory: {},
    itemDefinitions: ITEM_DEFS,
    monsterSkillDefs: {},
    weaponBaseAttackTicks: 6,
  });

  const defends = result.log.events.filter((e) => e.action === 'defend');
  const waits = result.log.events.filter((e) => e.action === 'wait');
  const perTick = new Map();
  for (const e of result.log.events) {
    if (e.actor !== 'character') continue;
    perTick.set(e.tick, (perTick.get(e.tick) ?? 0) + 1);
  }
  const maxPerTick = Math.max(0, ...perTick.values());

  h.assert(
    '§7.3 with two legal lines the higher priority executes',
    defends.length > 0,
    `${defends.length} defend event(s) logged at ticks [${defends.map((e) => e.tick).join(', ')}]`,
  );
  h.assert(
    '§7.3 the lower-priority line never fires while the higher one is legal',
    waits.length === 0,
    `${waits.length} wait event(s) at ticks [${waits.map((e) => e.tick).join(', ')}] (defend fired ${defends.length} times)`,
  );
  h.assert(
    '§7.3 a gauge fire performs at most one character action',
    maxPerTick <= 1,
    `max character actions on a single tick = ${maxPerTick}`,
  );
}

// ---------------------------------------------------------------------------
//  3. HTTP round-trip — the engine honours what was saved
// ---------------------------------------------------------------------------

/**
 * Save a page whose priority-1 line is a potion the character does not hold and
 * whose priority-2 line is `attack`, then queue real battles through the API and
 * assert the first entry's log contains no `use_item` in its opening action.
 * This is the end-to-end proof that the saved page is the page the engine runs.
 */
async function assertHttpRoundTrip(ctx) {
  const lines = [
    { priority: 1, conditions: [{ id: 'always' }], combinator: null, action: { id: 'use_item', itemId: 'pot_hp_large' } },
    { priority: 2, conditions: [{ id: 'always' }], combinator: null, action: { id: 'attack' } },
  ];

  const saved = await h.request('PUT', `/gambits/${ctx.gambitPageId}`, { lines }, ctx.token);
  h.assert(
    '§8.4/§7.3 the out-of-stock-potion page saves successfully (it is legal to store, just not to fire)',
    saved.status === 200,
    `PUT -> ${saved.status}`,
  );

  const reactivated = await h.request('PUT', `/gambits/${ctx.gambitPageId}/activate`, {}, ctx.token);
  h.assert('§7.3 the crafted page is the active page', reactivated.status === 200, `activate -> ${reactivated.status}`);

  // The save-time loop above takes minutes of wall clock, during which the
  // bootstrap character's own 5-deep queue keeps resolving — and a level-1
  // character loses most fights (STATUS.md Issue #2), so by now it is very
  // likely dead and routed to town. Put it back on the map before queueing.
  const before = await h.getCharacterRow(ctx.charId);
  if (before.status !== 'grinding' || before.currentMapId !== ctx.mapId) {
    h.note(
      `bootstrap character drifted out of the grind during the save-time loop ` +
        `(status=${before.status}, map=${before.currentMapId}) — re-entering the map`,
    );
    const reenter = await h.request('POST', `/maps/${ctx.mapId}/enter`, {}, ctx.token);
    h.assert(
      '§7.3 the character is back on a map before the round-trip queue is built',
      reenter.status === 201 || reenter.status === 200,
      `POST /maps/${ctx.mapId}/enter -> ${reenter.status}`,
    );
  }

  await h.clearQueue(ctx.charId);
  await h.clearBullJobs();
  const queued = await h.request('POST', '/battles/queue', {}, ctx.token);
  h.assert(
    '§7.3 the queue rebuilds against the newly saved page',
    queued.status === 200 || queued.status === 201,
    `POST /battles/queue -> ${queued.status}${queued.status >= 400 ? ` — ${queued.raw.slice(0, 160)}` : ''}`,
  );
  if (queued.status >= 400) {
    h.assert('§7.3 the round-trip could not observe the saved page (aborting the section)', false, 'queue build failed');
    return;
  }

  const queue = await h.waitFor(
    'a 5-deep queue to exist',
    async () => {
      const q = await h.getQueueViaApi(ctx.token);
      return q && q.length >= 5 ? q : null;
    },
    30_000,
  );

  const first = queue[0];
  const events = first.log?.events ?? [];
  const firstAction = events[0];
  const useItems = events.filter((e) => e.action === 'use_item');

  h.assert(
    '§7.3 the first queued entry\'s opening action is not a use_item (the saved illegal line was skipped)',
    firstAction !== undefined && firstAction.action !== 'use_item',
    `entry ${first.id} first event = ${JSON.stringify({ tick: firstAction?.tick, actor: firstAction?.actor, action: firstAction?.action })}`,
  );
  h.assert(
    '§7.3 the entry logged zero use_item events while the character holds no pot_hp_large',
    useItems.length === 0,
    `${useItems.length} use_item event(s) in ${events.length} events; the stored page's line 1 was use_item(pot_hp_large) and inventory was ${JSON.stringify(await h.getInventoryMap(ctx.charId))}`,
  );

  // Clean up so the round-trip character does not keep resolving mid-suite.
  await h.clearQueue(ctx.charId);
  await h.clearBullJobs();
}

async function main() {
  console.log('=== Phase 3 · Gambit validation (SPEC §8.4 save-time, §7.2/§7.3 runtime) ===\n');
  await h.preflight();

  const ctx = await h.createCharacter({ enterMap: true });
  console.log(`Character ${ctx.charId}, gambit page ${ctx.gambitPageId}\n`);

  // The save-time loop below is paced by the API throttler and takes minutes of
  // wall clock. Left alone, the bootstrap character's own 5-deep queue would
  // keep resolving throughout and a level-1 character loses most fights
  // (STATUS.md Issue #2), so it would be dead in town before section 3 ran.
  // Draining it here keeps the character alive and idle for the whole script.
  await h.clearQueue(ctx.charId);
  await h.clearBullJobs();
  console.log('Drained the bootstrap queue so the character stays alive and idle for the rest of the script.\n');

  console.log('--- 1. Save-time validation over PUT /gambits/:pageId (SPEC §8.4) ---');
  await assertSaveTimeValidation(ctx);

  console.log('\n--- 2. Runtime legality in the engine (SPEC §7.2, §7.3) ---');
  assertIllegalLineSkipped();
  assertPotionCooldownCategory();
  assertHigherPriorityExecutesAlone();

  console.log('\n--- 3. HTTP round-trip: the engine runs what was saved ---');
  await assertHttpRoundTrip(ctx);

  await h.closeQueueAndRedis();
  h.summarize('Gambits');
}

main().catch((error) => {
  console.error('FATAL:', error);
  h.closeQueueAndRedis().finally(() => process.exit(1));
});
