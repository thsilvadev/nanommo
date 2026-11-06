const assert = require('node:assert/strict');
const { BattleEngine, persistStatusEffectsAtCheckpoint, statusEffectsForBattle } = require('../../../packages/shared/dist/battle-engine');

function character(overrides = {}) {
  return {
    level: 1, hp: 50, sp: 50, maxHp: 1000, maxSp: 1000,
    atk: 1, matk: 0, def: 0, mdefPercent: 0, accuracy: 50, evasion: 0, critChance: 0,
    hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 5, dex: 5, luk: 5,
    attackSpeed: 1, castTimeReduction: 10, equippedWeaponTypes: [], skills: {}, skillDefs: {},
    statusEffects: [], basicAttackRange: 0, basicAttackDamageType: 'melee', combatStyle: 'melee',
    ...overrides,
  };
}
function dummy(overrides = {}) {
  return {
    id: 'alchemy_test_dummy', name: 'Alchemy Test Dummy', level: 1, hp: 100000, atk: 1, matk: 0,
    def: 0, mdefPercent: 0, accuracy: 0, evasion: 0, critChance: 0, atkSpeedTicks: 999,
    moveSpd: 0, gambit: [], damageTakenMultiplier: { melee: 1, ranged: 1, magic: 1 },
    ...overrides,
  };
}

function testElixirRestoresHpAndSpWithSharedPotionCooldown() {
  const item = { id: 'elixir_greater', type: 'consumable', alchemyCategory: 'potions', cooldownInSeconds: 10, effect: { type: 'heal_hp_sp', hpAmount: 300, spAmount: 230 } };
  const result = BattleEngine.simulateBattle(character(), dummy(), { lines: [
    { priority: 1, conditions: [{ id: 'self_hp_below_percent', value: 90 }], action: { id: 'use_item', itemId: 'elixir_greater' } },
    { priority: 2, conditions: [{ id: 'always' }], action: { id: 'wait' } },
  ] }, 'alchemy-potion-test', { inventory: { elixir_greater: 2 }, itemDefinitions: { elixir_greater: item }, stopAfterTick: 20 });
  assert.equal(result.hpAfter, 350, 'Elixir restores the configured HP amount');
  assert.equal(result.spAfter, 280, 'Elixir restores the configured SP amount');
  assert.deepEqual(result.itemsConsumed, [{ itemId: 'elixir_greater', quantity: 1 }]);
  const use = result.log.events.find(event => event.action === 'use_item');
  assert.equal(use.healAmount, 300);
  assert.equal(use.spGain, 230);
  const cooldownProbe = BattleEngine.simulateBattle(character(), dummy(), { lines: [
    { priority: 1, conditions: [{ id: 'self_hp_below_percent', value: 90 }], action: { id: 'use_item', itemId: 'elixir_greater' } },
    { priority: 2, conditions: [{ id: 'always' }], action: { id: 'wait' } },
  ] }, 'alchemy-potion-cooldown-test', { inventory: { elixir_greater: 2 }, itemDefinitions: { elixir_greater: item }, stopAfterTick: 8 });
  assert.equal(cooldownProbe.cooldownsAfter['item:potion'], 9, 'the shared potion cooldown starts at 10 seconds and ticks down once per combat second');
}

function testFontouraAppliesThirtySecondDefenseBuffAndPersistsAcrossBattleBoundary() {
  const item = { id: 'tonic_fontoura', type: 'consumable', alchemyCategory: 'tonics', cooldownInSeconds: 30, effect: { type: 'apply_status', status: 'fontoura', durationSeconds: 30, defBonus: 15 } };
  const statusEffectDefs = { fontoura: { statusDurationTicks: 30, reapplication: 'refresh', polarity: 'buff' } };
  const result = BattleEngine.simulateBattle(character({ hp: 1000, sp: 1000 }), dummy(), { lines: [
    { priority: 1, conditions: [{ id: 'always' }], action: { id: 'use_item', itemId: 'tonic_fontoura' } },
    { priority: 2, conditions: [{ id: 'always' }], action: { id: 'wait' } },
  ] }, 'alchemy-tonic-test', { inventory: { tonic_fontoura: 1 }, itemDefinitions: { tonic_fontoura: item }, statusEffectDefs, stopAfterTick: 20 });
  assert.deepEqual(result.itemsConsumed, [{ itemId: 'tonic_fontoura', quantity: 1 }]);
  assert.equal(result.statusEffectsAfter[0].type, 'fontoura');
  assert.equal(result.statusEffectsAfter[0].defBonus, 15);
  const endAt = 1_000_000;
  const persisted = persistStatusEffectsAtCheckpoint(result.statusEffectsAfter, result.durationTicks - 1, endAt);
  assert.equal(persisted[0].defBonus, 15);
  assert.ok(Date.parse(persisted[0].expiresAt) > endAt);
  assert.equal(statusEffectsForBattle(persisted, endAt)[0].expiresAtTick, 16);
}

