const assert = require('node:assert/strict');
const {
  GambitEvaluator,
  normalizePersistentStatusEffects,
  persistStatusEffectsAtCheckpoint,
  statusEffectsForBattle,
} = require('../../../packages/shared/dist/battle-engine');

const now = Date.parse('2026-10-20T22:00:00.000Z');

{
  const checkpoint = persistStatusEffectsAtCheckpoint([
    { type: 'poison', appliedAtTick: 2, expiresAtTick: 15, sourceSkillId: 'poison_sting' },
  ], 6, now);
  assert.equal(checkpoint.length, 1);
  assert.equal(checkpoint[0].expiresAt, new Date(now + 8_000).toISOString());
  assert.equal('expiresAtTick' in checkpoint[0], false, 'persisted effects cannot keep battle-local expiry ticks');
  assert.equal('appliedAtTick' in checkpoint[0], false, 'persisted effects cannot keep battle-local application ticks');
}

{
  const persisted = [
    { type: 'poison', expiresAt: new Date(now + 8_000).toISOString(), sourceSkillId: 'poison_sting' },
  ];
  const inBattle = statusEffectsForBattle(persisted, now);
  assert.equal(inBattle.length, 1);
  assert.equal(inBattle[0].expiresAtTick, 8);
  assert.equal('expiresAt' in inBattle[0], false, 'battle snapshot should use relative ticks only');

  assert.deepEqual(statusEffectsForBattle(persisted, now + 9_000), [],
    'a status that expired between battles must not be copied into a new snapshot');
}

{
  const normalized = normalizePersistentStatusEffects([
    { type: 'poison', appliedAtTick: 0, expiresAtTick: 15, sourceSkillId: 'poison_sting' },
  ], now);
  assert.equal(normalized.changed, true);
  assert.deepEqual(normalized.statusEffects, [],
    'legacy battle-relative status rows have no trustworthy remaining wall-clock duration');
}

{
  const gambit = { lines: [{
    priority: 1,
    conditions: [{ id: 'self_has_status', status: 'poison' }],
    action: { id: 'use_item', itemId: 'antidote' },
  }] };
  const self = { hp: 100, maxHp: 100, sp: 10, maxSp: 10, statusEffects: [], cooldowns: {} };
  const foe = { hp: 100, maxHp: 100, statusEffects: [] };
  const inventory = { antidote: 1 };
  const items = { antidote: { type: 'consumable', effect: { type: 'cure_status', status: 'poison' } } };

  assert.equal(GambitEvaluator.evaluateGambitPage(gambit, 'cast', self, foe, inventory, items), null,
    'Antidote gambit is illegal when the Character has no active Poison');
  const poisoned = { ...self, statusEffects: [{ type: 'poison', expiresAtTick: 8 }] };
  assert.equal(GambitEvaluator.evaluateGambitPage(gambit, 'cast', poisoned, foe, inventory, items)?.action?.itemId, 'antidote',
    'Antidote gambit remains available for a real active Poison');
}

console.log('persistent-status-effects: passed');
