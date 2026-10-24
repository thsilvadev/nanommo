const assert = require('node:assert/strict');
const { InventoryController } = require('../dist/apps/api/src/modules/inventory/inventory.controller.js');

(async () => {
  const character = { id: 'character-food-queue', name: 'FoodQueueTest' };
  const calls = [];
  const inventoryService = {
    useConsumable: async (characterId, itemId) => { calls.push(['consume', characterId, itemId]); return { character, itemId }; },
    getInventory: async (characterId) => { calls.push(['inventory', characterId]); return []; },
  };
  const characterService = {
    getCharacterByUserId: async (userId) => { assert.equal(userId, 'user-1'); return character; },
    applyOffBattleRegeneration: async (characterId) => { assert.equal(characterId, character.id); return { character, resourcesChanged: false }; },
    getCharacterDtoById: async (characterId) => { assert.equal(characterId, character.id); return { ...character, stateVersion: 12 }; },
  };
  const battleService = {
    runFutureCombatMutation: async (characterId, mutation) => { calls.push(['future-combat-boundary', characterId]); return mutation(); },
  };
  const controller = new InventoryController(inventoryService, characterService, battleService);
  const result = await controller.useConsumable({ user: { userId: 'user-1' } }, { itemId: 'food_cheese' });

  assert.deepEqual(calls[0], ['future-combat-boundary', character.id], 'manual food/item use enters the single queue invalidation boundary');
  assert.deepEqual(calls[1], ['consume', character.id, 'food_cheese'], 'inventory mutation executes inside the boundary');
  assert.equal(result.character.stateVersion, 12);
  assert.deepEqual(result.inventory, []);
  console.log('inventory-manual-use-queue-invalidation: passed (manual consume routed through BattleService boundary)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
