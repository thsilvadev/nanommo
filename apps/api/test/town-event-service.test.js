const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '../../..');
const { createFakeRedis } = require('./helpers/fake-redis');
const { TownEventService } = require('../dist/apps/api/src/modules/town-event/town-event.service');
const { TownRosterService } = require('../dist/apps/api/src/modules/presence/town-roster.service');
const { ChatService } = require('../dist/apps/api/src/modules/chat/chat.service');

const cfg = require(path.join(root, 'town_events.json')).smashingSpree;
const towns = require(path.join(root, 'town_scenes.json')).towns;
const mapIds = towns.map((t) => t.mapId);
const startMs = Date.parse('2026-11-24T09:30:00-03:00');
const eventKey = `ss-${startMs}`;
const startPhase = { kind: 'start', eventKey, startMs, endsAt: startMs + cfg.durationSeconds * 1000 };

let clock = startMs + 1000;
const realNow = Date.now;
Date.now = () => clock;

function setup() {
  const redis = createFakeRedis(() => clock);
  const poses = new Map(); // characterId -> { mapId, x, z, name }
  const roster = { poseOf: async (id) => poses.get(id) ?? null };
  const announces = []; const finds = [];
  const chat = { announceServerMessage: async (...args) => announces.push(args), announceEventFind: async (...args) => finds.push(args) };
  const grants = [];
  const grant = { grant: async (...args) => { grants.push(args); return 'bag'; } };
  const data = { getSmashingSpreeConfig: () => cfg, getTownSceneMapIds: () => mapIds, getTownScene: (id) => towns.find((t) => t.mapId === id) ?? null, getMaps: () => [{ id: 'map_town', name: 'Sierra Village' }] };
  const svc = new TownEventService(redis, data, roster, chat, grant);
  return { svc, redis, poses, announces, finds, grants };
}
const ofEvent = (redis, event) => redis.published.filter((p) => p.payload.kind === 'town' && p.payload.event === event);
async function vasesOf(svc, mapId) { return (await svc.activeEvent(mapId)).vases; }
const standAt = (poses, id, mapId, v, dx = 0) => poses.set(id, { mapId, x: v.x + dx, z: v.z, name: id });

