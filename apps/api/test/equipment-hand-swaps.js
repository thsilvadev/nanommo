const assert = require('node:assert/strict');
const { EquipmentService } = require('../dist/apps/api/src/modules/equipment/equipment.service.js');

const items = {
  greatsword: { id: 'equip_greatsword_t1', type: 'equipment', slot: 'mainHand', weaponType: 'greatsword', fixedStats: { atk: 20 } },
  sword: { id: 'equip_sword_t1', type: 'equipment', slot: 'mainHand', weaponType: 'sword', fixedStats: { atk: 8 } },
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
  const queueRepo = { findOne: async () => status === 'grinding' ? { resolved: false, sequenceIndex: 0 } : null };
  const data = { getItemById: (id) => Object.values(items).find((x) => x.id === id) ?? null };

  const service = new EquipmentService(
    equipmentRepo, characterRepo, {}, inventoryRepo, queueRepo, data,
  );

  return { service, character, equipmentRows, inventoryRows };
}

(async () => {
  {
    const { service, equipmentRows, inventoryRows } = makeHarness({
      equipped: [{ id: 'eq-gs', characterId: 'c1', slot: 'mainHand', itemId: items.greatsword.id, instanceData: null }],
      inventory: [{ id: 'inv-shield', characterId: 'c1', location: 'inventory', itemId: items.shield.id, slotIndex: 0, quantity: 1, instanceData: null }],
    });
    await service.equipItem('c1', 'offHand', items.shield.id);
    assert.equal(equipmentRows.some((x) => x.slot === 'mainHand'), false);
    assert.equal(equipmentRows.find((x) => x.slot === 'offHand')?.itemId, items.shield.id);
    assert.equal(inventoryRows.some((x) => x.itemId === items.greatsword.id), true);
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
    assert.equal(result.valid, true);
  }

  {
    const { service, character, equipmentRows, inventoryRows } = makeHarness({
      status: 'grinding',
      equipped: [{ id: 'eq-gs', characterId: 'c1', slot: 'mainHand', itemId: items.greatsword.id, instanceData: null }],
      inventory: [{ id: 'inv-shield', characterId: 'c1', location: 'inventory', itemId: items.shield.id, slotIndex: 0, quantity: 1, instanceData: null }],
    });
    await service.equipItem('c1', 'offHand', items.shield.id);
    assert.equal(character.pendingEquipmentChanges.mainHand, null);
    assert.equal(character.pendingEquipmentChanges.offHand.itemId, items.shield.id);
    assert.equal(equipmentRows.find((x) => x.slot === 'mainHand')?.itemId, items.greatsword.id);
    assert.equal(inventoryRows.some((x) => x.itemId === items.shield.id), false);

    await service.applyPendingEquipmentChanges('c1');
    assert.equal(equipmentRows.some((x) => x.slot === 'mainHand'), false);
    assert.equal(equipmentRows.find((x) => x.slot === 'offHand')?.itemId, items.shield.id);
    assert.equal(inventoryRows.some((x) => x.itemId === items.greatsword.id), true);
  }

  console.log('equipment-hand-swaps: 12 assertions passed');
})();
