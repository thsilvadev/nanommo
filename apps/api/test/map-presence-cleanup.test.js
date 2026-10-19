const assert = require('node:assert/strict');
const { MapService } = require('../dist/apps/api/src/modules/map/map.service.js');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service.js');

function createPresenceMock() {
  const calls = [];
  return {
    calls,
    syncCharacter: async (characterId, previousMapId) => {
      calls.push({ method: 'syncCharacter', characterId, previousMapId });
    },
    countActiveGrinders: async () => 1,
    reset: () => { calls.length = 0; },
  };
}

function attachMapTransaction(repo, character, rows = []) {
  repo.manager = {
    transaction: async callback => callback({
      getRepository(entity) {
        if (entity?.name === 'Character') return {
          findOne: async () => character,
          save: async row => { Object.assign(character, row); return row; },
        };
        if (entity?.name === 'User') return { findOne: async () => ({ id: 'user-1', emailVerified: true }) };
        if (entity?.name === 'BattleQueueEntry') return {
          find: async () => rows.filter(row => !row.resolved).sort((a, b) => a.sequenceIndex - b.sequenceIndex),
          delete: async criteria => {
            const rawIds = criteria?.id?._value;
            const ids = Array.isArray(rawIds) ? rawIds : [criteria?.id];
            for (let i = rows.length - 1; i >= 0; i--) if (ids.includes(rows[i].id) && !rows[i].resolved) rows.splice(i, 1);
            return { affected: ids.length };
          },
        };
        throw new Error(`Unexpected transaction repository ${entity?.name}`);
      },
    }),
  };
  return repo;
}

function createMapService({ presence, characterRepo, userRepo, dataService, battleService, mapKillCounterRepo } = {}) {
  const service = Object.create(MapService.prototype);
  service.mapKillCounterRepo = mapKillCounterRepo || { findOne: async () => null };
  service.characterRepo = characterRepo || { findOne: async () => ({ id: 'char-1', currentMapId: 'map_1', status: 'grinding' }) };
  service.userRepo = userRepo || { findOne: async () => ({ emailVerified: true }) };
  service.dataService = dataService || { getMapById: id => ({ id, type: id === 'map_town' ? 'town' : 'grind', isClickable: true, coordinates: id === 'map_town' ? { x: 0, y: 0 } : { x: -1, y: 0 } }), getMonsters: () => ({ maps: [] }) };
  service.battleService = battleService || {
    withCharacterQueueLock: async (_id, operation) => operation(),
    removeBattleQueueJobs: async () => {},
    queueBattles: async () => [],
    getBattleQueue: async () => [],
    cancelPendingBattles: async () => {},
    cancelPendingBattlesAfter: async () => {},
    resetEncounterSequence: async () => {},
  };
  service.mapPresenceService = presence || createPresenceMock();
  service.logger = { warn: () => {}, debug: () => {}, log: () => {}, error: () => {} };
  return service;
}

function createBattleService({ presence, characterRepo, battleQueueRepo, mapKillCounterRepo, dataService, inventoryService, bullQueue } = {}) {
  const service = Object.create(BattleService.prototype);
  service.bullQueue = bullQueue || { getJob: async () => null };
  service.battleQueueRepo = battleQueueRepo || {
    findOne: async () => null, find: async () => [], save: async row => row, delete: async () => {},
  };
  service.characterRepo = characterRepo || {
    findOne: async () => ({ id: 'char-1', currentMapId: 'map_1', status: 'grinding', level: 1, xp: 0, diet: [], lastSeenAt: new Date() }),
    save: async row => row,
  };
  service.mapKillCounterRepo = mapKillCounterRepo || {
    findOne: async () => ({ epoch: 0, mapKillCount: 0, perMonsterKillCount: {} }), save: async row => row,
  };
  service.gambitPageRepo = { find: async () => [] };
  service.inventoryItemRepo = { find: async () => [] };
  service.dataService = dataService || {
    getMonsterById: () => ({}), getMapById: () => ({}), getXpToNextLevel: () => 100, getItemById: () => null,
  };
  service.characterService = { getCharacterByUserId: async () => ({ id: 'char-1' }) };
  service.inventoryService = inventoryService || { getItemCount: async () => 0, consumeFood: async () => ({}) };
  service.equipmentService = { getEquippedItems: async () => [] };
  service.gatewayService = {};
  service.mapPresenceService = presence || createPresenceMock();
  let lockHeld = false;
  service.redis = { publish: async () => {}, set: async () => { if (lockHeld) return null; lockHeld = true; return 'OK'; }, eval: async script => { if (script.includes('del')) lockHeld = false; return 1; } };
  service.logger = { warn: () => {}, debug: () => {}, log: () => {}, error: () => {} };
  return service;
}

