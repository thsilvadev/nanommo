const assert = require('node:assert/strict');
const { MapService } = require('../dist/apps/api/src/modules/map/map.service.js');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service.js');

function createGatewayMock() {
  const calls = [];
  return {
    calls,
    removePlayerFromMap: async (characterId, mapId) => { calls.push({ method: 'removePlayerFromMap', characterId, mapId }); },
    publishMapPresence: async (mapId) => { calls.push({ method: 'publishMapPresence', mapId }); },
    reset: () => { calls.length = 0; },
  };
}

function createMapService({ gateway, characterRepo, userRepo, dataService, battleService, mapKillCounterRepo } = {}) {
  const service = Object.create(MapService.prototype);
  service.mapKillCounterRepo = mapKillCounterRepo || { findOne: async () => null };
  service.characterRepo = characterRepo || { findOne: async () => ({ id: 'char-1', currentMapId: 'map_1', status: 'grinding' }) };
  service.userRepo = userRepo || { findOne: async () => ({ emailVerified: true }) };
  service.dataService = dataService || { getMapById: () => ({ unlockLevel: 1 }), getMonsters: () => ({ maps: [] }) };
  service.battleService = battleService || { getBattleQueue: async () => [], cancelPendingBattles: async () => {}, cancelPendingBattlesAfter: async () => {}, resetEncounterSequence: async () => {} };
  service.gatewayService = gateway || createGatewayMock();
  service.logger = { warn: () => {}, debug: () => {}, log: () => {}, error: () => {} };
  return service;
}

function createBattleService({ gateway, characterRepo, battleQueueRepo, mapKillCounterRepo, dataService, inventoryService, bullQueue, redis } = {}) {
  const service = Object.create(BattleService.prototype);
  service.bullQueue = bullQueue || { getJob: async () => null };
  service.battleQueueRepo = battleQueueRepo || { findOne: async () => null, find: async () => [], save: async (row) => row, delete: async () => {} };
  service.characterRepo = characterRepo || { findOne: async () => ({ id: 'char-1', currentMapId: 'map_1', status: 'grinding', level: 1, xp: 0, diet: [], lastSeenAt: new Date() }), save: async (row) => row };
  service.mapKillCounterRepo = mapKillCounterRepo || { findOne: async () => ({ epoch: 0, mapKillCount: 0, perMonsterKillCount: {} }), save: async (row) => row };
  service.gambitPageRepo = { find: async () => [] };
  service.inventoryItemRepo = { find: async () => [] };
  service.dataService = dataService || { getMonsterById: () => ({}), getMapById: () => ({}), getXpToNextLevel: () => 100, getItemById: () => null };
  service.characterService = { getCharacterByUserId: async () => ({ id: 'char-1' }) };
  service.inventoryService = inventoryService || { getItemCount: async () => 0, consumeFood: async () => ({}) };
  service.equipmentService = { getEquippedItems: async () => [] };
  service.gatewayService = gateway || createGatewayMock();
  service.redis = redis || { publish: async () => {} };
  service.logger = { warn: () => {}, debug: () => {}, log: () => {}, error: () => {} };
  return service;
}

