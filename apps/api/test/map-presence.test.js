const assert = require('assert');
const { GatewayService } = require('../dist/apps/api/src/modules/gateway/gateway.service');

const hashes = new Map();
const published = [];
const redis = {
  hset: async (key, id) => { if (!hashes.has(key)) hashes.set(key, new Map()); hashes.get(key).set(id, Date.now()); },
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
  await gateway.addPlayerToMap('a', 'map_green_grounds');
  await gateway.addPlayerToMap('b', 'map_green_grounds');
  assert.strictEqual(await gateway.getPlayersOnMap('map_green_grounds'), 2);
  await gateway.publishMapPresence('map_green_grounds');
  assert.strictEqual(JSON.parse(published.at(-1).message).playersOnMap, 2);
  await gateway.removePlayerFromMap('b', 'map_green_grounds');
  await gateway.publishMapPresence('map_green_grounds');
  assert.strictEqual(await gateway.getPlayersOnMap('map_green_grounds'), 1);
  assert.strictEqual(JSON.parse(published.at(-1).message).playersOnMap, 1);
  console.log('Map presence: 4 assertions passed');
})().catch(error => { console.error(error); process.exit(1); });
