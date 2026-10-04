const assert = require('node:assert/strict');
const { EquipmentService } = require('../dist/apps/api/src/modules/equipment/equipment.service.js');
const { BattleEngine } = require('../dist/packages/shared/src/battle-engine/index.js');

const sword = { id: 'equip_sword_t1', type: 'equipment', slot: 'mainHand', fixedStats: { atk: 8 } };
const ring = { id: 'equip_accessory_sor_t1', type: 'equipment', slot: 'accessory', fixedStats: { statBonus: { SOR: 2 } } };
const data = { getItemById(id) { return id === sword.id ? sword : id === ring.id ? ring : null; } };

const equippedRows = [
  { characterId: 'c1', slot: 'mainHand', itemId: sword.id, instanceData: null },
  { characterId: 'c1', slot: 'accessoryLeft', itemId: ring.id, instanceData: { rolledAttribute: 'SOR', rolledValue: 4 } },
];
const repo = { find: async () => equippedRows, findOne: async () => null, save: async x => x, create: x => x, delete: async () => {} };
const character = { id: 'c1', level: 1, str: 5, agi: 5, dex: 5, vit: 5, int: 5, sor: 5, status: 'town', pendingEquipmentChanges: null, lastSeenAt: new Date() };
const characterRepo = { findOne: async () => character, save: async x => x };
const inventoryRepo = { findOne: async () => ({ id: 'inv-ring', characterId: 'c1', location: 'inventory', itemId: ring.id, slotIndex: 0, quantity: 1, instanceData: { rolledAttribute: 'SOR', rolledValue: 4 } }), delete: async () => {}, find: async () => [], save: async x => x, create: x => x };
const queueRepo = { findOne: async () => null };

(async () => {
  const service = new EquipmentService(repo, characterRepo, {}, inventoryRepo, queueRepo, data);
  const stats = await service.calculateEquipmentStats('c1');
  assert.equal(stats.weaponFixedAtk, 8, 'Worn Sword must contribute +8 ATK');
  assert.equal(stats.statBonus.SOR, 6, 'Ring fixed +2 and rolled +4 must both contribute');
  const derived = await service.calculateDerivedStats(character);
  assert.equal(derived.atk, 18, 'Starter character with sword must have 18 ATK');
  assert.equal(derived.matk, 10, 'INT 5 must yield 10 MATK without weapon MATK');

  let savedEquipment = null;
  const equipRepo = {
    find: async () => [],
    findOne: async () => savedEquipment,
    save: async x => { savedEquipment = x; return x; },
    create: x => x,
    delete: async () => {},
  };
  const equipService = new EquipmentService(
    equipRepo,
    characterRepo,
    {},
    inventoryRepo,
    queueRepo,
    data,
  );
  const equipped = await equipService.equipItem('c1', 'accessoryRight', ring.id);
  assert.equal(equipped.itemId, ring.id, 'Accessory catalog slot must be accepted in accessoryRight');
  console.log('equipment-stats-realtime: 5 assertions passed');
})();
