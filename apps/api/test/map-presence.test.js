const assert = require('node:assert/strict');
const fs = require('node:fs');

const { MapPresenceService } = require('../dist/apps/api/src/modules/presence/map-presence.service');
const { NanommoGateway } = require('../dist/apps/api/src/modules/gateway/nanommo.gateway');

const hashes = new Map();
const published = [];

const redis = {
  hset: async (key, id, timestamp) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    hashes.get(key).set(id, String(timestamp));
  },
  hgetall: async key => Object.fromEntries(hashes.get(key) || []),
  hget: async (key, id) => hashes.get(key)?.get(id) ?? null,
  hdel: async (key, id) => { hashes.get(key)?.delete(id); },
  hlen: async key => hashes.get(key)?.size ?? 0,
  publish: async (channel, message) => { published.push({ channel, message }); },
};

const states = new Map([
  ['a', { id: 'a', currentMapId: 'map_1', status: 'grinding', pendingMapTransition: null }],
  ['b', { id: 'b', currentMapId: 'map_1', status: 'grinding', pendingMapTransition: null }],
  ['c', { id: 'c', currentMapId: 'map_2', status: 'grinding', pendingMapTransition: null }],
  ['d', { id: 'd', currentMapId: 'map_1', status: 'grinding', pendingMapTransition: { destinationMapId: 'map_town', reason: 'town_request' } }],
]);

const characterRepo = {
  findOne: async ({ where: { id } }) => states.get(id) ?? null,
  find: async () => [...states.values()].filter(
    character => character.currentMapId && !character.pendingMapTransition,
  ),
  count: async ({ where }) => [...states.values()].filter(character =>
    character.status === 'grinding' &&
    !character.returnToTownAfterBattle &&
    character.currentMapId === where.currentMapId,
  ).length,
};

const presence = new MapPresenceService(characterRepo, redis);

(async () => {
  await presence.syncCharacter('a', null);
  assert.equal(await presence.getPlayersOnMap('map_1'), 1);
  assert.equal(JSON.parse(published.filter(x => x.channel === 'gateway:map:presence').at(-1).message).playersOnMap, 1);

  await presence.syncCharacter('b', null);
  assert.equal(await presence.getPlayersOnMap('map_1'), 2);
  assert.equal(JSON.parse(published.filter(x => x.channel === 'gateway:map:presence').at(-1).message).playersOnMap, 2);

  hashes.get('map:players:map_1').set('stale', String(Date.now() - 31_000));
  assert.equal(await presence.getPlayersOnMap('map_1'), 2);
  assert.equal(hashes.get('map:players:map_1').has('stale'), false);

  states.get('a').currentMapId = 'map_2';
  await presence.syncCharacter('a', 'map_1');
  assert.equal(await presence.getPlayersOnMap('map_1'), 1);
  assert.equal(await presence.getPlayersOnMap('map_2'), 1);
  assert.equal(JSON.parse(published.filter(x => x.channel === 'gateway:map:presence').at(-2).message).mapId, 'map_1');
  assert.equal(JSON.parse(published.filter(x => x.channel === 'gateway:map:presence').at(-1).message).mapId, 'map_2');

  states.get('b').pendingMapTransition = { destinationMapId: 'map_town', reason: 'town_request' };
  await presence.syncCharacter('b', 'map_1');
  assert.equal(await presence.getPlayersOnMap('map_1'), 0);
  assert.equal(JSON.parse(published.filter(x => x.channel === 'gateway:map:presence').at(-1).message).playersOnMap, 0);

  hashes.get('map:players:map_2').delete('c');
  await presence.reconcileAuthoritativePresence();
  assert.equal(hashes.get('map:players:map_2').has('c'), true);
  assert.equal(JSON.parse(published.filter(x => x.channel === 'gateway:map:presence').at(-1).message).playersOnMap, 2);

  const source = fs.readFileSync(
    'apps/api/src/modules/battle/battle-queue.processor.ts',
    'utf8',
  );
  assert.equal(source.includes('refresh-map-presence'), false, 'battle start presence job must not exist');

  const disconnectInstance = Object.create(NanommoGateway.prototype);
  disconnectInstance.connectedSockets = new Map([['c', 'socket-1']]);
  disconnectInstance.cleanupRedisSubscribers = () => {};
  disconnectInstance.onlinePresenceService = { setOffline: async () => {} };
  disconnectInstance.logger = { log: () => {}, error: error => { throw error; } };
  await disconnectInstance.handleDisconnect({ characterId: 'c' });
  assert.equal(hashes.get('map:players:map_2').has('c'), true);

  console.log('Map presence: 12 assertions passed');
})().catch(error => { console.error(error); process.exit(1); });
