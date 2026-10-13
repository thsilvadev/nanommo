const assert = require('node:assert/strict');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service.js');

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
});
