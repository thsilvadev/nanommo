const assert = require('node:assert/strict');
const fs = require('node:fs');
const {professionThreshold}=require('../../../packages/shared/dist');
const { TownService } = require('../dist/apps/api/src/modules/town/town.service');
const { Character } = require('../dist/apps/api/src/database/entities/character.entity');
const read = name => JSON.parse(fs.readFileSync(`${name}.json`, 'utf8'));
const items = Object.values(read('items')).flatMap(rows => Array.isArray(rows) ? rows : []);
const recipes = read('alchemy_recipes').recipes;
const item = id => items.find(row => row.id === id);
function fixture(level = 7) {
  const character = { id: 'alchemist', status: 'town', currentMapId: 'map_kwaioua_taba', pendingMapTransition: null, alchemyLevel: level, alchemyXp: professionThreshold(level), craftingSession: null, cookingSession: null };
  const state = { character, inventory: [{ itemId: 'mat_herbs', quantity: 8 }, { itemId: 'mat_sapupema_leaf', quantity: 3 }, {itemId:'part_unicorn_common',quantity:1}], scheduled: [] };
  const characterRepo = { findOne: async () => character, save: async row => row };
  const inventoryRepo = { find: async () => state.inventory };
  const manager = { getRepository: entity => entity === Character ? characterRepo : inventoryRepo };
  characterRepo.manager = { transaction: async callback => callback(manager) };
  const svc = Object.create(TownService.prototype);
  svc.characterRepo = characterRepo;
  svc.inventoryRepo = inventoryRepo;
  svc.dataService = { getNpcVendor:()=>read('npc_vendor'), getAlchemyRecipes: () => ({ recipes }), getItemById: item, getMapById: id => read('maps').maps.find(row => row.id === id), getNpcCatalog: () => read('npc_catalog') };
  svc.battleService = { withCharacterQueueLock: async (_id, fn) => fn(), runFutureCombatMutation: async (_id, fn) => fn(), publishItemsObtained: async () => undefined };
  svc.bullQueue = { getJob: async () => null, add: async (...args) => state.scheduled.push(args) };
  svc.inventoryService = {
    removeItem: async (_id, itemId, quantity, tx) => {
      assert.equal(tx, manager);
      for (const row of state.inventory.filter(row => row.itemId === itemId)) { const amount = Math.min(quantity, row.quantity); row.quantity -= amount; quantity -= amount; }
      assert.equal(quantity, 0);
      state.inventory = state.inventory.filter(row => row.quantity > 0);
    },
    addItem: async (_id, itemId, quantity, _location, _instance, tx) => { assert.equal(tx, manager); state.inventory.push({ itemId, quantity }); },
  };
  return { svc, state, manager };
}
(async () => {
  const locked = fixture(6);
  await assert.rejects(() => locked.svc.startProfessionCrafting('alchemist', 'paje_piata', 'alchemy', 'sapupema_tea'), /level too low/);
  assert.equal(locked.state.character.craftingSession, null);
  const missing = fixture(); missing.state.inventory.find(row => row.itemId === 'mat_sapupema_leaf').quantity = 2;
  await assert.rejects(() => missing.svc.startProfessionCrafting('alchemist', 'paje_piata', 'alchemy', 'sapupema_tea'), /ingredients or inventory capacity/);
  const full = fixture(); full.state.inventory.forEach(row=>row.quantity=20);
  while (full.state.inventory.length < 50) full.state.inventory.push({ itemId: 'equip_sword_t1', quantity: 1 });
  await assert.rejects(() => full.svc.startProfessionCrafting('alchemist', 'paje_piata', 'alchemy', 'sapupema_tea'), /ingredients or inventory capacity/);
  const active = fixture();
  const before = structuredClone(active.state.inventory);
  const result = await active.svc.startProfessionCrafting('alchemist', 'paje_piata', 'alchemy', 'sapupema_tea');
  assert.equal(result.session.outputItemId, 'super_tonic_sapupema_tea');
  assert.deepEqual(result.session.ingredients, [{ itemId: 'mat_herbs', quantity: 8 }, { itemId: 'mat_sapupema_leaf', quantity: 3 },{itemId:'part_unicorn_common',quantity:1}]);
  assert.deepEqual(active.state.inventory, before, 'starting reserves ingredients until completion');
  assert.equal(result.recipes.find(row => row.id === 'sapupema_tea').available, false);
  active.state.character.craftingSession.completesAt = new Date(0).toISOString();
  const sessionId = active.state.character.craftingSession.id;
  await active.svc.completeCrafting('alchemist', sessionId);
  assert.deepEqual(active.state.inventory, [{ itemId: 'super_tonic_sapupema_tea', quantity: 1 }]);
  assert.equal(active.state.character.alchemyXp, professionThreshold(7)+90);
  assert.ok(active.state.character.knownItemIds.includes('super_tonic_sapupema_tea'));
  assert.equal(await active.svc.completeCrafting('alchemist', sessionId), null, 'retry does not craft or award XP again');
  const antidote = fixture(1); antidote.state.inventory=[{itemId:'mat_herbs',quantity:2},{itemId:'part_venomviper_common',quantity:1}];
  await antidote.svc.startProfessionCrafting('alchemist', 'paje_piata', 'alchemy', 'antidote');
  assert.deepEqual(antidote.state.character.craftingSession.ingredients, [{ itemId: 'mat_herbs', quantity: 2 },{itemId:'part_venomviper_common',quantity:1}]);
  console.log('party-alchemy-crafting: passed Tea/Antidote levels, costs, capacity, reservation, completion XP and retry safety');
})().catch(error => { console.error(error); process.exitCode = 1; });
