const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const {
  BattleEngine,
  secondsToBattleTicks,
  millisecondsToBattleTicks,
  battleTicksToMilliseconds,
  statusEffectsForBattle,
  persistStatusEffectsAtCheckpoint,
  effectiveSkillCastTicks,
} = require('../../../packages/shared/dist/battle-engine');
const { getBattleRuntimeConfig } = require('../dist/apps/api/src/config/battle-runtime.config');

const root = path.resolve(__dirname, '../../..');

function baselineCharacter(overrides = {}) {
  const derived = BattleEngine.calculateDerivedStats(1, { str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5 }, {});
  return {
    ...derived, level: 1, hp: 100000, sp: 0, maxHp: 100000, maxSp: 0,
    atk: 1, matk: 0, def: 9999, accuracy: 100, evasion: 9999, critChance: 0,
    attackSpeed: 0, moveSpeedBase: 0, moveSpeed: 0, statusEffects: [],
    hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, combatStyle: 'melee',
    basicAttackDamageType: 'melee', basicAttackRange: 0,
    ...overrides,
  };
}

const slowMonster = {
  id: 'tickrate_target', level: 1, hp: 100000, atk: 0, matk: 0, def: 0,
  mdefPercent: 0, accuracy: 0, evasion: 0, critChance: 0,
  atkSpeedTicks: 99, combatStyle: 'melee', basicAttackDamageType: 'melee',
  basicAttackRange: 0, moveSpeedBase: 0, canMove: false, gambit: [],
};
const alwaysAttack = { lines: [{ priority: 1, condition: { id: 'always' }, action: { id: 'attack' } }] };

function attackEvents(speed, overrides = {}) {
  const result = BattleEngine.simulateBattle(
    baselineCharacter({ attackSpeed: speed, ...overrides }),
    { ...slowMonster, hp: 4 },
    alwaysAttack,
    `tickrate-attack-${speed}-${JSON.stringify(overrides)}`,
    { statusEffectDefs: {} },
  );
  return result.log.events.filter(event => event.actor === 'character' && event.action === 'attack').map(event => event.tick);
}

function getTickFields(data, pathName, out = []) {
  if (!data || typeof data !== 'object') return out;
  for (const [key, value] of Object.entries(data)) {
    const current = `${pathName}.${key}`;
    if (/Ticks$/.test(key)) out.push([current, value]);
    if (value && typeof value === 'object') getTickFields(value, current, out);
  }
  return out;
}

