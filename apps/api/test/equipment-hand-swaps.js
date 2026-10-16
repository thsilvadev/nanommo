const assert = require('node:assert/strict');
const { EquipmentService } = require('../dist/apps/api/src/modules/equipment/equipment.service.js');

const items = {
  greatsword: { id: 'equip_greatsword_t1', type: 'equipment', slot: 'mainHand', weaponType: 'greatsword', twoHanded: true, fixedStats: { atk: 20 } },
  sword: { id: 'equip_sword_t1', type: 'equipment', slot: 'mainHand', weaponType: 'sword', twoHanded: false, allowedOffHandTypes: ['dagger','shield','rune'], fixedStats: { atk: 8 } },
  dagger: { id: 'equip_dagger_t1', type: 'equipment', slot: 'mainHand', weaponType: 'dagger', secondaryHand: true, twoHanded: false, allowedOffHandTypes: ['dagger','shield','rune'], fixedStats: { atk: 6 } },
  shield: { id: 'equip_shield_t1', type: 'equipment', slot: 'offHand', weaponType: 'shield', fixedStats: { def: 5 } },
};

function makeHarness({ status = 'town', equipped = [], inventory = [] } = {}) {
  const character = {
    id: 'c1', level: 1, status, pendingEquipmentChanges: null,
    lastSeenAt: new Date(),
  };
  const equipmentRows = [...equipped];
  const inventoryRows = [...inventory];

  const equipmentRepo = {
    find: async () => equipmentRows,
    findOne: async ({ where }) => equipmentRows.find(
      (row) => row.characterId === where.characterId && row.slot === where.slot,
    ) ?? null,
    save: async (row) => {
      const index = equipmentRows.findIndex((x) => x.id === row.id);
      if (index >= 0) equipmentRows[index] = row;
      else equipmentRows.push({ ...row, id: row.id ?? `eq-${equipmentRows.length}` });
      return row;
    },
    create: (row) => ({ ...row, id: row.id ?? `eq-${equipmentRows.length}` }),
    delete: async (id) => {
      const index = equipmentRows.findIndex((x) => x.id === (id?.id ?? id));
      if (index >= 0) equipmentRows.splice(index, 1);
    },
  };

  const inventoryRepo = {
    findOne: async ({ where }) => inventoryRows.find(
      (row) => row.characterId === where.characterId &&
        row.location === where.location &&
        row.itemId === where.itemId,
    ) ?? null,
    find: async () => inventoryRows,
    save: async (row) => {
      inventoryRows.push({ ...row, id: row.id ?? `inv-${inventoryRows.length}` });
      return row;
    },
    create: (row) => ({ ...row, id: row.id ?? `inv-${inventoryRows.length}` }),
    delete: async (id) => {
      const index = inventoryRows.findIndex((x) => x.id === (id?.id ?? id));
      if (index >= 0) inventoryRows.splice(index, 1);
    },
  };

  const characterRepo = {
    findOne: async () => character,
    save: async (row) => row,
  };
  const queueRepo = { findOne: async () => status === 'grinding' ? { resolved: false, sequenceIndex: 0, startAt: new Date(Date.now() - 1000), endAt: new Date(Date.now() + 60000) } : null };
  const data = { getItemById: (id) => Object.values(items).find((x) => x.id === id) ?? null };

  const service = new EquipmentService(
    equipmentRepo, characterRepo, {}, inventoryRepo, queueRepo, data,
    { runFutureCombatMutation: async (_characterId, mutate) => mutate() },
  );

  return { service, character, equipmentRows, inventoryRows };
}