(async () => {
  // Start: idempotent, public layout only.
  {
    const { svc, redis, announces } = setup();
    await svc.runPhase(startPhase); await svc.runPhase(startPhase);
    const vases = ofEvent(redis, 'town:event:vases');
    assert.equal(vases.length, 1, 'Sierra Village only');
    assert.equal(vases[0].payload.mapId, 'map_town');
    for (const v of vases) { assert.equal(v.payload.vases.length, 500); assert.equal(v.payload.startsAt, startMs); assert.equal(v.payload.endsAt, startPhase.endsAt); assert.ok(!JSON.stringify(v.payload).includes('itemId')); }
    assert.equal(await svc.activeEvent('map_outpost'), null, 'no vases in other towns');
    assert.equal((await svc.activeEvent('map_town')).startsAt, startMs);
    assert.equal(announces.length, 1); assert.equal(announces[0][2], 'event.smashingSpree.started');
    assert.deepEqual(announces[0][3], { mapId: 'map_town' }); assert.match(announces[0][0], /in Sierra Village!/);
    await svc.runPhase({ kind: 'announce', eventKey, startMs, minutes: 5 }); await svc.runPhase({ kind: 'announce', eventKey, startMs, minutes: 5 });
    assert.equal(announces.length, 2); assert.equal(announces[1][2], 'event.smashingSpree.soon'); assert.deepEqual(announces[1][3], { minutes: 5, mapId: 'map_town' });
    assert.match(announces[1][0], /Smashing Spree starts in 5 minutes! Head to Sierra Village\./);
  }
  // Hit validation.
  {
    const { svc, poses, grants } = setup();
    const town = 'map_town';
    assert.deepEqual(await svc.hitVase('a', 'v000'), { success: false, error: 'NOT_IN_TOWN' });
    poses.set('a', { mapId: town, x: 1, z: 1, name: 'a' });
    assert.deepEqual(await svc.hitVase('a', 'v000'), { success: false, error: 'NO_EVENT' });
    await svc.runPhase(startPhase);
    const [v1, v2] = await vasesOf(svc, town);
    standAt(poses, 'a', town, v1, 1.01);
    assert.deepEqual(await svc.hitVase('a', v1.id), { success: false, error: 'OUT_OF_RANGE' });
    clock += 10;
    standAt(poses, 'a', town, v1, 0.6);
    assert.deepEqual(await svc.hitVase('a', v1.id), { success: false, error: 'COOLDOWN' });
    clock += 1000;
    const ok = await svc.hitVase('a', v1.id);
    assert.equal(ok.success, true); assert.equal(ok.vaseId, v1.id);
    standAt(poses, 'a', town, v2, 0.2);
    assert.deepEqual(await svc.hitVase('a', v2.id), { success: false, error: 'COOLDOWN' });
    clock += 1000;
    assert.equal((await svc.hitVase('a', v2.id)).success, true);
    clock += 1000;
    assert.deepEqual(await svc.hitVase('a', 'v999'), { success: false, error: 'UNKNOWN_VASE' });
    assert.ok(!(await vasesOf(svc, town)).some((v) => v.id === v1.id || v.id === v2.id), 'broken vases excluded');
    assert.ok(grants.length <= 2);
  }
  // Race: two characters, same vase.
  {
    clock = startMs + 1000;
    const { svc, poses, redis } = setup();
    await svc.runPhase(startPhase);
    const town = 'map_town';
    const [v] = await vasesOf(svc, town);
    standAt(poses, 'a', town, v, 0.3); standAt(poses, 'b', town, v, -0.3);
    const results = await Promise.all([svc.hitVase('a', v.id), svc.hitVase('b', v.id)]);
    assert.equal(results.filter((r) => r.success).length, 1);
    assert.equal(results.filter((r) => r.error === 'ALREADY_BROKEN').length, 1);
    assert.equal(ofEvent(redis, 'town:event:vaseBroken').length, 1);
  }
  // Expired event with keys still present.
  {
    clock = startMs + 1000;
    const { svc, poses } = setup();
    await svc.runPhase(startPhase);
    const [v] = await vasesOf(svc, 'map_town');
    clock = startPhase.endsAt + 1;
    standAt(poses, 'a', 'map_town', v);
    assert.deepEqual(await svc.hitVase('a', v.id), { success: false, error: 'NO_EVENT' });
    assert.equal(await svc.activeEvent('map_town'), null);
  }
  // Prizes, find announcements, early end, timeout end.
  {
    clock = startMs + 1000;
    const { svc, poses, redis, grants, finds } = setup();
    await svc.runPhase(startPhase);
    const town = 'map_town';
    const prizeIds = Object.keys(await redis.hgetall(`ss:${eventKey}:${town}:prizes`));
    assert.equal(prizeIds.length, 40);
    const vases = await vasesOf(svc, town);
    let id = 0;
    for (const vaseId of prizeIds) {
      const v = vases.find((x) => x.id === vaseId);
      const who = `p${id++}`; standAt(poses, who, town, v);
      const r = await svc.hitVase(who, vaseId);
      assert.equal(r.success, true); assert.ok(r.prize && r.prize.via === 'bag');
    }
    assert.equal(grants.length, 40);
    assert.equal(finds.length, 10, 'eight Bliss Stones + two Divine Shards');
    assert.ok(finds.every((f) => ['mat_bliss_stone', 'mat_divine_shard'].includes(f[1])));
    const ended = ofEvent(redis, 'town:event:ended');
    assert.equal(ended.length, 1); assert.equal(ended[0].payload.mapId, town); assert.equal(ended[0].payload.reason, 'all-prizes-found');
    const other = vases.find((v) => !prizeIds.includes(v.id));
    standAt(poses, 'late', town, other);
    assert.deepEqual(await svc.hitVase('late', other.id), { success: false, error: 'NO_EVENT' });
    assert.ok(ofEvent(redis, 'town:event:vaseBroken').every((b) => b.payload.prize === true));
    clock = startPhase.endsAt + 5000;
    await svc.runPhase({ kind: 'end', eventKey, startMs }); await svc.runPhase({ kind: 'end', eventKey, startMs });
    const timeouts = ofEvent(redis, 'town:event:ended').filter((e) => e.payload.reason === 'timeout');
    assert.equal(timeouts.length, 0, 'ended early: no timeout');
  }
  // Timeout end in Sierra Village.
  {
    clock = startMs + 1000;
    const { svc, redis } = setup();
    await svc.runPhase(startPhase);
    clock = startPhase.endsAt + 5000;
    await svc.runPhase({ kind: 'end', eventKey, startMs }); await svc.runPhase({ kind: 'end', eventKey, startMs });
    const timeouts = ofEvent(redis, 'town:event:ended').filter((e) => e.payload.reason === 'timeout');
    assert.equal(timeouts.length, 1); assert.equal(timeouts[0].payload.mapId, 'map_town');
  }
  // vasePosition.
  {
    clock = startMs + 1000;
    const { svc } = setup();
    await svc.runPhase(startPhase);
    const [v] = await vasesOf(svc, 'map_town');
    assert.deepEqual(await svc.vasePosition('map_town', v.id), { x: v.x, z: v.z });
    assert.equal(await svc.vasePosition('map_town', 'nope'), null);
  }
  // Roster poseOf.
  {
    const redis = createFakeRedis(() => clock);
    const roster = Object.create(TownRosterService.prototype);
    Object.assign(roster, { redis, navs: new Map(), lastMoveAt: new Map(), dataService: { getTownScene: (id) => towns.find((t) => t.mapId === id) ?? null },
      characterRepo: { findOne: async ({ where }) => where.id === 'in' ? { id: 'in', name: 'Hero', currentMapId: 'map_town', travelIntent: null, pendingMapTransition: null } : { id: 'out', name: 'Out', currentMapId: 'map_forest', travelIntent: null, pendingMapTransition: null } } });
    const pose = await roster.poseOf('in');
    assert.equal(pose.mapId, 'map_town'); assert.equal(pose.name, 'Hero'); assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.z));
    assert.equal(await roster.poseOf('out'), null);
  }
  // ChatService: announce keys and finds.
  {
    const redis = createFakeRedis();
    const chat = Object.create(ChatService.prototype);
    Object.assign(chat, { redis, logger: { error: (m) => { throw new Error(m); } }, dataService: { getItemById: () => ({ name: 'Divine Shard' }), getMaps: () => [{ id: 'map_town', name: 'Sierra Village' }] } });
    await chat.announceServerMessage('Soon', 'k1', 'event.smashingSpree.soon', { minutes: 5 });
    assert.equal(redis.published[0].payload.type, 'server_announce'); assert.equal(redis.published[0].payload.key, 'event.smashingSpree.soon'); assert.deepEqual(redis.published[0].payload.params, { minutes: 5 });
    await chat.announceEventFind('Hero', 'mat_divine_shard', 'map_town', 'f1');
    const find = redis.published[1].payload;
    assert.equal(find.type, 'event_find'); assert.equal(find.channel, 'journal'); assert.equal(find.key, 'event.smashingSpree.found');
    assert.deepEqual(find.params, { name: 'Hero', itemId: 'mat_divine_shard', mapId: 'map_town' });
    assert.equal(find.message, 'Hero found Divine Shard in Sierra Village!');
  }
  Date.now = realNow;
  console.log('town-event-service passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