(async () => {
  {
    const presence = createPresenceMock();
    const service = createMapService({ presence });
    const character = { id: 'char-1', currentMapId: 'map_green_grounds', status: 'grinding', pendingMapTransition: null };
    service.characterRepo = attachMapTransaction({
      findOne: async () => character,
      save: async row => { Object.assign(character, row); return row; },
    }, character, []);

    await service.leaveMap('char-1');
    assert.ok(presence.calls.some(c => c.method === 'syncCharacter' && c.characterId === 'char-1' && c.previousMapId === 'map_green_grounds'));
    assert.strictEqual(character.status, 'town');
    assert.strictEqual(character.currentMapId, 'map_town');
    console.log('MapService immediate map exit uses centralized presence sync');
  }

  {
    const presence = createPresenceMock();
    const service = createMapService({ presence });
    const character = { id: 'char-1', currentMapId: 'map_green_grounds', status: 'grinding', pendingMapTransition: null };
    const activeBattle = { id: 'battle-1', characterId: 'char-1', sequenceIndex: 0, resolved: false, mapId: 'map_green_grounds', startAt: new Date(Date.now() - 1000).toISOString(), endAt: new Date(Date.now() + 1000).toISOString() };
    service.characterRepo = attachMapTransaction({
      findOne: async () => character,
      save: async row => { Object.assign(character, row); return row; },
    }, character, [activeBattle]);
    service.battleService = {
      withCharacterQueueLock: async (_id, operation) => operation(),
      removeBattleQueueJobs: async () => {},
      getBattleQueue: async () => [activeBattle],
      cancelPendingBattles: async () => {},
      cancelPendingBattlesAfter: async () => {},
      resetEncounterSequence: async () => {},
    };

    const result = await service.leaveMap('char-1');
    assert.strictEqual(result.deferred, true);
    assert.ok(presence.calls.some(c => c.method === 'syncCharacter' && c.characterId === 'char-1' && c.previousMapId === 'map_green_grounds'));
    console.log('MapService deferred map exit uses centralized presence sync');
  }

  {
    const presence = createPresenceMock();
    const service = createBattleService({ presence });
    const character = {
      id: 'char-1', currentMapId: 'map_menace', status: 'grinding', level: 1, xp: 0,
      diet: [], lastSeenAt: new Date(), hpCurrent: 100,
    };
    service.characterRepo = {
      findOne: async () => character,
      save: async row => { Object.assign(character, row); return row; },
    };
    service.battleQueueRepo = { find: async () => [], delete: async () => {} };
    service.bullQueue = { getJob: async () => null };
    service.mapKillCounterRepo = {
      findOne: async () => ({ epoch: 0, mapKillCount: 0, perMonsterKillCount: {} }), save: async row => row,
    };
    service.dataService = {
      getMonsterById: () => ({}), getMapById: () => ({}), getXpToNextLevel: () => 100, getItemById: () => null,
    };

    await service['handleCharacterDeath'](character, { id:'battle-death', characterId:'char-1', sequenceIndex:0, resolved:false, mapId: 'map_menace', monsterId: 'mon_slime', log: {} }, {
      getRepository(entity) {
        if (entity?.name === 'Character') return { save: async row => { Object.assign(character, row); return row; } };
        if (entity?.name === 'BattleQueueEntry') return { find: async () => [], delete: async () => {} };
        if (entity?.name === 'MapKillCounter') return { findOne: async () => ({ characterId:'char-1', mapId:'map_menace', epoch:0, mapKillCount:0, perMonsterKillCount:{} }), save: async row => row };
        throw new Error(`Unexpected death-manager repository ${entity?.name}`);
      },
    });
    assert.strictEqual(character.status, 'town');
    assert.strictEqual(character.currentMapId, 'map_town');
    console.log('BattleService death exit uses centralized presence sync');
  }

  {
    const presence = createPresenceMock();
    const service = createBattleService({ presence });
    const character = {
      id: 'char-1', currentMapId: 'map_menace', status: 'grinding', level: 1, xp: 0,
      diet: [], lastSeenAt: new Date(), hpCurrent: 100, spCurrent: 100, pendingMapTransition: { destinationMapId: 'map_town', reason: 'town_request' },
      activeFoodBuff: null,
    };
    service.characterRepo = {
      findOne: async () => character,
      save: async row => { Object.assign(character, row); return row; },
      count: async () => 0,
    };
    const battleRow = {
      id: 'battle-1', characterId: 'char-1', sequenceIndex: 0, resolved: false, outcome: 'win',
      startAt: new Date(Date.now() - 1000).toISOString(), endAt: new Date(Date.now() + 1000).toISOString(),
      mapId: 'map_menace', monsterId: 'mon_slime', log: { events: [] },
      itemsConsumed: [], xpGain: 10, goldGain: 0, hpAfter: 100, spAfter: 100, drops: [], seedUsed:'seed',
    };
    const counter = { characterId:'char-1', mapId:'map_menace', epoch:0, mapKillCount:0, perMonsterKillCount:{} };
    const queueRows = [battleRow];
    const txManager = { getRepository(entity) {
      if (entity?.name === 'Character') return { findOne: async () => character, save: async row => { Object.assign(character, row); return row; } };
      if (entity?.name === 'BattleQueueEntry') return {
        findOne: async () => battleRow,
        find: async () => queueRows.filter(row => !row.resolved),
        save: async row => { Object.assign(battleRow, row); return row; },
        delete: async () => {},
      };
      if (entity?.name === 'MapKillCounter') return { findOne: async () => counter, save: async row => { Object.assign(counter, row); return row; } };
      if (entity?.name === 'WeaponProficiency') return { findOne: async () => null };
      if (entity?.name === 'InventoryItem') return { find: async () => [] };
      throw new Error(`Unexpected resolver repository ${entity?.name}`);
    } };
    service.battleQueueRepo = {
      manager: { transaction: async callback => callback(txManager) },
      findOne: async () => battleRow,
      find: async () => [], save: async row => row, delete: async () => {},
    };
    service.bullQueue = { getJob: async () => null };
    service.inventoryService = {
      getItemCount: async () => 0, consumeFood: async () => ({}),
      removeItem: async () => {}, getInventory: async () => ({ items: [], stateVersion: 1 }),
    };
    service.dataService = {
      getMonsterById: () => ({ level: 1 }), getMapById: id => ({ id, type: id === 'map_town' ? 'town' : 'grind' }),
      getXpToNextLevel: () => 100, getItemById: () => null,
    };
    service.characterService = {
      getCharacterByUserId: async () => ({ id: 'char-1' }),
      getCharacterDtoById: async () => ({}),
    };
    service.equipmentService = {
      getEquippedItems: async () => [], applyPendingEquipmentChanges: async () => false,
    };
    service.getBattleQueue = async () => [];
    service.buildAuthoritativeBattleSnapshot = async () => ({});
    service.safePublishBattleResolved = async () => {};
    service.safePublishQueueUpdated = async () => {};

    await service.resolveBattle('battle-1');
    assert.ok(presence.calls.some(c => c.method === 'syncCharacter' && c.characterId === 'char-1' && c.previousMapId === 'map_menace'));
    assert.strictEqual(character.status, 'town');
    assert.strictEqual(character.currentMapId, 'map_town');
    console.log('BattleService deferred Town resolution uses centralized presence sync');
  }

  {
    const presence = createPresenceMock();
    const service = createBattleService({ presence });
    const character = {
      id: 'char-1', currentMapId: 'map_hunger', status: 'grinding', level: 1, xp: 0,
      diet: [], dietLevels: {}, activeFoodBuff: null, autoFeed:false, pendingMapTransition: null,
      hpCurrent: 100, spCurrent: 100, lastSeenAt: new Date(),
    };
    service.characterRepo = {
      findOne: async () => character,
      save: async row => { Object.assign(character, row); return row; },
    };
    service.getBattleQueue = async () => [];
    service.buildInventoryMap = async () => ({});
    service.discardUnresolvedBattles = async () => {};
    service.safePublishQueueUpdated = async () => {};
    service.dataService = { getMapById: id => ({ id, type: id === 'map_town' ? 'town' : 'grind' }), getItemById: () => null, getXpToNextLevel: () => 100 };

    const result = await service.queueBattles('char-1', 1, true);
    assert.deepStrictEqual(result, []);
    assert.strictEqual(character.status, 'town');
    assert.strictEqual(character.currentMapId, 'map_town');
    assert.ok(presence.calls.some(c => c.method === 'syncCharacter' && c.characterId === 'char-1' && c.previousMapId === 'map_hunger'));
    console.log('BattleService queue-generation Town exit uses centralized presence sync');
  }

  console.log('\nAll map presence cleanup tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
