#!/usr/bin/env node

/**
 * Phase 3 — Determinism (SPEC §3.1, design.md D6)
 *
 * The project's central promise. `BattleEngine.simulateBattle()` is a pure
 * function, so this is the one scenario that needs neither docker-compose nor a
 * database: the pure half below always runs, and only the stored-battle replay
 * half touches the stack.
 *
 * Why the engine and not the queue: the per-battle seed built in
 * `queueBattles()` is `${characterId}:${mapId}:${monsterId}:${sequenceIndex}:${epoch}:${killIndex}`
 * (battle.service.ts:277), so `sequenceIndex` participates and two queue builds
 * of the same logical fight legitimately get different seeds. Determinism is a
 * property of (snapshot, monster, page, seed), not of the queue.
 *
 * Run: node apps/api/test-phase3-determinism.js
 */

const fs = require('fs');
const path = require('path');
const h = require('./test/helpers/phase3.js');
const { BattleEngine } = require('@nanommo/shared');

const monsters = require('../../monsters.json');
const items = require('../../items.json');
const catalog = require('../../gambit_catalog.json');
const skillTrees = require('../../skill_trees.json');

const MAP_ID = h.MAP_ID;
const IN_MAP = monsters.monsters.filter((m) => m.map === MAP_ID);
const ITEM_DEFS = Object.fromEntries((items.consumables ?? []).map((c) => [c.id, c]));
const MONSTER_SKILL_DEFS = Object.fromEntries(
  (skillTrees.monsterSkills ?? []).map((s) => [s.id, s]),
);

/**
 * A fixed character snapshot, derived exactly the way `buildCharacterSnapshot()`
 * derives it (battle.service.ts:136-173) minus equipment, which is empty here.
 * `AGI`/`DEX` are folded in because the §7.2 gauge thresholds read them.
 */
const ATTRIBUTES = { str: 5, agi: 5, dex: 5, vit: 5, int: 5, sor: 5 };

function buildSnapshot(level, hp, sp) {
  const derived = BattleEngine.calculateDerivedStats(level, ATTRIBUTES, {});
  return {
    level,
    hp: Math.max(1, Math.min(hp, derived.maxHp)),
    sp: Math.max(0, Math.min(sp, derived.maxSp)),
    ...derived,
    skills: {},
    skillDefs: {},
    statusEffects: [],
    foodBuffTicksRemaining: 0,
    equippedWeaponTypes: [],
  };
}

/**
 * The "example gambit page" is assembled from `gambit_catalog.json` — one line
 * per catalog action, each with a condition and param shape the catalog
 * actually declares, so the page exercises every action branch the engine has.
 * (`monsters.json` carries no `exampleGambitPage` key; the catalog is the
 * project's actual source of truth for action/condition shapes.)
 */
function buildExampleGambitPage() {
  const condition = (id, params = {}) => ({ id, ...params });
  return {
    lines: [
      { priority: 1, conditions: [condition('always')], combinator: null, action: { id: 'attack' } },
      {
        priority: 2,
        conditions: [condition('self_hp_band', { band: 'LOW' }), condition('always')],
        combinator: 'AND',
        action: { id: 'use_item', itemId: 'pot_hp_small' },
      },
      {
        priority: 3,
        conditions: [condition('self_hp_band', { band: 'CRITICAL' }), condition('always')],
        combinator: 'OR',
        action: { id: 'use_item', itemId: 'pot_sp_small' },
      },
      { priority: 4, conditions: [condition('always')], combinator: null, action: { id: 'defend' } },
    ],
  };
}

const SNAPSHOT = buildSnapshot(1, 158, 98);
const GAMBIT_PAGE = buildExampleGambitPage();
const INVENTORY = { pot_hp_small: 3, pot_sp_small: 3 };
const MONSTER = IN_MAP.find((m) => m.id === 'mon_slime') ?? IN_MAP[0];
const SEED = 'phase3:determinism:char:map:mon_slime:0:0:0';

const OPTIONS = {
  inventory: { ...INVENTORY },
  itemDefinitions: ITEM_DEFS,
  monsterSkillDefs: {},
  weaponBaseAttackTicks: 6,
};

