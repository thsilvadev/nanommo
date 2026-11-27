const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BattleEngine } = require('../dist/battle-engine');

test('physical hits use 10% more effective DEF for small and large hits', () => {
  for (const [raw, def, expected] of [
    [44, 10, 37.4705938697318],
    [44, 54, 10.307682611506142],
    [44, 64, 4.412084893882647],
    [1000, 54, 782.7705138978669],
    [1000, 250, 359.3154761904762],
  ]) {
    assert(Math.abs(BattleEngine.calculatePhysicalDamage(raw, def) - expected) < 1e-9,
      `raw=${raw}, DEF=${def} should deal ${expected} before variance and rounding`);
  }
});

test('defense tuning preserves unarmored damage and the physical damage floor', () => {
  assert.equal(BattleEngine.calculatePhysicalDamage(44, 0), 44);
  assert.equal(BattleEngine.calculatePhysicalDamage(44, -10), 44);
  assert.equal(BattleEngine.calculatePhysicalDamage(-44, 54), 0);
  assert.equal(BattleEngine.calculatePhysicalDamage(0, 54), 0);
  assert.equal(BattleEngine.calculatePhysicalDamage(44, 10000), 0.44);
});

test('magic mitigation retains its percentage behavior', () => {
  assert.equal(BattleEngine.calculateMagicDamage(1000, 25), 750);
  assert.equal(BattleEngine.calculateMagicDamage(1000, 0), 1000);
  assert.equal(BattleEngine.calculateMagicDamage(1000, 100), 0);
});
