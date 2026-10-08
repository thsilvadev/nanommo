const assert = require('node:assert/strict');
const { GatewayService } = require('../dist/apps/api/src/modules/gateway/gateway.service');
const { NanommoGateway } = require('../dist/apps/api/src/modules/gateway/nanommo.gateway');

const hashes = new Map();
const published = [];
const redis = {
  hset: async (key, id, timestamp) => { if (!hashes.has(key)) hashes.set(key, new Map()); hashes.get(key).set(id, String(timestamp)); },
  hgetall: async key => Object.fromEntries(hashes.get(key) || []),
  hget: async (key, id) => hashes.get(key)?.get(id) ?? null,
  hdel: async (key, id) => { hashes.get(key)?.delete(id); },
  hlen: async key => hashes.get(key)?.size ?? 0,
  publish: async (channel, message) => { published.push({ channel, message }); },
  setex: async () => {},
  sadd: async () => {},
  srem: async () => {},
  del: async () => {},
};
const gateway = new GatewayService(redis);

(async () => {
  const mapId = 'map_green_grounds';
  await gateway.addPlayerToMap('a', mapId);
  await gateway.addPlayerToMap('b', mapId);
  assert.strictEqual(await gateway.getPlayersOnMap(mapId), 2);
  await gateway.publishMapPresence(mapId);
  assert.strictEqual(JSON.parse(published.at(-1).message).playersOnMap, 2);

  hashes.get(`map:players:${mapId}`).set('stale', String(Date.now() - 31_000));
  assert.strictEqual(await gateway.getPlayersOnMap(mapId), 2, 'stale member must be excluded');
  assert.equal(hashes.get(`map:players:${mapId}`).has('stale'), false, 'stale member must be deleted');

  await gateway.removePlayerFromMap('b', mapId);
  await gateway.publishMapPresence(mapId);
  assert.strictEqual(await gateway.getPlayersOnMap(mapId), 1);
  assert.strictEqual(JSON.parse(published.at(-1).message).playersOnMap, 1);

  const gatewayInstance = Object.create(NanommoGateway.prototype);
  gatewayInstance.characterRepo = {
    find: async () => [
      { id: 'disconnected-grinder', currentMapId: 'map_green_grounds' },
      { id: 'town-character', currentMapId: null },
      { id: 'deferred', currentMapId: 'map_green_grounds' },
    ],
  };
  gatewayInstance.gatewayService = gateway;
  gatewayInstance.logger = { warn: () => {} };
  await gatewayInstance.reconcileGrindingMapPresence();
  assert.equal(hashes.get(`map:players:${mapId}`).has('disconnected-grinder'), true, 'reconciliation must refresh disconnected grinders');

  const disconnectInstance = Object.create(NanommoGateway.prototype);
  disconnectInstance.characterRepo = { findOne: async () => ({ id: 'disconnected-grinder', currentMapId: mapId, status: 'grinding' }) };
  disconnectInstance.connectedSockets = new Map([['disconnected-grinder', 'socket-1']]);
  disconnectInstance.cleanupRedisSubscribers = () => {};
  disconnectInstance.gatewayService = {
    setOffline: async () => {},
    removePlayerFromMap: async () => { throw new Error('disconnect must not remove map presence'); },
  };
  disconnectInstance.logger = { log: () => {}, error: error => { throw error; } };
  await disconnectInstance.handleDisconnect({ characterId: 'disconnected-grinder' });
  assert.equal(hashes.get(`map:players:${mapId}`).has('disconnected-grinder'), true, 'disconnect must not remove grinding presence');

  console.log('Map presence: 10 assertions passed');
})().catch(error => { console.error(error); process.exit(1); });