/** The fields the suite treats as "the result" — everything a resolve reads. */
function resultFingerprint(result) {
  return JSON.stringify({
    log: result.log,
    outcome: result.outcome,
    durationTicks: result.durationTicks,
    hpAfter: result.hpAfter,
    spAfter: result.spAfter,
    itemsConsumed: result.itemsConsumed,
  });
}

// ---------------------------------------------------------------------------
//  §3.1 — identical inputs produce byte-identical results
// ---------------------------------------------------------------------------

function assertRepeatable() {
  const a = BattleEngine.simulateBattle(SNAPSHOT, MONSTER, GAMBIT_PAGE, SEED, {
    ...OPTIONS,
    inventory: { ...INVENTORY },
  });
  const b = BattleEngine.simulateBattle(SNAPSHOT, MONSTER, GAMBIT_PAGE, SEED, {
    ...OPTIONS,
    inventory: { ...INVENTORY },
  });

  const fa = resultFingerprint(a);
  const fb = resultFingerprint(b);

  h.assert(
    '§3.1 identical (snapshot, monster, page, seed) produce byte-identical results',
    fa === fb,
    fa === fb
      ? `outcome=${a.outcome} durationTicks=${a.durationTicks} hpAfter=${a.hpAfter} spAfter=${a.spAfter} itemsConsumed=${a.itemsConsumed.length} — ${fa.length} bytes identical`
      : `first differing offset ${firstDiff(fa, fb)}; run A outcome=${a.outcome}/${a.durationTicks} vs run B ${b.outcome}/${b.durationTicks}`,
  );

  // The fingerprint must actually cover the log, not be an empty object.
  h.assert(
    '§3.1 the compared fingerprint is non-trivial (log + events are included)',
    Array.isArray(a.log?.events) && a.log.events.length > 0,
    `log.events length=${a.log?.events?.length}, header keys=${Object.keys(a.log?.header ?? {}).join(',')}`,
  );
}

// ---------------------------------------------------------------------------
//  Negative control — a different seed must actually change something
// ---------------------------------------------------------------------------

function assertSeedMatters() {
  const other = BattleEngine.simulateBattle(SNAPSHOT, MONSTER, GAMBIT_PAGE, `${SEED}:different`, {
    ...OPTIONS,
    inventory: { ...INVENTORY },
  });
  const base = BattleEngine.simulateBattle(SNAPSHOT, MONSTER, GAMBIT_PAGE, SEED, {
    ...OPTIONS,
    inventory: { ...INVENTORY },
  });

  /**
   * Compare only what the simulation *produced*, never the header: the header
   * echoes `seedUsed` back verbatim (battle-engine/index.ts:883), so including
   * it would make this assertion pass even if the engine ignored the seed
   * entirely — which is exactly the vacuity this control exists to catch.
   */
  const produced = (r) =>
    JSON.stringify({
      events: r.log.events,
      outcome: r.outcome,
      durationTicks: r.durationTicks,
      hpAfter: r.hpAfter,
      spAfter: r.spAfter,
      itemsConsumed: r.itemsConsumed,
    });

  const changed = produced(base) !== produced(other);

  h.assert(
    '§3.1 a different seed changes the simulation (non-vacuous determinism)',
    changed,
    changed
      ? `seed A outcome=${base.outcome} ticks=${base.durationTicks} hpAfter=${base.hpAfter} | seed B outcome=${other.outcome} ticks=${other.durationTicks} hpAfter=${other.hpAfter}`
      : `both seeds produced identical output (outcome=${base.outcome} ticks=${base.durationTicks} hpAfter=${base.hpAfter} events=${base.log.events.length}) — a hardcoded constant seed would pass this, so the seed is not reaching the engine`,
  );
}

// ---------------------------------------------------------------------------
//  §3.4 — a stored battle replays from its own seed + snapshot
// ---------------------------------------------------------------------------

/**
 * Re-simulate a persisted `BattleQueueEntry` from its `seedUsed` and the
 * `characterSnapshot` in its own log header, then compare the log byte-for-byte
 * against what is stored. This is the assertion that ties the engine's purity to
 * what the API actually persisted.
 *
 * Gated on the stack: skips with a printed notice when `PHASE3_API_URL` is
 * unreachable, never silently.
 */
