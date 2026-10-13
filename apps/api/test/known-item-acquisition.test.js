const assert = require('node:assert/strict');
const { InventoryService } = require('../dist/apps/api/src/modules/inventory/inventory.service.js');
const source = require('../../../items.json');
const allItems = [...(source.consumables ?? []), ...(source.monsterParts ?? []), ...(source.equipment ?? [])];
const char = { id: 'c-known', knownItemIds: [], stateVersion: 1 };
const rows = [];
let characterSaves = 0;
const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => row[key] === value);
const inventoryRepo = {
  find: async ({ where = {} } = {}) => rows.filter(row => matches(row, where)),
  findOne: async ({ where = {} } = {}) => rows.find(row => matches(row, where)) ?? null,
  count: async ({ where = {} } = {}) => rows.filter(row => matches(row, where)).length,
  create: row => ({ ...row }),
  save: async row => {
    if (!row.id) row.id = 'inv-' + (rows.length + 1);
    const index = rows.findIndex(x => x.id === row.id);
    if (index >= 0) rows[index] = row; else rows.push(row);
    return row;
  },
};
const characterRepo = {
  findOne: async ({ where }) => where.id === char.id ? char : null,
  save: async row => { characterSaves += 1; return row; },
};
const dataService = { getItemById: id => allItems.find(item => item.id === id) ?? null };
const service = new InventoryService(inventoryRepo, characterRepo, dataService);
(async () => {
  await service.addItem(char.id, 'equip_sword_t1', 1);
  assert.deepEqual(char.knownItemIds, ['equip_sword_t1']);
  await service.addItem(char.id, 'equip_sword_t1', 1);
  assert.deepEqual(char.knownItemIds, ['equip_sword_t1'], 'known IDs are idempotent');
  assert.equal(characterSaves, 1, 'repeat grant does not rewrite knowledge');
  assert.equal(rows.length, 2, 'each equipment grant preserves its own item instance');
  console.log('known-item-acquisition: passed (4 assertions)');
})().catch(error => { console.error(error); process.exitCode = 1; });