(async () => {
  {
    const gateway = createGatewayMock();
    const service = createMapService({ gateway });

    const character = { id: 'char-1', currentMapId: 'map_green_grounds', status: 'grinding' };
    service.characterRepo = {
      findOne: async () => character,
      save: async (row) => { Object.assign(character, row); return row; },
    };
    service.battleService = {
      getBattleQueue: async () => [],
      cancelPendingBattles: async () => {},
      cancelPendingBattlesAfter: async () => {},
      resetEncounterSequence: async () => {},
    };

    await service.leaveMap('char-1');
    assert.ok(gateway.calls.some(c => c.method === 'removePlayerFromMap' && c.characterId === 'char-1' && c.mapId === 'map_green_grounds'), 'removePlayerFromMap not called for immediate leave');
    assert.ok(gateway.calls.some(c => c.method === 'publishMapPresence' && c.mapId === 'map_green_grounds'), 'publishMapPresence not called for immediate leave');
    assert.strictEqual(character.status, 'town');
    assert.strictEqual(character.currentMapId, null);
    console.log('MapService leave-map cleanup: immediate path verified');
  }

  {
    const gateway = createGatewayMock();
    const service = createMapService({ gateway });

    const character = { id: 'char-1', currentMapId: 'map_green_grounds', status: 'grinding' };
    service.characterRepo = {
      findOne: async () => character,
      save: async (row) => { Object.assign(character, row); return row; },
    };
    const activeBattle = { id: 'battle-1', startAt: new Date(Date.now() - 1000).toISOString(), endAt: new Date(Date.now() + 1000).toISOString() };
    service.battleService = {
      getBattleQueue: async () => [activeBattle],
      cancelPendingBattles: async () => {},
      cancelPendingBattlesAfter: async () => {},
      resetEncounterSequence: async () => {},
    };

    const result = await service.leaveMap('char-1');
    assert.strictEqual(result.deferred, true);
    assert.ok(gateway.calls.some(c => c.method === 'removePlayerFromMap' && c.characterId === 'char-1' && c.mapId === 'map_green_grounds'), 'removePlayerFromMap not called for deferred leave');
    assert.ok(gateway.calls.some(c => c.method === 'publishMapPresence' && c.mapId === 'map_green_grounds'), 'publishMapPresence not called for deferred leave');
    console.log('MapService leave-map cleanup: deferred path verified');
  }

  {
    const gateway = createGatewayMock();
    const service = createBattleService({ gateway });

    const character = {
      id: 'char-1', currentMapId: 'map_menace', status: 'grinding', level: 1, xp: 0,
      diet: [], lastSeenAt: new Date(), hpCurrent: 100,
    };
    service.characterRepo = {
      findOne: async () => character,
      save: async (row) => { Object.assign(character, row); return row; },
    };
    service.battleQueueRepo = {
      find: async () => [],
      delete: async () => {},
    };
    service.bullQueue = { getJob: async () => null };
    service.mapKillCounterRepo = {
      findOne: async () => ({ epoch: 0, mapKillCount: 0, perMonsterKillCount: {} }),
      save: async (row) => row,
    };
    service.dataService = {
      getMonsterById: () => ({}),
      getMapById: () => ({}),
      getXpToNextLevel: () => 100,
      getItemById: () => null,
    };

    await service['handleCharacterDeath'](character, { mapId: 'map_menace', monsterId: 'mon_slime', log: {} });
    assert.ok(gateway.calls.some(c => c.method === 'removePlayerFromMap' && c.characterId === 'char-1' && c.mapId === 'map_menace'), 'removePlayerFromMap not called on death');
    assert.ok(gateway.calls.some(c => c.method === 'publishMapPresence' && c.mapId === 'map_menace'), 'publishMapPresence not called on death');
    assert.strictEqual(character.status, 'town');
    assert.strictEqual(character.currentMapId, null);
    console.log('BattleService death cleanup verified');
  }

  {
    const gateway = createGatewayMock();
    const service = createBattleService({ gateway });

    const character = {
      id: 'char-1', currentMapId: 'map_menace', status: 'grinding', level: 1, xp: 0,
      diet: [], lastSeenAt: new Date(), hpCurrent: 100, spCurrent: 100, returnToTownAfterBattle: true,
      activeFoodBuff: null,
    };
    service.characterRepo = {
      findOne: async () => character,
      save: async (row) => { Object.assign(character, row); return row; },
      count: async () => 0,
    };
    service.battleQueueRepo = {
      createQueryBuilder: () => ({
        update: () => ({
          set: () => ({
            where: () => ({
              andWhere: () => ({
                execute: async () => ({ affected: 1 }),
              }),
            }),
          }),
        }),
      }),
      findOne: async () => ({ id: 'battle-1', characterId: 'char-1', resolved: false, startAt: new Date(Date.now() - 1000).toISOString(), endAt: new Date(Date.now() + 1000).toISOString(), mapId: 'map_menace', monsterId: 'mon_slime', log: { events: [] }, itemsConsumed: [], xpGain: 10, hpAfter: 100, spAfter: 100, drops: [] }),
      find: async () => [],
      save: async (row) => row,
      delete: async () => {},
    };
    service.bullQueue = { getJob: async () => null };
    service.inventoryService = { getItemCount: async () => 0, consumeFood: async () => ({}), removeItem: async () => {}, getInventory: async () => ({ items: [], stateVersion: 1 }) };
    service.dataService = {
      getMonsterById: () => ({ level: 1 }),
      getMapById: () => ({}),
      getXpToNextLevel: () => 100,
      getItemById: () => null,
    };
    service.characterService = { getCharacterByUserId: async () => ({ id: 'char-1' }), getCharacterDtoById: async () => ({}) };
    service.equipmentService = { getEquippedItems: async () => [], applyPendingEquipmentChanges: async () => false };

    await service.resolveBattle('battle-1');
    assert.ok(gateway.calls.some(c => c.method === 'removePlayerFromMap' && c.characterId === 'char-1' && c.mapId === 'map_menace'), 'removePlayerFromMap not called on town return');
    assert.ok(gateway.calls.some(c => c.method === 'publishMapPresence' && c.mapId === 'map_menace'), 'publishMapPresence not called on town return');
    assert.strictEqual(character.status, 'town');
    assert.strictEqual(character.currentMapId, null);
    console.log('BattleService resolveBattle town-return cleanup verified');
  }

  {
    const gateway = createGatewayMock();
    const service = createBattleService({ gateway });
    const character = {
      id: 'char-1', currentMapId: 'map_hunger', status: 'grinding', level: 1, xp: 0,
      diet: [], dietLevels: {}, activeFoodBuff: null, returnToTownAfterBattle: false,
      hpCurrent: 100, spCurrent: 100, lastSeenAt: new Date(),
    };
    service.characterRepo = {
      findOne: async () => character,
      save: async (row) => { Object.assign(character, row); return row; },
    };
    service.getBattleQueue = async () => [];
    service.buildInventoryMap = async () => ({});
    service.discardUnresolvedBattles = async () => {};
    service.safePublishQueueUpdated = async () => {};

    const result = await service.queueBattles('char-1', 1, true);
    assert.deepStrictEqual(result, []);
    assert.strictEqual(character.status, 'town');
    assert.strictEqual(character.currentMapId, null);
    assert.ok(gateway.calls.some(c => c.method === 'removePlayerFromMap' && c.characterId === 'char-1' && c.mapId === 'map_hunger'), 'queue generation must remove hunger-exhausted presence');
    assert.ok(gateway.calls.some(c => c.method === 'publishMapPresence' && c.mapId === 'map_hunger'), 'queue generation must publish corrected hunger count');
    console.log('BattleService queue-generation Town cleanup verified');
  }

  console.log('\nAll map presence cleanup tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