async function assertStoredBattleReplays() {
  let reachable = true;
  try {
    await h.preflight();
  } catch (error) {
    console.log(`[SKIP] §3.4 stored-battle replay — ${error.message.split('\n')[0]}`);
    return;
  }

  const c = await h.createCharacter({ enterMap: true });
  await h.waitFor(
    'the resolver to build a 5-deep queue',
    async () => (await h.getUnresolvedEntries(c.charId)).length >= 5,
    30_000,
  );

  const entries = await h.getUnresolvedEntries(c.charId);
  const entry = entries[0];
  const storedSeed = entry.seedUsed;
  const storedSnapshot = entry.log?.header?.characterSnapshot;
  const storedLog = entry.log;

  // Replay must reproduce the inputs `queueBattles()` used, not a fixture's.
  // The character is created unequipped, so the §7.2 attack-gauge threshold
  // falls back to the rounded average of the whole weapon table
  // (battle.service.ts:179-186).
  const queueTimeInventory = await h.getInventoryMap(c.charId);
  const activePage = await loadActiveGambitPage(c.charId);

  // `mapId` is appended to the log object at queue-build time
  // (battle.service.ts:317), so it is not part of what the engine re-emits.
  const { mapId: _storedMapId, ...storedLogWithoutMapId } = storedLog;

  if (!storedSnapshot) {
    h.assert(
      '§3.4 a stored battle carries a characterSnapshot in its log header',
      false,
      `entry ${entry.id} log.header.characterSnapshot is missing`,
    );
    return;
  }

  // Guard against a half-replay: if the reconstruction is wrong the comparison
  // is meaningless, so state the inputs the replay actually used.
  h.note(
    `replaying entry ${entry.id} with monster=${entry.monsterId} seed=${storedSeed} ` +
      `page=${activePage ? `${activePage.lines?.length ?? 0} lines` : 'none'} ` +
      `inventory=${JSON.stringify(queueTimeInventory)} weaponBaseAttackTicks=${weaponBaseAttackTicksFor([])}`,
  );

  const replay = BattleEngine.simulateBattle(storedSnapshot, MONSTER, null, storedSeed, {
    inventory: { ...queueTimeInventory },
    itemDefinitions: ITEM_DEFS,
    monsterSkillDefs: MONSTER_SKILL_DEFS,
    weaponBaseAttackTicks: weaponBaseAttackTicksFor([]),
  });
  void replay;

  // The stored entry's own monster, not the fixture's.
  const storedMonster = monsters.monsters.find((m) => m.id === entry.monsterId);
  const replayActual = BattleEngine.simulateBattle(
    storedSnapshot,
    storedMonster,
    activePage,
    storedSeed,
    {
      inventory: { ...queueTimeInventory },
      itemDefinitions: ITEM_DEFS,
      monsterSkillDefs: MONSTER_SKILL_DEFS,
      weaponBaseAttackTicks: weaponBaseAttackTicksFor([]),
    },
  );

  // Postgres `jsonb` does not preserve key order, so the comparison has to be
  // order-insensitive: canonicalise both sides to sorted keys.
  const storedJson = canonicalJson(storedLogWithoutMapId);
  const replayJson = canonicalJson(replayActual.log);

  h.assert(
    '§3.4 re-simulating a stored battle\'s seedUsed + characterSnapshot reproduces its persisted log byte-for-byte',
    storedJson === replayJson,
    storedJson === replayJson
      ? `entry ${entry.id} (${entry.monsterId}, seed=${storedSeed}) — ${storedJson.length} bytes identical`
      : `entry ${entry.id} first differing offset ${firstDiff(storedJson, replayJson)}; stored outcome=${storedLog?.outcome}/${storedLog?.durationTicks} vs replay ${replayActual.outcome}/${replayActual.durationTicks}`,
  );

  h.assert(
    '§3.4 the stored log header records the seed that reproduces it',
    storedLog?.header?.seedUsed === storedSeed && storedLog?.header?.monsterId === entry.monsterId,
    `header.seedUsed=${storedLog?.header?.seedUsed} (column ${storedSeed}), header.monsterId=${storedLog?.header?.monsterId} (column ${entry.monsterId})`,
  );

  // Clean up so the replay does not race the live resolver.
  await h.clearQueue(c.charId);
  await h.clearBullJobs();
  void reachable;
  await h.closeQueueAndRedis();
}

