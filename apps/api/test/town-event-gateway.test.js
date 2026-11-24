const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../..');
const { createFakeRedis } = require('./helpers/fake-redis');
const { TownNav } = require('../../../packages/shared/dist');
const { TownRosterService } = require('../dist/apps/api/src/modules/presence/town-roster.service');
const { NanommoGateway } = require('../dist/apps/api/src/modules/gateway/nanommo.gateway');

const gatewaySrc = fs.readFileSync(path.join(root, 'apps/api/src/modules/gateway/nanommo.gateway.ts'), 'utf8');
for (const event of ['town:event:vases', 'town:event:vaseBroken', 'town:event:ended']) assert.ok(gatewaySrc.includes(`'${event}'`), `whitelist ${event}`);
assert.match(gatewaySrc, /@SubscribeMessage\('town:hitVase'\)/);
assert.match(fs.readFileSync(path.join(root, 'apps/api/src/modules/gateway/gateway.module.ts'), 'utf8'), /TownEventModule/);

const def = require(path.join(root, 'town_scenes.json')).towns.find((t) => t.mapId === 'map_town');
const nav = new TownNav(def);
const reach = nav.reachableFrom(def.spawn.x, def.spawn.z);
const free = (x, z) => reach.has(Math.floor(z) * nav.w + Math.floor(x));
// A vase spot with a free straight run 4 units to its west.
let vase = null;
for (let z = 2.5; z < def.size.h && !vase; z += 1) for (let x = 6.5; x < def.size.w && !vase; x += 1) {
  if ([0, 0.6, 1, 2, 3, 4].every((d) => free(x - d, z))) vase = { x, z };
}
assert.ok(vase, 'found a free run in map_town');

function roster(at) {
  const redis = createFakeRedis();
  const svc = Object.create(TownRosterService.prototype);
  Object.assign(svc, { redis, navs: new Map(), lastMoveAt: new Map(), dataService: { getTownScene: (id) => (id === 'map_town' ? def : null) },
    characterRepo: { findOne: async () => ({ id: 'c1', name: 'Hero', level: 1, currentMapId: 'map_town', travelIntent: null, pendingMapTransition: null, lastSeenAt: new Date() }) } });
  svc.rowOf = async (c) => ({ id: c.id, name: c.name, level: 1, appearance: null, lastSeenAt: new Date() });
  svc.publish = async () => undefined;
  // Character standing still at `at` (an arrived click-to-move, long ago).
  redis.hashes.set('town:state:map_town', new Map([['c1', JSON.stringify({ seed: 1, sleeping: null, wakeFrom: null, move: { fromX: at[0], fromZ: at[1], toX: at[0], toZ: at[1], at: Date.now() - 1000, lookAt: null } })]]));
  return { svc, redis };
}
const stored = (redis) => JSON.parse(redis.hashes.get('town:state:map_town').get('c1'));

(async () => {
  {
    const { svc, redis } = roster([vase.x - 4, vase.z]);
    await svc.move('c1', { approach: { x: vase.x, z: vase.z, distance: 0.6 } });
    const move = stored(redis).move;
    assert.ok(Math.abs(move.toX - (vase.x - 0.6)) < 0.01, `toX ${move.toX}`); assert.ok(Math.abs(move.toZ - vase.z) < 0.01);
    assert.deepEqual(move.lookAt, [vase.x, vase.z]);
  }
  {
    const { svc, redis } = roster([vase.x - 0.3, vase.z]);
    await svc.move('c1', { approach: { x: vase.x, z: vase.z, distance: 0.6 } });
    const move = stored(redis).move;
    assert.ok(Math.abs(move.toX - (vase.x - 0.3)) < 0.01, 'already close: stays'); assert.deepEqual(move.lookAt, [vase.x, vase.z]);
  }
  await assert.rejects(() => roster([vase.x - 4, vase.z]).svc.move('c1', { approach: { x: NaN, z: 1, distance: 0.6 } }), /INVALID_TARGET/);

  // Gateway: roster snapshots carry the live event; hit and vase move delegate.
  const gw = Object.create(NanommoGateway.prototype);
  const calls = [];
  Object.assign(gw, {
    townRoster: { snapshot: async (mapId) => ({ mapId, serverNow: 1, entries: [] }), poseOf: async () => ({ mapId: 'map_town', x: 1, z: 1, name: 'Hero' }),
      isTownPresent: () => 'map_town', move: async (id, target) => { calls.push(['move', id, target]); return { characterId: id }; } },
    townEvents: { activeEvent: async () => ({ eventKey: 'ss-1', mapId: 'map_town', endsAt: 9, vases: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }] }),
      hitVase: async (id, vaseId) => { calls.push(['hit', id, vaseId]); return { success: true, vaseId, prize: null }; },
      vasePosition: async (mapId, vaseId) => (vaseId === 'v1' ? { x: 5, z: 6 } : null) },
    dataService: { getSmashingSpreeConfig: () => ({ approachDistance: 0.6 }) },
    characterRepo: { findOne: async () => ({ id: 'c1', currentMapId: 'map_town' }) },
  });
  const client = { characterId: 'c1' };
  const snap = await gw.handleTownSyncRoster(client);
  assert.equal(snap.event.vases.length, 3);
  assert.deepEqual(await gw.handleTownHitVase(client, { vaseId: 'v1' }), { success: true, vaseId: 'v1', prize: null });
  assert.deepEqual(await gw.handleTownHitVase(client, { vaseId: 42 }), { success: false, error: 'UNKNOWN_VASE' });
  const moved = await gw.handleTownMove(client, { vaseId: 'v1' });
  assert.equal(moved.success, true);
  assert.deepEqual(calls.find((c) => c[0] === 'move'), ['move', 'c1', { approach: { x: 5, z: 6, distance: 0.6 } }]);
  assert.deepEqual(await gw.handleTownMove(client, { vaseId: 'gone' }), { success: false, error: 'UNKNOWN_VASE' });
  console.log('town-event-gateway passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
