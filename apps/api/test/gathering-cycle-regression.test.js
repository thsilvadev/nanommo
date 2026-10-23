const assert = require('node:assert/strict');
const { MapService } = require('../dist/apps/api/src/modules/map/map.service.js');

async function testCompletedGatheringCycleGrantsAndRestarts() {
  const now = Date.now();
  const character = {
    id: 'char-gathering-cycle',
    status: 'grinding',
    currentMapId: 'map_green_grounds_1',
    travelIntent: null,
    gatheringLevel: 1,
    gatheringXp: 90,
    knownItemIds: [],
    gatheringCycle: {
      progress: 0.999,
      cycleIndex: 0,
      varianceSeconds: 0,
      lastUpdatedAt: new Date(now - 5_000).toISOString(),
    },
  };
  const granted = [];
  const scheduled = [];
  const published = [];
  const journalRows = [];
  const repo = {
    findOne: async () => character,
    save: async row => { Object.assign(character, row); return row; },
  };
  const queueRepo = {
    createQueryBuilder() {
      const builder = {
        where() { return builder; },
        andWhere() { return builder; },
        orderBy() { return builder; },
        getMany: async () => [],
      };
      return builder;
    },
  };
  const manager = {
    getRepository(entity) { return entity?.name === 'Character' ? repo : queueRepo; },
    transaction: async work => work(manager),
  };
  repo.manager = manager;
  const service = Object.create(MapService.prototype);
  service.characterRepo = repo;
  service.battleService = { withCharacterQueueLock: async (_id, work) => work(), publishQueueUpdated: async id => { published.push(id); } };
  service.mapPresenceService = { countActiveGrinders: async () => 1 };
  service.dataService = {
    getMapById: () => ({ id: 'map_green_grounds_1', type: 'grind', mapLength: 25, gatheringPool: [{ itemId: 'mat_wheat', weight: 100 }] }),
    getItemById: itemId => ({ id: itemId, name: 'Wheat' }),
  };
  service.inventoryService = {
    canFitInventoryDrop: async () => true,
    addItem: async (_id, itemId, quantity, _location, _instanceData, _manager) => { granted.push({ itemId, quantity }); },
  };
  service.bullQueue = { add: async (...args) => { scheduled.push(args); } };
  service.idleJournal = { gathered: async (...args) => { journalRows.push(args); } };
  service.logger = { log() {}, warn() {}, debug() {}, error() {} };

  await service.advanceStationaryActivity(character.id, 0);
  assert.deepEqual(granted, [{ itemId: 'mat_wheat', quantity: 1 }], 'crossing 100% authoritatively grants one selected material');
  assert.equal(character.gatheringCycle.cycleIndex, 1, 'completion advances the cycle identity');
  assert.ok(character.gatheringCycle.progress < 0.1, 'the full gauge restarts and carries only post-completion seconds');
  assert.equal(character.gatheringCycle.varianceSeconds, null, 'the following cycle samples its own variance');
  assert.ok(character.knownItemIds.includes('mat_wheat'));
  assert.equal(character.gatheringXp, 120, 'a successfully inserted gathering resource awards exactly +30 cumulative XP');
  assert.equal(character.gatheringLevel, 2, 'crossing 100 total Gathering XP unlocks level 2');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0][0], 'advance-stationary-activity');
  assert.deepEqual(published, [character.id], 'material awards publish an authoritative inventory/Character snapshot immediately');
  assert.equal(journalRows.length, 1, 'a successful grant emits one gathered-item journal row');

  // A completed timer with no inventory capacity must not award XP or level.
  character.gatheringXp = 45;
  character.gatheringLevel = 1;
  character.gatheringCycle = { progress: 0.999, cycleIndex: 1, varianceSeconds: 0, lastUpdatedAt: new Date(Date.now() - 5_000).toISOString() };
  service.inventoryService.canFitInventoryDrop = async () => false;
  published.length = 0;
  await service.advanceStationaryActivity(character.id, 1);
  assert.equal(character.gatheringXp, 45, 'inventory-full collection awards no Gathering XP');
  assert.equal(character.gatheringLevel, 1, 'inventory-full collection cannot unlock a level');
  assert.deepEqual(published, [], 'a discarded material does not publish an award snapshot');
}

testCompletedGatheringCycleGrantsAndRestarts().then(() => {
  console.log('Gathering cycle regression: completed collection grants a material and restarts progress.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