function testAllTonicStatusPayloadsAreApplied() {
  const cases = [
    ['tonic_fontoura', 'fontoura', { defBonus: 15 }],
    ['tonic_kombucha', 'kombucha', { mdefPercentBonus: 15 }],
    ['tonic_haste_shot', 'haste_shot', { attackSpeedMultiplier: 2 }],
    ['tonic_capo', 'capo', { castTimeReductionMultiplier: 2 }],
  ];
  for (const [itemId, statusId, values] of cases) {
    const item = { id: itemId, type: 'consumable', alchemyCategory: 'tonics', cooldownInSeconds: 30, effect: { type: 'apply_status', status: statusId, durationSeconds: 30, ...values } };
    const statusEffectDefs = { [statusId]: { statusDurationTicks: 30, reapplication: 'refresh', polarity: 'buff' } };
    const result = BattleEngine.simulateBattle(character({ hp: 1000, sp: 1000 }), dummy(), { lines: [
      { priority: 1, conditions: [{ id: 'always' }], action: { id: 'use_item', itemId } },
      { priority: 2, conditions: [{ id: 'always' }], action: { id: 'wait' } },
    ] }, `alchemy-${itemId}`, { inventory: { [itemId]: 1 }, itemDefinitions: { [itemId]: item }, statusEffectDefs, stopAfterTick: 20 });
    const applied = result.statusEffectsAfter.find(status => status.type === statusId);
    assert.ok(applied, `${itemId} applies ${statusId}`);
    for (const [key, value] of Object.entries(values)) assert.equal(applied[key], value, `${itemId} applies ${key}`);
    assert.equal(result.cooldownsAfter['item:tonic'] > 0, true, 'tonics share the 30-second cooldown category');
  }
}

function testTonicBuffsModifyCombatStatsAndHasteDoublesAttackFrequency() {
  const monster = dummy({ hp: 100000, atk: 100, matk: 100, accuracy: 1000, atkSpeedTicks: 2, gambit: [
    { priority: 1, condition: { type: 'always' }, action: { type: 'attack' } },
  ] });
  const waitPage = { lines: [{ priority: 1, conditions: [{ id: 'always' }], action: { id: 'wait' } }] };
  const physicalBase = BattleEngine.simulateBattle(character({ hp: 1000 }), monster, waitPage, 'tonic-defense-base', { stopAfterTick: 5 });
  const physicalBuffed = BattleEngine.simulateBattle(character({ hp: 1000, statusEffects: [{ type: 'fontoura', defBonus: 15 }] }), monster, waitPage, 'tonic-defense-base', { stopAfterTick: 5 });
  assert.ok(physicalBuffed.log.events.find(event => event.target === 'character' && event.damage > 0).damage < physicalBase.log.events.find(event => event.target === 'character' && event.damage > 0).damage, 'Fontoura reduces incoming physical damage');

  const magicMonster = { ...monster, basicAttackDamageType: 'magic' };
  const magicBase = BattleEngine.simulateBattle(character({ hp: 1000 }), magicMonster, waitPage, 'tonic-mdef-base', { stopAfterTick: 5 });
  const magicBuffed = BattleEngine.simulateBattle(character({ hp: 1000, statusEffects: [{ type: 'kombucha', mdefPercentBonus: 15 }] }), magicMonster, waitPage, 'tonic-mdef-base', { stopAfterTick: 5 });
  assert.ok(magicBuffed.log.events.find(event => event.target === 'character' && event.damage > 0).damage < magicBase.log.events.find(event => event.target === 'character' && event.damage > 0).damage, 'Kombucha reduces incoming magic damage');

  const attackPage = { lines: [{ priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } }] };
  const passiveMonster = { ...dummy({ hp: 100000 }), atk: 0, gambit: [] };
  const baseAttacks = BattleEngine.simulateBattle(character({ hp: 1000, attackSpeed: 100 }), passiveMonster, attackPage, 'haste-frequency', { stopAfterTick: 30 }).log.events.filter(event => event.action === 'attack');
  const hastedAttacks = BattleEngine.simulateBattle(character({ hp: 1000, attackSpeed: 100, statusEffects: [{ type: 'haste_shot', attackSpeedMultiplier: 2 }] }), passiveMonster, attackPage, 'haste-frequency', { stopAfterTick: 30 }).log.events.filter(event => event.action === 'attack');
  assert.ok(hastedAttacks.length >= baseAttacks.length * 1.6, 'Haste Shot doubles the basic attack frequency');
}