function run() {
  // Central conversion contract: positive deadlines round up, never expire early.
  assert.equal(secondsToBattleTicks(0), 0);
  assert.equal(secondsToBattleTicks(-1), 0);
  assert.equal(secondsToBattleTicks(Number.NaN), 0);
  assert.equal(secondsToBattleTicks(0.001), 1);
  assert.equal(secondsToBattleTicks(0.5), 1);
  assert.equal(secondsToBattleTicks(1), 2);
  assert.equal(secondsToBattleTicks(10), 20);
  assert.equal(millisecondsToBattleTicks(0), 0);
  assert.equal(millisecondsToBattleTicks(1), 1);
  assert.equal(millisecondsToBattleTicks(500), 1);
  assert.equal(millisecondsToBattleTicks(501), 2);
  assert.equal(millisecondsToBattleTicks(1000), 2);
  assert.equal(battleTicksToMilliseconds(2), 1000);
  assert.equal(battleTicksToMilliseconds(0), 0);

  // Startup config is pinned to 500 ms and rejects inconsistent worker settings.
  assert.deepEqual(getBattleRuntimeConfig({}), {
    tickDurationMs: 500, battleResolveConcurrency: 4, battleQueueConcurrency: 2, worldActivityConcurrency: 1,
  });
  assert.deepEqual(getBattleRuntimeConfig({
    BATTLE_TICK_DURATION_MS: '500', BATTLE_RESOLVE_CONCURRENCY: '8',
    BATTLE_QUEUE_CONCURRENCY: '3', WORLD_ACTIVITY_CONCURRENCY: '2',
  }), { tickDurationMs: 500, battleResolveConcurrency: 8, battleQueueConcurrency: 3, worldActivityConcurrency: 2 });
  assert.throws(() => getBattleRuntimeConfig({ BATTLE_TICK_DURATION_MS: '1000' }), /supports only 500/);
  assert.throws(() => getBattleRuntimeConfig({ BATTLE_RESOLVE_CONCURRENCY: '0' }), /between 1 and 8/);
  assert.throws(() => getBattleRuntimeConfig({ BATTLE_QUEUE_CONCURRENCY: 'nine' }), /between 1 and 8/);
  assert.throws(() => getBattleRuntimeConfig({ WORLD_ACTIVITY_CONCURRENCY: '9' }), /between 1 and 8/);

  // Decorator metadata is evaluated before Nest ConfigModule loads .env. Verify
  // the runtime helper reads only the four documented keys and honours process env.
  const runtimeEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanommo-battle-runtime-'));
  const runtimeKeys = ['BATTLE_TICK_DURATION_MS', 'BATTLE_RESOLVE_CONCURRENCY', 'BATTLE_QUEUE_CONCURRENCY', 'WORLD_ACTIVITY_CONCURRENCY'];
  const previousRuntimeEnv = Object.fromEntries(runtimeKeys.map(key => [key, process.env[key]]));
  try {
    for (const key of runtimeKeys) delete process.env[key];
    fs.writeFileSync(path.join(runtimeEnvDir, '.env'), 'BATTLE_TICK_DURATION_MS=500\nBATTLE_RESOLVE_CONCURRENCY=6\nBATTLE_QUEUE_CONCURRENCY=3\nWORLD_ACTIVITY_CONCURRENCY=2\nDATABASE_URL=do-not-read\n');
    const previousCwd = process.cwd();
    process.chdir(runtimeEnvDir);
    try {
      assert.deepEqual(getBattleRuntimeConfig(), { tickDurationMs: 500, battleResolveConcurrency: 6, battleQueueConcurrency: 3, worldActivityConcurrency: 2 });
      process.env.BATTLE_RESOLVE_CONCURRENCY = '5';
      assert.equal(getBattleRuntimeConfig().battleResolveConcurrency, 5, 'process env overrides .env for decorator metadata');
    } finally {
      process.chdir(previousCwd);
    }
  } finally {
    for (const key of runtimeKeys) {
      if (previousRuntimeEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousRuntimeEnv[key];
    }
    fs.rmSync(runtimeEnvDir, { recursive: true, force: true });
  }

  // The formula is continuous and clamps the effective rating to 0..800.
  assert.equal(BattleEngine.attackDurationTicks(-1), 16);
  assert.equal(BattleEngine.attackDurationTicks(0), 16);
  assert.equal(BattleEngine.attackDurationTicks(800), 0);
  assert.equal(BattleEngine.attackDurationTicks(801), 0);
  assert.equal(BattleEngine.attackDurationTicks(210), 11.8);
  assert.equal(BattleEngine.castGaugeThreshold(5), 16);
  assert.equal(BattleEngine.castGaugeThreshold(20), 14);
  assert.equal(BattleEngine.castGaugeThreshold(50), 12);
  assert.equal(BattleEngine.castGaugeThreshold(100), 6);

  // Assert real simulator event-to-event timings, including the fixed one-second lock.
  const expectedIntervals = new Map([[0, 18], [100, 16], [200, 14], [210, 14], [300, 12], [400, 10], [600, 6], [700, 4], [800, 2]]);
  for (const [speed, expected] of expectedIntervals) {
    const ticks = attackEvents(speed).slice(0, 4);
    assert(ticks.length >= 3, `enough attack events at AS ${speed}`);
    assert.deepEqual(ticks.slice(1).map((tick, index) => tick - ticks[index]), [expected, expected, expected], `AS ${speed} event interval`);
  }
  assert.deepEqual(attackEvents(210).slice(0, 2).map((tick, index, arr) => index ? tick - arr[index - 1] : tick), [11, 14], 'AS 210 first hit and subsequent cadence preserve fractional gauge progress');
  assert.deepEqual(attackEvents(0, { statusEffects: [{ type: 'haste', attackSpeedMultiplier: 2 }] }).slice(0, 2), [7, 17], 'a 2x temporary Attack Speed multiplier halves preparation but not the 1-second lock');
  const freezeTicks = attackEvents(110, { statusEffects: [{ type: 'freeze', appliedAtTick: 0, expiresAtTick: 100, attackSpeedPenalty: 25 }] }).slice(0, 2);
  assert.equal(freezeTicks[0], 14, 'status penalties affect the effective rating before the first attack');
  assert.equal(freezeTicks[1] - freezeTicks[0], 17, 'the status penalty preserves the fixed lock and adds the rounded preparation interval');

  // Skill cast and all tick-native fields doubled; seconds lost to CTR remain tick-based.
  assert.equal(effectiveSkillCastTicks(4, 0), 4);
  assert.equal(effectiveSkillCastTicks(4, 100), 3);
  assert.equal(effectiveSkillCastTicks(4, 200), 2);
  assert.equal(effectiveSkillCastTicks(4, 400), 0);
  assert.equal(effectiveSkillCastTicks(undefined, 0), 4);

  // Monster basic attacks use doubled catalogue thresholds while their wall-clock cadence stays constant.
  const monsterAttackResult = BattleEngine.simulateBattle(
    baselineCharacter({ hp: 10000, maxHp: 10000, attackSpeed: 0 }),
    { ...slowMonster, hp: 100000, atk: 100, accuracy: 1000, atkSpeedTicks: 8,
      basicAttackRange: 0, gambit: [{ priority: 1, condition: { type: 'always' }, action: { type: 'attack' } }] },
    { lines: [] },
    'tickrate-monster-basic-attack',
    { statusEffectDefs: {} },
  );
  const monsterAttackTicks = monsterAttackResult.log.events.filter(event => event.actor === 'monster' && event.action === 'attack').slice(0, 3).map(event => event.tick);
  assert.deepEqual(monsterAttackTicks, [7, 15, 23], 'eight monster attack ticks preserve the four-second cadence on the 500 ms clock');

  // Periodic damage keeps its old five-second cadence after its interval doubles.
  const dotResult = BattleEngine.simulateBattle(
    baselineCharacter({ hp: 1000, maxHp: 1000 }),
    { ...slowMonster, hp: 15, statusEffects: [{
      type: 'burn', appliedAtTick: 0, expiresAtTick: 100, damagePerTick: 5,
      damageIntervalTicks: 10, nextDamageAtTick: 10, damageType: 'pure', sourceActor: 'character',
    }] },
    { lines: [] },
    'tickrate-periodic-damage',
    { statusEffectDefs: {} },
  );
  const burnTicks = dotResult.log.events.filter(event => event.action === 'status_damage' && event.status === 'burn').map(event => event.tick);
  assert.deepEqual(burnTicks, [10, 20, 30], 'Burn pulses every ten half-second ticks (five seconds) with the same damage amount');
  assert(dotResult.log.events.filter(event => event.action === 'status_damage' && event.status === 'burn').every(event => event.damage === 5));

  // Persistent status expiry crosses the API boundary through the per-entry tick length.
  const carried = statusEffectsForBattle([{ type: 'slow', expiresAt: new Date(2000).toISOString() }], 1000, 500);
  assert.equal(carried[0].expiresAtTick, 2);
  const persisted = persistStatusEffectsAtCheckpoint(carried, 0, 1500, 500);
  assert.equal(Date.parse(persisted[0].expiresAt), 2000);

  // Regeneration remains 10 seconds (20 combat ticks) with amounts unchanged.
  const regen = BattleEngine.simulateBattle(
    baselineCharacter({ hp: 100, maxHp: 1000, hpRegenPerTenTicks: 8, sp: 100, maxSp: 1000, spRegenPerTenTicks: 2 }),
    { ...slowMonster, hp: 4 },
    alwaysAttack,
    'tickrate-regen-10-seconds',
    { statusEffectDefs: {} },
  );
  const regenEvents = regen.log.events.filter(event => event.actor === 'character' && event.action === 'regen');
  assert.deepEqual(regenEvents.filter(event => event.resource === 'HP').map(event => event.tick).slice(0, 3), [19, 39, 59]);
  assert.deepEqual(regenEvents.filter(event => event.resource === 'HP').map(event => event.amount).slice(0, 3), [8, 8, 8]);

  // Lane movement meters accumulate at 500 ms but only resolve on whole seconds.
  const rangedTarget = { ...slowMonster, id: 'stationary_ranged_target', hp: 10, combatStyle: 'ranged', basicAttackDamageType: 'ranged', basicAttackRange: 6 };
  for (const [speed, firstMove] of [[50, 4], [100, 2], [150, 2], [200, 2], [400, 2]]) {
    const result = BattleEngine.simulateBattle(
      baselineCharacter({ attackSpeed: 800, moveSpeedBase: speed, moveSpeed: speed }),
      rangedTarget,
      alwaysAttack,
      `tickrate-movement-${speed}`,
      { statusEffectDefs: {} },
    );
    const moves = result.log.events.filter(event => event.actor === 'character' && event.action === 'move');
    assert.equal(moves[0]?.tick, firstMove, `Move Speed ${speed} first whole-second movement boundary`);
    assert(moves.slice(1).every((event, index) => event.tick - moves[index].tick >= 2), `Move Speed ${speed} never moves more than one space per second`);
  }

  // Catalogue mirrors are exact; only tick-native numeric *Ticks fields were doubled.
  for (const file of ['skill_trees.json', 'monsters.json', 'status_effects.json']) {
    const current = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    const mirror = JSON.parse(fs.readFileSync(path.join(root, 'apps/frontend/public/data', file), 'utf8'));
    assert.deepEqual(mirror, current, `${file} frontend mirror matches canonical root data`);
    const previous = JSON.parse(execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8' }));
    const before = new Map(getTickFields(previous, file));
    for (const [field, value] of getTickFields(current, file)) {
      if (field.endsWith('.hpRegenPerTenTicks') || field.endsWith('.spRegenPerTenTicks')) {
        assert.equal(value, before.get(field), `${field} remains a regen amount rather than a cadence`);
      } else if (typeof value === 'number') {
        assert.equal(value, before.get(field) * 2, `${field} doubles exactly`);
      } else if (Array.isArray(value)) {
        assert.deepEqual(value, before.get(field).map(entry => entry * 2), `${field} rank arrays double exactly`);
      }
    }
  }
  const monsters = JSON.parse(fs.readFileSync(path.join(root, 'monsters.json'), 'utf8'));
  assert(!JSON.stringify(monsters).includes('every_n_ticks'), 'temporal Gambit conditions have been removed from monster catalogues');
  const guardian = monsters.monsters.find(monster => monster.id === 'mon_ruinsguardian');
  assert.equal(guardian.gambit[0].condition.type, 'always');

  // Items carry seconds-based durations/cooldowns and regen amounts, not combat ticks.
  const items = JSON.parse(fs.readFileSync(path.join(root, 'items.json'), 'utf8'));
  const oldItems = JSON.parse(execFileSync('git', ['show', 'HEAD:items.json'], { cwd: root, encoding: 'utf8' }));
  assert.deepEqual(items, oldItems, 'seconds-based item catalogue is unchanged byte-for-byte at the JSON value level');

  const serviceSource = fs.readFileSync(path.join(root, 'apps/api/src/modules/battle/battle.service.ts'), 'utf8');
  assert.match(serviceSource, /tickDurationMs: BATTLE_TICK_DURATION_MS/);
  assert.match(serviceSource, /simulation\.durationTicks \* MS_PER_TICK/);
  assert.match(serviceSource, /secondsToBattleTicks\(10, BATTLE_TICK_DURATION_MS\)/);
  assert.match(serviceSource, /\* MS_PER_SECOND/);
  const migrationSource = fs.readFileSync(path.join(root, 'apps/api/src/database/migrations/1800300000000-BattleTickDuration.ts'), 'utf8');
  assert.match(migrationSource, /SET \"tickDurationMs\" = 1000 WHERE \"tickDurationMs\" IS NULL/, 'existing 1-second history retains its original wall-clock tick interpretation');
  assert.match(migrationSource, /SET DEFAULT 500/);
  assert.match(migrationSource, /SET NOT NULL/);
  assert.match(migrationSource, /DROP COLUMN IF EXISTS \"tickDurationMs\"/, 'schema downgrade is reversible after the documented targeted queue cleanup');
  console.log('battle-tickrate-500ms: deterministic timing, fixed lock, status/cast/regen/movement timing, catalogue conversions and mirrors passed');
}

run();
