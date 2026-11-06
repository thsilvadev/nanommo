const assert = require('node:assert/strict');
const { GambitEvaluator } = require('@nanommo/shared');
const self = { hp: 80, maxHp: 100, sp: 24, maxSp: 80, statusEffects: [], cooldowns: {} };
const foe = { hp: 100, maxHp: 100, statusEffects: [], cooldowns: {} };
assert.equal(GambitEvaluator.evaluateCondition({ id: 'self_sp_below_percent', params: { value: 31 } }, self, foe), true);
assert.equal(GambitEvaluator.evaluateCondition({ id: 'self_sp_below_percent', value: 31 }, self, foe), true);
assert.equal(GambitEvaluator.evaluateCondition({ id: 'self_sp_below_percent', params: { value: 30 } }, self, foe), false);
assert.equal(GambitEvaluator.evaluateCondition({ id: 'self_hp_below_percent', params: { value: 30 } }, self, foe), false);
console.log('Gambit HP/SP percentage conditions passed.');
