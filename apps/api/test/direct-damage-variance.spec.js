const assert = require('node:assert/strict');
const { BattleEngine, Mulberry32 } = require('../../../packages/shared/dist');

describe('Direct damage variance', () => {
  it('keeps the multiplier inside the requested ±1% range', () => {
    for (let seed = 0; seed < 1000; seed += 1) {
      const rng = new Mulberry32(seed);
      const base = 1000;
      const varied = BattleEngine.applyDirectDamageVariance(base, rng);
      assert.ok(varied >= 990 && varied <= 1010, `seed ${seed}: ${varied}`);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = BattleEngine.applyDirectDamageVariance(1000, new Mulberry32('same-seed'));
    const b = BattleEngine.applyDirectDamageVariance(1000, new Mulberry32('same-seed'));
    assert.equal(a, b);
  });

  it('can produce different direct damage for different battle seeds', () => {
    const makeBattle = (seed) => BattleEngine.simulateBattle(
      {
        level: 1, hp: 1000, sp: 0, maxHp: 1000, maxSp: 0,
        atk: 100, matk: 0, def: 0, mdefPercent: 0,
        accuracy: 100, evasion: 0, critChance: 0,
        hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 5, dex: 5,
        statusEffects: [],
      },
      {
        id: 'variance_dummy', hp: 30000, atk: 0, matk: 0, def: 0,
        mdefPercent: 0, accuracy: 0, evasion: 0, critChance: 0,
        atkSpeedTicks: 100,
        gambit: [{ priority: 1, condition: { type: 'always' }, action: { type: 'attack' } }],
      },
      { lines: [{ priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } }] },
      seed,
      { weaponBaseAttackTicks: 2 },
    );

    const results = new Set();
    for (let i = 0; i < 100; i += 1) {
      const result = makeBattle(`variance-seed-${i}`);
      assert.ok(result.durationTicks > 200, 'battle must continue past the former 200-tick cap');
      assert.equal(result.outcome, 'win');
      const hit = result.log.events.find((event) => event.action === 'attack' && event.actor === 'character' && event.hit === true);
      if (hit) results.add(hit.damage);
    }
    assert.ok(results.size > 1, 'different seeds should be able to change direct damage');
  });

  it('does not alter misses into damage', () => {
    const result = BattleEngine.simulateBattle(
      {
        level: 1, hp: 100, sp: 0, maxHp: 100, maxSp: 0,
        atk: 100, matk: 0, def: 0, mdefPercent: 0,
        accuracy: 0, evasion: 100, critChance: 100,
        hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 5, dex: 5,
        statusEffects: [],
      },
      {
        id: 'miss_dummy', hp: 1000, atk: 0, matk: 0, def: 0,
        mdefPercent: 0, accuracy: 0, evasion: 100, critChance: 0,
        atkSpeedTicks: 100,
        gambit: [{ priority: 1, condition: { type: 'always' }, action: { type: 'attack' } }],
      },
      { lines: [{ priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } }] },
      'miss-variance-seed',
      { weaponBaseAttackTicks: 2 },
    );

    const attack = result.log.events.find((event) => event.action === 'attack' && event.actor === 'character');
    assert.ok(attack);
    assert.equal(attack.hit, false);
    assert.equal(attack.damage, 0);
  });
});