function testFairyTriggersOnlyUponDeathAndCleansEveryStatus() {
  const fairy = { id: 'fairy_in_a_bottle', type: 'consumable', effect: { type: 'revive_full_cleanse' } };
  const result = BattleEngine.simulateBattle(character({ hp: 1, statusEffects: [{ type: 'poison', expiresAtTick: 99 }] }), dummy({
    hp: 500, atk: 1000, accuracy: 1000, atkSpeedTicks: 2,
    gambit: [{ priority: 1, condition: { type: 'always' }, action: { type: 'attack' } }],
  }), { lines: [
    { priority: 1, conditions: [{ id: 'upon_death' }], action: { id: 'use_item', itemId: 'fairy_in_a_bottle' } },
    { priority: 2, conditions: [{ id: 'always' }], action: { id: 'attack' } },
  ] }, 'alchemy-fairy-test', { inventory: { fairy_in_a_bottle: 1 }, itemDefinitions: { fairy_in_a_bottle: fairy } });
  const revival = result.log.events.find(event => event.revived === true);
  assert.ok(revival, 'Upon Death Gambit consumes the Fairy and revives the Character');
  assert.equal(revival.restoredHp, 1000);
  assert.equal(revival.restoredSp, 1000);
  assert.deepEqual(revival.cleansedStatuses, ['poison']);
  assert.deepEqual(result.itemsConsumed, [{ itemId: 'fairy_in_a_bottle', quantity: 1 }]);
  assert.ok(result.log.events.some(event => event.reason === 'fairy_revival' && event.status === 'poison'));

  const missingCondition = BattleEngine.simulateBattle(character({ hp: 1 }), dummy({ hp: 500, atk: 1000, accuracy: 1000, atkSpeedTicks: 2, gambit: [{ priority: 1, condition: { type: 'always' }, action: { type: 'attack' } }] }), { lines: [
    { priority: 1, conditions: [{ id: 'always' }], action: { id: 'use_item', itemId: 'fairy_in_a_bottle' } },
  ] }, 'alchemy-fairy-condition-test', { inventory: { fairy_in_a_bottle: 1 }, itemDefinitions: { fairy_in_a_bottle: fairy } });
  assert.deepEqual(missingCondition.itemsConsumed, [], 'Fairy must not trigger unless the selected Gambit line explicitly uses Upon Death');
}

testElixirRestoresHpAndSpWithSharedPotionCooldown();
testFontouraAppliesThirtySecondDefenseBuffAndPersistsAcrossBattleBoundary();
testAllTonicStatusPayloadsAreApplied();
testTonicBuffsModifyCombatStatsAndHasteDoublesAttackFrequency();
testFairyTriggersOnlyUponDeathAndCleansEveryStatus();
console.log('Alchemy battle regressions passed: HP/SP potion, tonic status persistence, and Upon Death Fairy revival/cleanse.');
