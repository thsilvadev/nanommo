const assert = require('node:assert/strict');
const { MapService } = require('../dist/apps/api/src/modules/map/map.service');
const { Character } = require('../dist/apps/api/src/database/entities/character.entity');

(async () => {
  const originalNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  try {
    const character = {
      id: 'traveler', currentMapId: 'field', savedTownMapId: 'town', status: 'grinding',
      travelIntent: {
        kind: 'saved-town-teleport', destinationMapId: 'town', generation: 1,
        segmentProgress: 0, lastAccruedAt: new Date(now).toISOString(), lastDurationSeconds: 10,
      },
    };
    const characters = { findOne: async () => character, save: async () => {} };
    const battles = { find: async () => [] };
    const service = Object.create(MapService.prototype);
    const delays = [];
    Object.assign(service, {
      characterRepo: { manager: { transaction: async fn => fn({ getRepository: entity => entity === Character ? characters : battles }) } },
      battleService: { withCharacterQueueLock: async (_id, fn) => fn() },
      dataService: { getMapById: id => id ? ({ id, type: id === 'town' ? 'town' : 'grind', coordinates: {x: 0, y: 0} }) : null },
      mapPresenceService: { syncCharacter: async () => {} },
      logger: { log() {}, warn() {} },
      enqueueTravelSchedule: async (_id, _intent, delay) => delays.push(delay),
    });
    await service.advanceTravel(character.id, 1);
    assert.equal(character.currentMapId, 'field');
    assert.equal(delays[0], 10000);
    now += 9000;
    await service.advanceTravel(character.id, 1);
    assert.equal(character.currentMapId, 'field');
    now += 1000;
    await service.advanceTravel(character.id, 1);
    assert.equal(character.currentMapId, 'town');
    assert.equal(character.travelIntent, null);
    console.log('saved-town teleport commits only after 10 seconds');
  } finally {
    Date.now = originalNow;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