(async () => {
  {
    const { service, equipmentRows, inventoryRows } = makeHarness({
      equipped: [{ id: 'eq-gs', characterId: 'c1', slot: 'mainHand', itemId: items.greatsword.id, instanceData: null }],
      inventory: [{ id: 'inv-shield', characterId: 'c1', location: 'inventory', itemId: items.shield.id, slotIndex: 0, quantity: 1, instanceData: null }],
    });
    await assert.rejects(service.equipItem('c1', 'offHand', items.shield.id));
    assert.equal(equipmentRows.find((x) => x.slot === 'mainHand')?.itemId, items.greatsword.id);
    assert.equal(equipmentRows.some((x) => x.slot === 'offHand'), false);
    assert.equal(inventoryRows.some((x) => x.itemId === items.shield.id), true);
  }

  {
    const { service, equipmentRows, inventoryRows } = makeHarness({
      equipped: [{ id: 'eq-shield', characterId: 'c1', slot: 'offHand', itemId: items.shield.id, instanceData: null }],
      inventory: [{ id: 'inv-gs', characterId: 'c1', location: 'inventory', itemId: items.greatsword.id, slotIndex: 0, quantity: 1, instanceData: null }],
    });
    await service.equipItem('c1', 'mainHand', items.greatsword.id);
    assert.equal(equipmentRows.find((x) => x.slot === 'mainHand')?.itemId, items.greatsword.id);
    assert.equal(equipmentRows.some((x) => x.slot === 'offHand'), false);
    assert.equal(inventoryRows.some((x) => x.itemId === items.shield.id), true);
  }

  {
    const { service } = makeHarness({
      equipped: [{ id: 'eq-gs', characterId: 'c1', slot: 'mainHand', itemId: items.greatsword.id, instanceData: null }],
      inventory: [{ id: 'inv-shield', characterId: 'c1', location: 'inventory', itemId: items.shield.id, slotIndex: 0, quantity: 1, instanceData: null }],
    });
    const result = await service.validateWeaponCombination('c1', undefined, items.shield.id);
    assert.equal(result.valid, false);
  }

  {
    const { service, equipmentRows, inventoryRows } = makeHarness({
      equipped: [{ id: 'eq-sword', characterId: 'c1', slot: 'mainHand', itemId: items.sword.id, instanceData: null }],
      inventory: [{ id: 'inv-dagger', characterId: 'c1', location: 'inventory', itemId: items.dagger.id, slotIndex: 0, quantity: 1, instanceData: null }],
    });
    await service.equipItem('c1', 'offHand', items.dagger.id);
    assert.equal(equipmentRows.find((x) => x.slot === 'offHand')?.itemId, items.dagger.id);
    assert.equal(inventoryRows.some((x) => x.itemId === items.dagger.id), false);
  }

  {
    const { service } = makeHarness({
      equipped: [{ id: 'eq-sword', characterId: 'c1', slot: 'mainHand', itemId: items.sword.id, instanceData: null }],
      inventory: [{ id: 'inv-sword2', characterId: 'c1', location: 'inventory', itemId: items.sword.id, slotIndex: 0, quantity: 1, instanceData: null }],
    });
    await assert.rejects(service.equipItem('c1', 'offHand', items.sword.id));
  }

  {
    const { service, character, equipmentRows, inventoryRows } = makeHarness({
      status: 'grinding',
      equipped: [{ id: 'eq-sword', characterId: 'c1', slot: 'mainHand', itemId: items.sword.id, instanceData: null }],
      inventory: [{ id: 'inv-shield', characterId: 'c1', location: 'inventory', itemId: items.shield.id, slotIndex: 0, quantity: 1, instanceData: null }],
    });
    await service.equipItem('c1', 'offHand', items.shield.id);
    assert.equal(character.pendingEquipmentChanges.offHand.itemId, items.shield.id);
    assert.equal(equipmentRows.find((x) => x.slot === 'mainHand')?.itemId, items.sword.id);
    assert.equal(inventoryRows.some((x) => x.itemId === items.shield.id), false);

    await service.applyPendingEquipmentChanges('c1');
    assert.equal(equipmentRows.find((x) => x.slot === 'offHand')?.itemId, items.shield.id);
  }

  {
    const { service } = makeHarness({
      equipped: [
        { id: 'eq-sword', characterId: 'c1', slot: 'mainHand', itemId: items.sword.id, instanceData: null },
        { id: 'eq-dagger', characterId: 'c1', slot: 'offHand', itemId: items.dagger.id, instanceData: null },
      ],
    });
    const stats = await service.calculateEquipmentStats('c1');
    assert.equal(stats.weaponFixedAtk, 11, 'main hand 8 plus half of secondary Dagger ATK 6');
    const derived = await service.calculateDerivedStats({ id: 'c1', level: 1, str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5 });
    assert.equal(derived.atk, 21, 'derived ATK includes each weapon contribution exactly once');
  }

  console.log('equipment-hand-swaps: passed including staged swaps, pairing matrix and non-duplicated secondary ATK');
})();
