const assert = require('node:assert/strict');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service.js');
const { BattleEngine } = require('../../../packages/shared/dist/battle-engine');

describe('battle food regeneration snapshot', () => {
  function makeService() {
    // buildCharacterSnapshot uses only the supplied loadout in this test, so no
    // Nest container, database, or external services need to be initialized.
    return Object.create(BattleService.prototype);
  }

  const loadout = {
    equipmentStats: {
      statBonus: { STR: 0, AGI: 0, DEX: 0, VIT: 0, INT: 0, SOR: 0 },
      def: 0,
      mdefPercent: 0,
      weaponFixedAtk: 0,
      weaponFixedMatk: 0,
    },
    skills: {},
    skillDefs: {},
    weaponTypes: [],
  };

  const now = Date.parse('2026-10-13T12:00:00.000Z');
  const character = {
    id: 'regen-regression-character',
    name: 'Regen regression',
    level: 1,
    str: 5,
    agi: 5,
    dex: 5,
    vit: 14,
    int: 5,
    sor: 5,
    statusEffects: [],
    dietLevels: {},
    activeFoodBuff: {
      itemId: 'food_bread',
      expiresAt: new Date(now + 60_000).toISOString(),
      hpRegenPerTenTicks: 7,
      spRegenPerTenTicks: 4,
    },
  };

  it('keeps base regen separate from food regen, preventing a double addition', async () => {
    const snapshot = await makeService().buildCharacterSnapshot(
      character, 100, 20, now, character.activeFoodBuff, loadout,
    );

    assert.equal(snapshot.hpRegenPerTenTicks, 8, 'VIT 14 yields 8 base HP regen');
    assert.equal(snapshot.foodBuffHpRegenPerTenTicks, 7, '3-star bread contributes its separate +7 HP regen');
    assert.equal(snapshot.spRegenPerTenTicks, 3, 'INT 5 yields 3 base SP regen');
    assert.equal(snapshot.foodBuffSpRegenPerTenTicks, 4, 'food SP regen remains separate too');
  });

  it('does not put an expired food bonus into base regen', async () => {
    const expiredFood = { ...character.activeFoodBuff, expiresAt: new Date(now - 1).toISOString() };
    const snapshot = await makeService().buildCharacterSnapshot(
      character, 100, 20, now, expiredFood, loadout,
    );

    assert.equal(snapshot.hpRegenPerTenTicks, 8);
    assert.equal(snapshot.foodBuffTicksRemaining, 0);
    assert.equal(snapshot.foodBuffHpRegenPerTenTicks, undefined);
  });
  it('stacks all active Diet foods in combat and expires each food independently', async () => {
    const service = makeService();
    service.dataService = {
      getItemById: (id) => ({
        food_cheese: { id: 'food_cheese', effect: { type: 'food_buff', hpRegenPerTenTicks: 8, spRegenPerTenTicks: 1, durationSeconds: 3600 } },
        food_bread: { id: 'food_bread', effect: { type: 'food_buff', hpRegenPerTenTicks: 4, spRegenPerTenTicks: 1, durationSeconds: 3600 } },
      })[id],
    };
    const dietCharacter = {
      ...character,
      diet: [
        { itemId: 'food_cheese', consumedAt: new Date(now - 1_000).toISOString(), digestUntil: new Date(now + 15_000).toISOString(), dietLevel: 0 },
        { itemId: 'food_bread', consumedAt: new Date(now - 1_000).toISOString(), digestUntil: new Date(now + 30_000).toISOString(), dietLevel: 3 },
      ],
      dietLevels: {
        food_cheese: { level: 0, lastDigestUntil: new Date(now + 15_000).toISOString() },
        food_bread: { level: 3, lastDigestUntil: new Date(now + 30_000).toISOString() },
      },
      activeFoodBuff: null,
    };
    const snapshot = await service.buildCharacterSnapshot(dietCharacter, 300, 20, now, undefined, loadout);
    assert.deepEqual(snapshot.foodBuffs.map((food) => [food.itemId, food.hpRegenPerTenTicks, food.spRegenPerTenTicks, food.remainingTicks]), [
      ['food_cheese', 8, 1, 15],
      ['food_bread', 7, 4, 30],
    ]);
    assert.equal(snapshot.hpRegenPerTenTicks, 8, 'Character Stats remains base-only');
    assert.equal(snapshot.spRegenPerTenTicks, 3, 'base SP regen remains separate');

    const combatSnapshot = {
      ...snapshot,
      hp: 300,
      maxHp: 100000,
      sp: 20,
      maxSp: 10000,
      atk: 1,
      matk: 1,
      def: 0,
      mdefPercent: 0,
      accuracy: 1000,
      evasion: 0,
      critChance: 0,
      attackSpeed: 0,
      agi: 5,
      dex: 5,
      statusEffects: [],
      skills: {},
      skillDefs: {},
      masteryEquipment: [],
      basicAttackDamageType: 'melee',
      combatStyle: 'melee',
      basicAttackRange: 0,
      position: 3,
      moveSpeedBase: 0,
      moveSpeed: 0,
    };
    const dummy = {
      id: 'food-regen-dummy', name: 'Food Regen Dummy', level: 1,
      hp: 3, atk: 0, matk: 0, def: 1000, mdefPercent: 0,
      accuracy: 0, evasion: 0, critChance: 0, atkSpeedTicks: 1000,
      combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0,
      moveSpeedBase: 0, gambit: [],
    };
    const battle = BattleEngine.simulateBattle(combatSnapshot, dummy, { lines: [
      { priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } },
    ] }, 'multi-food-regen-stacking-regression');
    const regen = battle.log.events.filter((event) => event.action === 'regen');
    assert(regen.some((event) => event.resource === 'HP' && event.amount === 23), 'HP regen is 8 base + 8 cheese + 7 three-star bread');
    assert(regen.some((event) => event.resource === 'HP' && event.amount === 15), 'after cheese expires, base + bread continue at 8 + 7');
    assert(regen.some((event) => event.resource === 'MP' && event.amount === 8), 'SP regen stacks 3 base + 1 cheese + 4 bread');
    assert(regen.some((event) => event.resource === 'MP' && event.amount === 7), 'after cheese expires, SP regen is 3 base + 4 bread');
  });

});
