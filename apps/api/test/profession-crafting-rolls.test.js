const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TownService } = require('../dist/apps/api/src/modules/town/town.service.js');
const { EquipmentService } = require('../dist/apps/api/src/modules/equipment/equipment.service.js');
const { Character } = require('../dist/apps/api/src/database/entities/character.entity.js');
const { InventoryItem } = require('../dist/apps/api/src/database/entities/inventory-item.entity.js');

const root = path.resolve(__dirname, '../../..');
const items = JSON.parse(fs.readFileSync(path.join(root, 'items.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'blacksmith_recipes.json'), 'utf8')).recipes;
const allItems = Object.values(items).flatMap(rows => Array.isArray(rows) ? rows : []);
const itemById = id => allItems.find(row => row.id === id);
const recipe = recipes.find(row => row.id === 'sword_t2');
const definition = itemById(recipe.outputItemId);
const roll = definition.randomRollOnCraft;
assert(roll?.enabled && Array.isArray(roll.attributesPool), 'test output must configure randomRollOnCraft');

const character = {
  id: 'char-craft-roll', level: 1, xp: 0, status: 'town', currentMapId: 'map_emperial_capital_caelum',
  alchemyLevel: 1, alchemyXp: 0, blacksmithLevel: 1, blacksmithXp: 0,
  cookingLevel: 1, cookingXp: 0, craftingSession: null,
};
const session = {
  id: 'session-craft-roll-fixed-seed', profession: 'blacksmith', recipeId: recipe.id,
  startedAt: new Date(Date.now() - 30000).toISOString(), completesAt: new Date(Date.now() - 1000).toISOString(),
  ingredients: [{ itemId: 'mat_bronze_ingot', quantity: Number(recipe.ingredients[0].quantity) }],
  outputItemId: recipe.outputItemId, outputQuantity: 1, xpReward: Number(recipe.xpReward),
};
character.craftingSession = session;
let inventoryRows = [{
  id: 'ingots-stack', characterId: character.id, itemId: 'mat_bronze_ingot',
  quantity: Number(recipe.ingredients[0].quantity), location: 'inventory', slotIndex: 0, instanceData: null,
}];
let rowSequence = 0;
const characterRepo = {
  manager: null,
  findOne: async () => character,
  save: async row => row,
};
const inventoryRepo = {
  find: async ({ where = {} } = {}) => inventoryRows.filter(row =>
    Object.entries(where).every(([key, value]) => row[key] === value)),
  findOne: async ({ where = {} } = {}) => inventoryRows.find(row =>
    Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
  save: async row => {
    const index = inventoryRows.findIndex(old => old.id === row.id);
    if (index < 0) inventoryRows.push(row); else inventoryRows[index] = row;
    return row;
  },
  remove: async row => { inventoryRows = inventoryRows.filter(old => old.id !== row.id); return row; },
  create: row => ({ id: row.id ?? 'crafted-' + (++rowSequence), ...row }),
};
const manager = { getRepository: entity => entity === Character ? characterRepo : inventoryRepo };
manager.transaction = async callback => callback(manager);
characterRepo.manager = manager;
const dataService = {
  getItemById: itemById,
  getAlchemyRecipes: () => ({ recipes: [] }),
  getBlacksmithRecipes: () => ({ recipes }),
};
const inventoryService = {
  removeItem: async (_characterId, itemId, quantity) => {
    const row = inventoryRows.find(entry => entry.itemId === itemId);
    assert(row && row.quantity >= quantity, 'reserved crafting ingredients must exist');
    row.quantity -= quantity;
    if (row.quantity === 0) inventoryRows = inventoryRows.filter(entry => entry !== row);
  },
  addItem: async (characterId, itemId, quantity, location, instanceData) => {
    inventoryRows.push({ id: 'crafted-' + (++rowSequence), characterId, itemId, quantity, location, slotIndex: inventoryRows.length, instanceData });
  },
};
const battleService = {
  withCharacterQueueLock: async (_characterId, callback) => callback(),
  runFutureCombatMutation: async (_characterId, callback) => callback(),
};
const town = new TownService(characterRepo, inventoryRepo, dataService, inventoryService, {}, battleService, {});
const equippedRows = [{ characterId: character.id, slot: 'mainHand', itemId: definition.id, instanceData: null }];
const equipmentService = new EquipmentService(
  { find: async () => equippedRows },
  characterRepo,
  { find: async () => [] },
  inventoryRepo,
  { findOne: async () => null },
  dataService,
  battleService,
);

(async () => {
  const completed = await town.completeCrafting(character.id, session.id);
  assert(completed, 'expired server-owned crafting session should complete exactly once');
  assert.strictEqual(character.craftingSession, null);
  assert.strictEqual(character.blacksmithXp, Number(recipe.xpReward));
  assert.strictEqual(inventoryRows.length, 1);
  const crafted = inventoryRows[0];
  assert.strictEqual(crafted.itemId, definition.id);
  assert.strictEqual(crafted.quantity, 1);
  assert.strictEqual(crafted.instanceData.craftedByProfession, 'blacksmith');
  assert.strictEqual(crafted.instanceData.craftedRecipeId, recipe.id);
  assert(!Object.hasOwn(crafted.instanceData, 'rolledStat'), 'Craft must not accidentally use randomRollOnDrop.statsPool');

  const digest = createHash('sha256').update(session.id + ':' + recipe.id + ':' + definition.id + ':craft-roll').digest();
  const expectedAttribute = roll.attributesPool[digest.readUInt32BE(0) % roll.attributesPool.length];
  const min = Number(roll.min ?? 1), max = Number(roll.max ?? min);
  const expectedValue = min + digest.readUInt32BE(4) % (max - min + 1);
  assert.strictEqual(crafted.instanceData.rolledAttribute, expectedAttribute);
  assert.strictEqual(crafted.instanceData.rolledValue, expectedValue);

  equippedRows[0].instanceData = crafted.instanceData;
  const firstStats = await equipmentService.calculateEquipmentStats(character.id);
  const secondStats = await equipmentService.calculateEquipmentStats(character.id);
  assert.strictEqual(firstStats.statBonus[expectedAttribute], expectedValue, 'crafted roll must affect the authoritative equipped stat path');
  assert.deepStrictEqual(secondStats, firstStats, 're-reading/re-equipping must not double-apply the rolled attribute');
  assert.strictEqual(inventoryRows.filter(row => row.itemId === definition.id).length, 1, 'same completion replay must not create a second item');
  assert.strictEqual(await town.completeCrafting(character.id, session.id), null, 'duplicate completion for the old session must be a no-op');

  console.log('Profession crafting: persisted session completion, ingredient consumption, deterministic randomRollOnCraft, authoritative stat application and replay safety passed.');
})().catch(error => { console.error(error); process.exit(1); });
