const assert = require('node:assert/strict');
const { MapService } = require('../dist/apps/api/src/modules/map/map.service');

async function run() {
  const character = {
    id: 'c-town',
    status: 'town',
    currentMapId: 'map_town',
    pendingMapTransition: null,
    lastSeenAt: new Date(),
  };
  const characterRepo = { findOne: async () => character, save: async () => { throw new Error('Town leave must not save'); } };
  const forbiddenBattleService = {
    getBattleQueue: async () => { throw new Error('Town leave must not inspect the battle queue'); },
    cancelPendingBattles: async () => { throw new Error('Town leave must not cancel battles'); },
    resetEncounterSequence: async () => { throw new Error('Town leave must not reset encounter sequence'); },
  };
  const service = new MapService({}, characterRepo, {}, {}, forbiddenBattleService, {});
  const result = await service.leaveMap('c-town');
  assert.equal(result.deferred, false);
  assert.equal(result.character.currentMapId, 'map_town');
  assert.equal(result.character.status, 'town');
  console.log('map-leave-town-idempotency.test.js: 3 assertions passed');
}

run().catch(error => { console.error(error); process.exit(1); });
