const assert = require('node:assert/strict');
const { TownController } = require('../dist/apps/api/src/modules/town/town.controller');

async function run() {
  const calls = [];
  const townService = {
    buyFromVendor: async (...args) => { calls.push(['buy', ...args]); return { ok: true }; },
    sellToVendor: async (...args) => { calls.push(['sell', ...args]); return { ok: true }; },
    getWarehouse: async (...args) => { calls.push(['warehouse', ...args]); return []; },
    getWarehouseCapacity: async (...args) => { calls.push(['capacity', ...args]); return { used: 0, max: 10 }; },
    depositToWarehouse: async (...args) => { calls.push(['deposit', ...args]); return { ok: true }; },
    withdrawFromWarehouse: async (...args) => { calls.push(['withdraw', ...args]); return { ok: true }; },
  };
  const characterService = {
    getCharacterByUserId: async (userId) => userId === 'user-1' ? { id: 'character-1' } : null,
  };
  const controller = new TownController(townService, characterService);
  const req = { user: { userId: 'user-1' } };
  await controller.buyFromVendor(req, 'william', { itemId: 'pot_hp_small', quantity: 2 });
  await controller.sellToVendor(req, 'william', { itemId: 'pot_hp_small', quantity: 1 });
  assert.deepEqual(calls[0], ['buy', 'character-1', 'william', 'pot_hp_small', 2]);
  assert.deepEqual(calls[1], ['sell', 'character-1', 'william', 'pot_hp_small', 1]);
  console.log('town-vendor.controller.test.js: userId → characterId mapping passed');
}

run().catch((error) => { console.error(error); process.exit(1); });
