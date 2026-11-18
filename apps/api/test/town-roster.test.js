// Direct-execution Node test, run from the repo root:
//   pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build
//   node apps/api/test/town-roster.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '../../..');
const { TownRosterService } = require('../dist/apps/api/src/modules/presence/town-roster.service');
const { NanommoGateway } = require('../dist/apps/api/src/modules/gateway/nanommo.gateway');
const { TownNav, positionAt, mulberry32Seed } = require(path.join(repo, 'packages/shared/dist'));

const TOWN = 'map_town';
const towns = JSON.parse(fs.readFileSync(path.join(repo, 'town_scenes.json'), 'utf8')).towns;
const sierra = towns.find(t => t.mapId === TOWN);
const dataService = { getTownScene: id => towns.find(t => t.mapId === id) ?? null };

function world() {
  const hashes = new Map();
  const sets = new Map();
  const published = [];
  const characters = new Map();
  const partyOf = new Map(); // characterId -> partyId
  const redis = {
    hget: async (k, f) => hashes.get(k)?.get(f) ?? null,
    hset: async (k, f, v) => { if (!hashes.has(k)) hashes.set(k, new Map()); hashes.get(k).set(f, String(v)); },
    hdel: async (k, f) => { hashes.get(k)?.delete(f); },
    hgetall: async k => Object.fromEntries(hashes.get(k) ?? []),
    smembers: async k => [...(sets.get(k) ?? [])],
    sismember: async (k, m) => (sets.get(k)?.has(m) ? 1 : 0),
    publish: async (channel, message) => { published.push({ channel, payload: JSON.parse(message) }); },
  };
  const characterRepo = {
    findOne: async ({ where: { id } }) => characters.get(id) ?? null,
    // The SQL does the heavy filtering/limit; the service must not rely on its order.
    query: async (_sql, [mapId, viewerId]) => [...characters.values()]
      .filter(c => c.currentMapId === mapId && !c.travelIntent && !c.pendingMapTransition)
      .reverse()
      .map(c => ({
        id: c.id, name: c.name, level: c.level, appearance: c.appearance, sex: c.sex, heightCm: c.heightCm, lastSeenAt: c.lastSeenAt,
        inViewerParty: !!partyOf.get(c.id) && partyOf.get(c.id) === partyOf.get(viewerId),
      })),
  };
  const add = (id, extra = {}) => characters.set(id, {
    id, name: `Char ${id}`, level: 10, appearance: null, sex: 'female', heightCm: 170, currentMapId: TOWN, travelIntent: null,
    pendingMapTransition: null, lastSeenAt: new Date(Date.UTC(2026, 10, 1)), ...extra,
  });
  const online = id => { if (!sets.has('players:online')) sets.set('players:online', new Set()); sets.get('players:online').add(id); };
  const service = new TownRosterService(characterRepo, redis, dataService);
  const townEvents = () => published.filter(p => p.channel === 'gateway:map:presence' && p.payload.kind === 'town');
  return { service, add, online, characters, partyOf, hashes, townEvents };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('presence criterion', async () => {
  const { service } = world();
  assert.equal(service.isTownPresent({ currentMapId: TOWN, travelIntent: null, pendingMapTransition: null }), TOWN);
  assert.equal(service.isTownPresent({ currentMapId: TOWN, travelIntent: { kind: 'route' }, pendingMapTransition: null }), null);
  assert.equal(service.isTownPresent({ currentMapId: TOWN, travelIntent: null, pendingMapTransition: { destinationMapId: 'x' } }), null);
  assert.equal(service.isTownPresent({ currentMapId: 'map_green_grounds_0', travelIntent: null, pendingMapTransition: null }), null);
  assert.equal(service.isTownPresent({ currentMapId: 'map_outpost', travelIntent: null, pendingMapTransition: null }), null, 'Outpost has no scene');
});

test('snapshot includes offline asleep', async () => {
  const w = world();
  for (const id of ['a', 'b', 'c']) w.add(id);
  w.online('a');
  const snap = await w.service.snapshot(TOWN, 'a');
  assert.equal(snap.mapId, TOWN);
  assert.ok(Math.abs(snap.serverNow - Date.now()) < 1000);
  const by = Object.fromEntries(snap.entries.map(e => [e.characterId, e]));
  assert.equal(by.a.online, true);
  assert.equal(by.a.sleeping, null);
  for (const id of ['b', 'c']) {
    assert.equal(by[id].online, false);
    assert.notEqual(by[id].sleeping, null, `${id} should sleep`);
  }
});

test('snapshot cap and order', async () => {
  const w = world();
  for (let i = 0; i < 250; i++) {
    w.add(`p${i}`, { lastSeenAt: new Date(Date.UTC(2026, 10, 1) + i * 60_000) });
  }
  const viewer = 'p7';
  for (const id of ['p3', 'p200']) w.partyOf.set(id, 'party-1');
  w.partyOf.set(viewer, 'party-1');
  for (const id of ['p1', 'p2', 'p100']) w.online(id);
  w.online(viewer);
  const { entries } = await w.service.snapshot(TOWN, viewer);
  assert.equal(entries.length, 200);
  assert.equal(entries[0].characterId, viewer);
  assert.deepStrictEqual(entries.slice(1, 3).map(e => e.characterId).sort(), ['p200', 'p3']);
  assert.deepStrictEqual(entries.slice(3, 6).map(e => e.characterId).sort(), ['p1', 'p100', 'p2']);
  const rest = entries.slice(6);
  assert.ok(rest.every(e => !e.online));
  for (let i = 1; i < rest.length; i++) assert.ok(rest[i - 1].lastSeenAt >= rest[i].lastSeenAt, 'offline by lastSeenAt desc');
  assert.equal(rest[0].characterId, 'p249');
});

test('disconnect -> sleep', async () => {
  const w = world();
  w.add('a');
  w.online('a');
  await w.service.setOnline('a', true);
  const before = Date.now();
  await w.service.setOnline('a', false);
  const state = JSON.parse(w.hashes.get(`town:state:${TOWN}`).get('a'));
  assert.ok(state.sleeping && state.sleeping.at >= before);
  const update = w.townEvents().at(-1);
  assert.equal(update.payload.event, 'town:update');
  assert.equal(update.payload.mapId, TOWN);
  assert.equal(update.payload.entry.characterId, 'a');
  assert.notEqual(update.payload.entry.sleeping, null);
});

test('connect after disconnect -> awake', async () => {
  const w = world();
  w.add('a');
  await w.service.setOnline('a', false);
  const slept = JSON.parse(w.hashes.get(`town:state:${TOWN}`).get('a'));
  const sleepPose = positionAt(sierra, new TownNav(sierra), slept, slept.sleeping.at);
  w.online('a');
  const entry = await w.service.setOnline('a', true);
  const state = JSON.parse(w.hashes.get(`town:state:${TOWN}`).get('a'));
  assert.equal(state.sleeping, null);
  assert.notEqual(state.seed, slept.seed, 'new seed on wake');
  assert.ok(Math.abs(state.wakeFrom.x - sleepPose.x) < 1e-9 && Math.abs(state.wakeFrom.z - sleepPose.z) < 1e-9, 'wakes where it slept');
  assert.equal(entry.sleeping, null);
  assert.equal(w.townEvents().at(-1).payload.entry.sleeping, null);
});

test('travel start -> leave', async () => {
  const w = world();
  w.add('a');
  w.online('a');
  await w.service.setOnline('a', true);
  w.characters.get('a').travelIntent = { kind: 'route', destinationMapId: 'map_green_grounds_0' };
  await w.service.syncCharacter('a');
  const leave = w.townEvents().at(-1);
  assert.equal(leave.payload.event, 'town:leave');
  assert.equal(leave.payload.mapId, TOWN);
  assert.equal(leave.payload.characterId, 'a');
  assert.equal(w.hashes.get(`town:state:${TOWN}`).has('a'), false);
});

test('travel start -> leave, even without stored town state', async () => {
  const w = world();
  w.add('lazy', { travelIntent: { kind: 'route' } });
  await w.service.syncCharacter('lazy');
  const leave = w.townEvents().at(-1);
  assert.equal(leave?.payload.event, 'town:leave');
  assert.equal(leave.payload.characterId, 'lazy');
});

test('arrival -> join from spawn with a new seed', async () => {
  const w = world();
  w.add('a', { currentMapId: 'map_green_grounds_0' });
  w.online('a');
  await w.service.syncCharacter('a', null);
  assert.equal(w.townEvents().length, 0, 'no town event for a grind map');
  w.characters.get('a').currentMapId = TOWN;
  await w.service.syncCharacter('a', 'map_green_grounds_0');
  const join = w.townEvents().at(-1);
  assert.equal(join.payload.event, 'town:join');
  assert.equal(join.payload.entry.characterId, 'a');
  assert.equal(join.payload.entry.sleeping, null);
  assert.deepStrictEqual({ x: join.payload.entry.wakeFrom.x, z: join.payload.entry.wakeFrom.z }, sierra.spawn);
  await w.service.syncCharacter('a');
  assert.equal(w.townEvents().length, 1, 'idempotent: no second join');
});

test('unknown previous map does not re-join a lazy entry already in town', async () => {
  const w = world();
  w.add('lazy');
  await w.service.syncCharacter('lazy');
  assert.equal(w.townEvents().length, 0);
  await w.service.syncCharacter('lazy', null);
  assert.equal(w.townEvents().at(-1).payload.event, 'town:join', 'known non-town origin does join');
});

test('sleep outside town', async () => {
  const w = world();
  w.add('a', { currentMapId: 'map_green_grounds_0' });
  await assert.rejects(() => w.service.sleep('a'), err => err.constructor.name === 'BadRequestException');
});

test('sleep then wake in town', async () => {
  const w = world();
  w.add('a');
  w.online('a');
  const slept = await w.service.sleep('a');
  assert.notEqual(slept.sleeping, null);
  assert.equal(w.townEvents().at(-1).payload.event, 'town:update');
  const woke = await w.service.wake('a');
  assert.equal(woke.sleeping, null);
  assert.notEqual(woke.wakeFrom, null);
});

test('snapshot SQL types every parameter once (Postgres rejects $2 deduced as both uuid and text)', () => {
  const src = fs.readFileSync(path.join(repo, 'apps/api/src/modules/presence/town-roster.service.ts'), 'utf8');
  const sql = src.slice(src.indexOf('SELECT c.id'), src.indexOf('LIMIT $4') + 'LIMIT $4'.length);
  const uses = sql.match(/\$2(::\w+)?/g) ?? [];
  assert.ok(uses.length >= 2, 'viewer id is used in the join and the ordering');
  assert.deepStrictEqual([...new Set(uses)], ['$2::uuid'], `every $2 must be cast to uuid, got ${uses.join(', ')}`);
  assert.doesNotMatch(sql, /c\.id::text = \$2/);
});

test('lazy offline entry', async () => {
  const w = world();
  const lastSeenAt = new Date(Date.UTC(2026, 9, 3, 4, 5, 6));
  w.add('ghost', { lastSeenAt });
  const [entry] = (await w.service.snapshot(TOWN, 'someone-else')).entries;
  assert.equal(entry.seed, mulberry32Seed('ghost'));
  assert.deepStrictEqual(entry.sleeping, { at: lastSeenAt.getTime() });
  assert.equal(entry.lastSeenAt, lastSeenAt.toISOString());
});

test('entries carry sex and height so clients can pick the body', async () => {
  const w = world();
  w.add('a', { sex: 'male', heightCm: 190 });
  w.online('a');
  const [snapEntry] = (await w.service.snapshot(TOWN, 'a')).entries;
  assert.equal(snapEntry.sex, 'male');
  assert.equal(snapEntry.heightCm, 190);
  const slept = await w.service.sleep('a');
  assert.equal(slept.sex, 'male');
  assert.equal(slept.heightCm, 190);
  const service = fs.readFileSync(path.join(repo, 'apps/api/src/modules/presence/town-roster.service.ts'), 'utf8');
  assert.match(service, /c\.sex, c\."heightCm"/);
});

test('gateway: stale socket disconnect does not put the character to sleep', async () => {
  const calls = [];
  const gw = Object.create(NanommoGateway.prototype);
  gw.connectedSockets = new Map([['c', 'socket-new']]);
  gw.cleanupRedisSubscribers = () => calls.push('cleanup');
  gw.onlinePresenceService = { setOffline: async () => calls.push('offline'), getOnlineCount: async () => 1 };
  gw.townRoster = { setOnline: async (id, on) => calls.push(`town:${id}:${on}`) };
  gw.server = { to: () => ({ emit: () => {} }) };
  gw.logger = { log: () => {}, error: e => { throw e; } };
  await gw.handleDisconnect({ id: 'socket-old', characterId: 'c' });
  assert.deepStrictEqual(calls, [], 'an old socket closing after a reconnect touches nothing');
  await gw.handleDisconnect({ id: 'socket-new', characterId: 'c' });
  assert.ok(calls.includes('town:c:false'));
});

test('gateway: time:sync acks the server clock', async () => {
  const gw = Object.create(NanommoGateway.prototype);
  const ack = await gw.handleTimeSync();
  assert.ok(Math.abs(ack.serverNow - Date.now()) < 1000);
});

test('gateway source: town events are re-emitted and query stays narrow', () => {
  const gateway = fs.readFileSync(path.join(repo, 'apps/api/src/modules/gateway/nanommo.gateway.ts'), 'utf8');
  for (const event of ["'town:syncRoster'", "'town:sleep'", "'town:wake'", "'time:sync'", "kind === 'town'"]) {
    assert.ok(gateway.includes(event), `gateway handles ${event}`);
  }
  const service = fs.readFileSync(path.join(repo, 'apps/api/src/modules/presence/town-roster.service.ts'), 'utf8');
  assert.match(service, /"currentMapId" = \$1 AND c\."travelIntent" IS NULL AND c\."pendingMapTransition" IS NULL/);
  assert.match(service, /LIMIT \$\d/);
  assert.doesNotMatch(service, /Math\.random/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.error(`FAIL - ${name}\n  ${e.message}`); }
  }
  if (failed) { console.error(`${failed}/${tests.length} failed`); process.exit(1); }
  console.log(`${tests.length}/${tests.length} passed`);
})();
