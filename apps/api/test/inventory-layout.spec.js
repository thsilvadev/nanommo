const assert = require('node:assert/strict');
const { InventoryService } = require('../dist/apps/api/src/modules/inventory/inventory.service.js');
const { InventoryItem } = require('../dist/apps/api/src/database/entities/inventory-item.entity.js');
const { Character } = require('../dist/apps/api/src/database/entities/character.entity.js');

function harness(initialRows) {
  const character = {
    id: 'layout-character',
    stateVersion: 7,
    lastSeenAt: new Date('2026-10-13T12:00:00.000Z'),
  };
  const rows = initialRows.map((row) => ({
    characterId: character.id,
    location: 'inventory',
    quantity: 1,
    ...row,
  }));

  const inventoryRepo = {
    find: async ({ where = {}, order } = {}) => {
      const result = rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
      if (order?.slotIndex === 'ASC') result.sort((a, b) => a.slotIndex - b.slotIndex);
      return result;
    },
    save: async (value) => value,
  };
  const characterRepo = {
    findOne: async () => character,
    save: async (value) => {
      value.stateVersion += 1;
      return value;
    },
  };
  inventoryRepo.manager = {
    transaction: async (work) => work({
      getRepository: (entity) => {
        if (entity === InventoryItem) return inventoryRepo;
        if (entity === Character) return characterRepo;
        throw new Error('Unexpected repository');
      },
    }),
  };

  const service = Object.create(InventoryService.prototype);
  service.inventoryItemRepo = inventoryRepo;
  service.characterRepo = characterRepo;
  return { service, rows, character };
}

describe('inventory layout persistence', () => {
  it('swaps inventory rows when the destination slot is occupied', async () => {
    const { service, rows, character } = harness([
      { id: 'item-a', itemId: 'food_bread', slotIndex: 2 },
      { id: 'item-b', itemId: 'pot_hp_small', slotIndex: 8 },
      { id: 'item-c', itemId: 'equip_sword_t1', slotIndex: 10 },
    ]);

    const result = await service.moveItemToSlot(character.id, 'item-a', 8);

    assert.equal(rows.find((row) => row.id === 'item-a').slotIndex, 8);
    assert.equal(rows.find((row) => row.id === 'item-b').slotIndex, 2);
    assert.equal(rows.find((row) => row.id === 'item-c').slotIndex, 10);
    assert.deepEqual(result.items.map((row) => [row.id, row.slotIndex]), [
      ['item-b', 2], ['item-a', 8], ['item-c', 10],
    ]);
    assert.equal(result.stateVersion, 8);
  });

  it('moves into an empty slot without compacting the source gap', async () => {
    const { service, rows, character } = harness([
      { id: 'item-a', itemId: 'food_bread', slotIndex: 0 },
      { id: 'item-b', itemId: 'pot_hp_small', slotIndex: 3 },
    ]);

    const result = await service.moveItemToSlot(character.id, 'item-a', 7);

    assert.equal(rows.find((row) => row.id === 'item-a').slotIndex, 7);
    assert.equal(rows.find((row) => row.id === 'item-b').slotIndex, 3);
    assert.equal(result.stateVersion, 8);
  });

  it('persists a complete order in compact slots without changing row identities', async () => {
    const { service, rows, character } = harness([
      { id: 'item-a', itemId: 'food_bread', slotIndex: 0 },
      { id: 'item-b', itemId: 'pot_hp_small', slotIndex: 12 },
      { id: 'item-c', itemId: 'equip_sword_t1', slotIndex: 49 },
    ]);

    const result = await service.sortInventory(character.id, ['item-c', 'item-a', 'item-b']);

    assert.deepEqual(result.items.map((row) => [row.id, row.slotIndex]), [
      ['item-c', 0], ['item-a', 1], ['item-b', 2],
    ]);
    assert.deepEqual(rows.map((row) => row.id).sort(), ['item-a', 'item-b', 'item-c']);
    assert.equal(result.stateVersion, 8);
  });

  it('rejects stale/incomplete sort requests and out-of-range target slots', async () => {
    const { service, character } = harness([
      { id: 'item-a', itemId: 'food_bread', slotIndex: 0 },
    ]);

    await assert.rejects(
      service.sortInventory(character.id, ['not-owned-item']),
      /Inventory changed; reload and retry/,
    );
    await assert.rejects(
      service.moveItemToSlot(character.id, 'item-a', 50),
      /Target slot must be between 0 and 49/,
    );
  });
});