/** The character's active `GambitPage` row, as `queueBattles()` loaded it. */
async function loadActiveGambitPage(charId) {
  const { rows } = await h.sql(
    `SELECT gp.* FROM gambit_pages gp
       JOIN characters c ON c."activeGambitPageId" = gp.id
      WHERE c.id = $1`,
    [charId],
  );
  return rows[0] ?? null;
}

/**
 * Replicates `BattleService.getWeaponBaseAttackTicks()` for a character with no
 * equipped weapon (battle.service.ts:179-186): the rounded average of the whole
 * `skill_trees.json` table.
 */
function weaponBaseAttackTicksFor(equippedWeaponTypes) {
  const table = skillTrees.weaponBaseAttackTicks ?? {};
  for (const wt of equippedWeaponTypes) {
    if (table[wt]) return table[wt];
  }
  const values = Object.values(table);
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 6;
}

// ---------------------------------------------------------------------------
//  §6 — no unseeded randomness in the deterministic path
// ---------------------------------------------------------------------------

/**
 * STATUS.md §6 claims the engine never calls `Math.random()`. A single stray
 * call would make every determinism guarantee above vacuous, so the claim is
 * verified by scanning the source rather than taken on trust.
 */
function assertNoUnseededRandomness() {
  const sharedSrc = path.join(h.REPO_ROOT, 'packages', 'shared', 'src');
  const offenders = [];
  let filesScanned = 0;

  /**
   * Strip comments before scanning. `prng.ts`, `rewards.ts` and `index.ts` all
   * *document* the "never Math.random()" rule in their doc comments, so a naive
   * substring scan reports three false positives. A comment is not a call; only
   * executable code counts.
   */
  const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith('.ts')) {
        filesScanned += 1;
        stripComments(fs.readFileSync(full, 'utf8'))
          .split('\n')
          .forEach((lineText, i) => {
            if (lineText.includes('Math.random(')) {
              offenders.push(`${path.relative(h.REPO_ROOT, full)}:${i + 1}`);
            }
          });
      }
    }
  };
  walk(sharedSrc);

  h.assert(
    '§3.1 no Math.random() in packages/shared/src code (the deterministic path is fully seeded)',
    offenders.length === 0,
    offenders.length === 0
      ? `scanned ${filesScanned} file(s) under ${path.relative(h.REPO_ROOT, sharedSrc)} with comments stripped — 0 matches`
      : `Math.random() called at ${offenders.join(', ')}`,
  );
}

/**
 * Key-sorted JSON, so a comparison survives Postgres `jsonb` reordering keys on
 * the way in and out. Plain `JSON.stringify` would report a spurious mismatch
 * purely from key order.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return `${i} (stored ...${a.slice(Math.max(0, i - 40), i + 40)}... vs replay ...${b
        .slice(Math.max(0, i - 40), i + 40)}...)`;
    }
  }
  return `${n} (lengths ${a.length} vs ${b.length})`;
}

async function main() {
  console.log('=== Phase 3 · Determinism (SPEC §3.1) ===\n');
  console.log(`Shared package : ${require.resolve('@nanommo/shared')}`);
  console.log(`Fixture        : level ${SNAPSHOT.level} char vs ${MONSTER.id} on ${MAP_ID}`);
  console.log(`Seed           : ${SEED}`);
  console.log(`Gambit page    : ${GAMBIT_PAGE.lines.length} lines, inventory ${JSON.stringify(INVENTORY)}`);
  console.log(`Catalog actions: ${catalog.actions.map((a) => a.id).join(', ')}\n`);

  assertRepeatable();
  assertSeedMatters();
  assertNoUnseededRandomness();
  await assertStoredBattleReplays();

  h.summarize('Determinism');
}

main().catch((error) => {
  console.error('FATAL:', error);
  h.closeQueueAndRedis().finally(() => process.exit(1));
});
