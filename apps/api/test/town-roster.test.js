// Direct-execution Node test, run from the repo root:
//   pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build
//   node apps/api/test/town-roster.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '../../..');
const { TownRosterService } = require('../dist/apps/api/src/modules/presence/town-roster.service');
const { NanommoGateway } = require('../dist/apps/api/src/modules/gateway/nanommo.gateway');
const { TownNav, positionAt, mulberry32Seed, townMoveArrival } = require(path.join(repo, 'packages/shared/dist'));

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
    query: async (sql, [mapId, viewerId]) => {
      // rowOf(): one character's equipped rows
      if (/^\s*SELECT slot, "itemId" FROM equipped_items/.test(sql)) {
        const slots = (sql.match(/slot IN \(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.trim().replace(/'/g, ''));
        return (characters.get(mapId)?.equipped ?? []).filter(e => slots.includes(e.slot));
      }
      // snapshot(): the roster rows, `equipment` as json_object_agg would build it (null when nothing is equipped)
      const visible = (sql.match(/e\.slot IN \(([^)]*)\)\) AS "equipment"/)?.[1] ?? '').split(',').map(s => s.trim().replace(/'/g, ''));
      return [...characters.values()]
        .filter(c => c.currentMapId === mapId && !c.travelIntent && !c.pendingMapTransition)
        .reverse()
        .map(c => {
          const eq = (c.equipped ?? []).filter(e => visible.includes(e.slot));
          return {
            id: c.id, name: c.name, level: c.level, appearance: c.appearance, sex: c.sex, heightCm: c.heightCm, lastSeenAt: c.lastSeenAt,
            inViewerParty: !!partyOf.get(c.id) && partyOf.get(c.id) === partyOf.get(viewerId),
            equipment: eq.length ? Object.fromEntries(eq.map(e => [e.slot, e.itemId])) : null,
          };
        });
    },
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
  assert.equal(service.isTownPresent({ currentMapId: 'map_outpost', travelIntent: null, pendingMapTransition: null }), 'map_outpost', 'Outpost has a scene');
});

test('snapshot includes offline awake (only /sleep sleeps)', async () => {
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
    assert.equal(by[id].sleeping, null, `${id} should keep wandering`);
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

test('disconnect keeps wandering', async () => {
  const w = world();
  w.add('a');
  w.online('a');
  await w.service.setOnline('a', true);
  const awake = JSON.parse(w.hashes.get(`town:state:${TOWN}`).get('a'));
  await w.service.setOnline('a', false);
  const state = JSON.parse(w.hashes.get(`town:state:${TOWN}`).get('a'));
  assert.equal(state.sleeping, null);
  assert.equal(state.seed, awake.seed, 'same walk, no teleport');
  const update = w.townEvents().at(-1);
  assert.equal(update.payload.event, 'town:update');
  assert.equal(update.payload.entry.online, false);
  assert.equal(update.payload.entry.sleeping, null);
});

test('/sleep survives disconnect and reconnect', async () => {
  const w = world();
  w.add('a');
  w.online('a');
  await w.service.sleep('a');
  await w.service.setOnline('a', false);
  await w.service.setOnline('a', true);
  const state = JSON.parse(w.hashes.get(`town:state:${TOWN}`).get('a'));
  assert.notEqual(state.sleeping, null);
  const [entry] = (await w.service.snapshot(TOWN, 'a')).entries;
  assert.notEqual(entry.sleeping, null);
});

test('legacy offline sleep in Redis is read as awake where it lay', async () => {
  const w = world();
  w.add('a');
  const legacy = { seed: 1234, sleeping: { at: Date.now() - 60_000 }, wakeFrom: null };
  w.hashes.set(`town:state:${TOWN}`, new Map([['a', JSON.stringify(legacy)]]));
  const pose = positionAt(sierra, new TownNav(sierra), legacy, legacy.sleeping.at);
  const [entry] = (await w.service.snapshot(TOWN, 'x')).entries;
  assert.equal(entry.sleeping, null);
  assert.ok(Math.abs(entry.wakeFrom.x - pose.x) < 1e-9 && Math.abs(entry.wakeFrom.z - pose.z) < 1e-9);
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
  assert.equal(entry.sleeping, null);
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

test('entries carry dominant hand and hand gear for the selected-player card', async () => {
  const w = world();
  w.add('a', { dominantHand: 'left' });
  w.online('a');
  const slept = await w.service.sleep('a');
  assert.equal(slept.dominantHand, 'left');
  assert.equal(slept.mainHandItemId, null);
  const service = fs.readFileSync(path.join(repo, 'apps/api/src/modules/presence/town-roster.service.ts'), 'utf8');
  assert.match(service, /json_object_agg\(e\.slot, e\."itemId"\)[\s\S]*?AS "equipment"/);
  const controller = fs.readFileSync(path.join(repo, 'apps/api/src/modules/equipment/equipment.controller.ts'), 'utf8');
  assert.equal((controller.match(/this\.refreshTown\(characterId\)/g) ?? []).length, 2, 'equip and unequip refresh the town entry');
});

test('entries carry the six visible equipment slots (not accessories), in snapshots and single-entry updates', async () => {
  const equipped = [
    { slot: 'head', itemId: 'equip_head_phys_t1' }, { slot: 'body', itemId: 'equip_body_phys_t3' },
    { slot: 'cape', itemId: 'equip_cape_magic_t2' }, { slot: 'shoes', itemId: 'equip_shoes_fire_t3' },
    { slot: 'mainHand', itemId: 'equip_sword_t2' }, { slot: 'offHand', itemId: 'equip_shield_t1' },
    { slot: 'accessoryLeft', itemId: 'equip_ring_t1' },
  ];
  const expected = { head: 'equip_head_phys_t1', body: 'equip_body_phys_t3', cape: 'equip_cape_magic_t2', shoes: 'equip_shoes_fire_t3', mainHand: 'equip_sword_t2', offHand: 'equip_shield_t1' };
  const w = world();
  w.add('a', { equipped });
  w.add('b');
  w.online('a');
  const entries = (await w.service.snapshot(TOWN, 'a')).entries;
  const a = entries.find(e => e.characterId === 'a');
  assert.deepEqual(a.equipment, expected);
  assert.equal(a.mainHandItemId, 'equip_sword_t2');
  assert.equal(a.offHandItemId, 'equip_shield_t1');
  assert.deepEqual(entries.find(e => e.characterId === 'b').equipment, {});
  const slept = await w.service.sleep('a');
  assert.deepEqual(slept.equipment, expected);
  assert.equal(slept.offHandItemId, 'equip_shield_t1');
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

const settle = () => new Promise(r => setTimeout(r, 210)); // TOWN_MOVE_MIN_INTERVAL_MS

test('town:move walks from the current pose to the clicked point, one write and one broadcast', async () => {
  const w = world();
  w.add('a');
  w.online('a');
  const before = Date.now();
  const nav = new TownNav(sierra);
  const target = { x: sierra.spawn.x + 3, z: sierra.spawn.z };
  const entry = await w.service.move('a', target);
  assert.ok(entry.move);
  assert.ok(entry.move.at >= before);
  assert.equal(nav.blocked(Math.floor(entry.move.toX), Math.floor(entry.move.toZ)), false);
  const lazy = { seed: mulberry32Seed('a'), sleeping: null, wakeFrom: null };
  const from = positionAt(sierra, nav, lazy, entry.move.at);
  assert.ok(Math.hypot(entry.move.fromX - from.x, entry.move.fromZ - from.z) < 0.01, 'starts where it was');
  const events = w.townEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.event, 'town:update');
  assert.ok(entry.rev >= 1);
  const arrive = townMoveArrival(nav, entry.move);
  const pose = positionAt(sierra, nav, entry, arrive + 500);
  assert.ok(Math.hypot(pose.x - entry.move.toX, pose.z - entry.move.toZ) < 1e-6);
});

test('town:move snaps an unreachable point and rejects garbage; NPC clicks face the NPC', async () => {
  const w = world();
  w.add('a');
  const blocked = sierra.obstacles.find(o => o.kind === 'fountain' || o.kind === 'house');
  const snapped = await w.service.move('a', { x: blocked.x, z: blocked.z });
  const nav = new TownNav(sierra);
  assert.equal(nav.blocked(Math.floor(snapped.move.toX), Math.floor(snapped.move.toZ)), false);
  await settle();
  await assert.rejects(() => w.service.move('a', { x: Number.NaN, z: 3 }), err => err.message === 'INVALID_TARGET');
  await assert.rejects(() => w.service.move('a', { npcId: 'nobody' }), err => err.message === 'UNKNOWN_NPC');
  const [npcId, spot] = Object.entries(sierra.npcSpots)[0];
  const toNpc = await w.service.move('a', { npcId });
  assert.deepStrictEqual(toNpc.move.lookAt, [spot.x, spot.z]);
  assert.ok(Math.hypot(toNpc.move.toX - spot.x, toNpc.move.toZ - spot.z) < 4);
});

test('town:move spam within 200 ms is ignored (no extra write or broadcast)', async () => {
  const w = world();
  w.add('a');
  const first = await w.service.move('a', { x: sierra.spawn.x + 2, z: sierra.spawn.z });
  const second = await w.service.move('a', { x: sierra.spawn.x - 2, z: sierra.spawn.z });
  assert.deepStrictEqual(second.move, first.move);
  assert.equal(w.townEvents().length, 1);
});

test('town:move wakes a /sleep and ends an emote', async () => {
  const w = world();
  w.add('a');
  await w.service.sleep('a');
  const moved = await w.service.move('a', { x: sierra.spawn.x + 2, z: sierra.spawn.z });
  assert.equal(moved.sleeping, null);
  await settle();
  await w.service.emote('a', 'dance');
  await settle();
  const again = await w.service.move('a', { x: sierra.spawn.x, z: sierra.spawn.z + 2 });
  assert.equal(again.emote, null);
});

test('/dance and /sit hold where the character is; the same command stops; unknown emotes are refused', async () => {
  const w = world();
  w.add('a');
  const nav = new TownNav(sierra);
  const lazy = { seed: mulberry32Seed('a'), sleeping: null, wakeFrom: null };
  const dancing = await w.service.emote('a', 'dance');
  assert.equal(dancing.emote.kind, 'dance');
  const was = positionAt(sierra, nav, lazy, dancing.emote.at);
  const later = positionAt(sierra, nav, dancing, dancing.emote.at + 3_600_000);
  assert.equal(later.state, 'dance');
  assert.ok(Math.hypot(later.x - was.x, later.z - was.z) < 0.01, 'dances where it was, an hour later too');
  const sitting = await w.service.emote('a', 'sit');
  assert.equal(sitting.emote.kind, 'sit');
  assert.ok(Math.hypot(sitting.move.toX - was.x, sitting.move.toZ - was.z) < 0.01, 'switching emote does not move');
  const stopped = await w.service.emote('a', 'sit');
  assert.equal(stopped.emote, null);
  const standing = positionAt(sierra, nav, stopped, Date.now() + 100);
  assert.equal(standing.state, 'idle');
  assert.ok(Math.hypot(standing.x - was.x, standing.z - was.z) < 0.01, 'stands up on the spot');
  assert.ok(stopped.rev > sitting.rev && sitting.rev > dancing.rev, 'rev grows on every change');
  await assert.rejects(() => w.service.emote('a', 'backflip'), err => err.message === 'UNKNOWN_EMOTE');
});

test('/sleep during an emote lies down where the emote was', async () => {
  const w = world();
  w.add('a');
  const nav = new TownNav(sierra);
  const sat = await w.service.emote('a', 'sit');
  const held = positionAt(sierra, nav, sat, Date.now());
  const slept = await w.service.sleep('a');
  assert.equal(slept.emote, null);
  const lying = positionAt(sierra, nav, slept, Date.now() + 60_000);
  assert.equal(lying.state, 'sleep');
  assert.ok(Math.hypot(lying.x - held.x, lying.z - held.z) < 0.01);
});

test('arrival carries joinedAt (spawn aura on every client)', async () => {
  const w = world();
  w.add('a', { currentMapId: 'map_green_grounds_0' });
  await w.service.syncCharacter('a', null);
  w.characters.get('a').currentMapId = TOWN;
  const before = Date.now();
  await w.service.syncCharacter('a', 'map_green_grounds_0');
  const join = w.townEvents().find(e => e.payload.event === 'town:join');
  assert.ok(join.payload.entry.joinedAt >= before);
});

test('gateway source: town:move and town:emote are wired', () => {
  const gateway = fs.readFileSync(path.join(repo, 'apps/api/src/modules/gateway/nanommo.gateway.ts'), 'utf8');
  assert.match(gateway, /@SubscribeMessage\('town:move'\)[\s\S]*?townRoster\.move\(/);
  assert.match(gateway, /@SubscribeMessage\('town:emote'\)[\s\S]*?townRoster\.emote\(/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.error(`FAIL - ${name}\n  ${e.message}`); }
  }
  if (failed) { console.error(`${failed}/${tests.length} failed`); process.exit(1); }
  console.log(`${tests.length}/${tests.length} passed`);
})();
