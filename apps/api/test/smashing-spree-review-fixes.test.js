const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '../../..');
const { createFakeRedis } = require('./helpers/fake-redis');
const { TownEventService } = require('../dist/apps/api/src/modules/town-event/town-event.service');
const { TownEventGrantService } = require('../dist/apps/api/src/modules/town-event/town-event-grant.service');
const { TownEventProcessor } = require('../dist/apps/api/src/modules/town-event/town-event.processor');
const { assignPrizes, eventSeed } = require('../dist/apps/api/src/modules/town-event/smashing-spree.logic');

const cfg = require(path.join(root, 'town_events.json')).smashingSpree;
const towns = require(path.join(root, 'town_scenes.json')).towns;
const mapIds = towns.map((t) => t.mapId);
const startMs = Date.parse('2026-11-24T09:30:00-03:00');
const eventKey = `ss-${startMs}`;
const startPhase = { kind: 'start', eventKey, startMs, endsAt: startMs + 120000 };
const realNow = Date.now;
let clock = startMs + 1000;

function setup(overrides = {}) {
  const redis = createFakeRedis(() => clock);
  const poses = new Map();
  const grants = [];
  const svc = new TownEventService(redis,
    { getSmashingSpreeConfig: () => cfg, getTownSceneMapIds: () => mapIds, getTownScene: (id) => towns.find((t) => t.mapId === id) ?? null },
    { poseOf: async (id) => poses.get(id) ?? null },
    { announceServerMessage: async () => undefined, announceEventFind: async () => undefined },
    overrides.grant ?? { grant: async (...a) => { grants.push(a); return 'bag'; } });
  svc.logger = { error: () => undefined, warn: () => undefined, log: () => undefined };
  return { svc, redis, poses, grants };
}

(async () => {
  Date.now = () => clock;
  // C1: the prize layout cannot be rebuilt from public data (eventKey, mapId, vase ids, catalogue).
  {
    const { svc, redis } = setup();
    await svc.runPhase(startPhase);
    let predictable = 0;
    for (const mapId of mapIds) {
      const vases = JSON.parse(await redis.get(`ss:${eventKey}:${mapId}:vases`));
      const stored = Object.keys(await redis.hgetall(`ss:${eventKey}:${mapId}:prizes`)).sort();
      const guessed = [...assignPrizes(vases, eventSeed(eventKey, mapId), cfg).keys()].sort();
      if (JSON.stringify(stored) === JSON.stringify(guessed)) predictable++;
      assert.equal(stored.length, 20);
    }
    assert.equal(predictable, 0, 'prize vases must not be derivable from public inputs');
  }
  // I1: a Redis failure after the claim still grants the prize and reports success.
  {
    clock = startMs + 1000;
    const { svc, redis, poses, grants } = setup();
    await svc.runPhase(startPhase);
    const town = 'map_town';
    const prizeId = Object.keys(await redis.hgetall(`ss:${eventKey}:${town}:prizes`))[0];
    const vase = (await svc.activeEvent(town)).vases.find((v) => v.id === prizeId);
    poses.set('a', { mapId: town, x: vase.x, z: vase.z, name: 'a' });
    const publish = redis.publish; const decr = redis.decr;
    redis.publish = async () => { throw new Error('redis blip'); };
    redis.decr = async () => { throw new Error('redis blip'); };
    const result = await svc.hitVase('a', prizeId);
    redis.publish = publish; redis.decr = decr;
    assert.equal(result.success, true, 'claimed vase reports success');
    assert.equal(grants.length, 1, 'prize still granted');
  }
  // M1: a failed start is retried (guard released), and towns already started are not respawned.
  {
    clock = startMs + 1000;
    const { svc, redis } = setup();
    const set = redis.set; let failOnce = true;
    redis.set = async (key, ...rest) => { if (failOnce && key === `ss:${eventKey}:map_outpost:vases`) { failOnce = false; throw new Error('redis blip'); } return set(key, ...rest); };
    await assert.rejects(() => svc.runPhase(startPhase));
    const before = redis.published.filter((p) => p.payload.event === 'town:event:vases').length;
    assert.equal(before, 4);
    await svc.runPhase(startPhase);
    const spawned = redis.published.filter((p) => p.payload.event === 'town:event:vases').map((p) => p.payload.mapId);
    assert.equal(spawned.length, 5, 'the retry starts only the failed town');
    assert.equal(spawned.filter((m) => m === 'map_outpost').length, 1);
  }
  // I2: the phase comes from the job's scheduled minute; a late start still runs while the event would be live.
  {
    const phases = [];
    const processor = new TownEventProcessor({ runPhase: async (p) => phases.push(p) }, { getSmashingSpreeConfig: () => cfg });
    const job = (scheduledIso) => ({ timestamp: Date.parse(scheduledIso) - 60000, opts: { delay: 60000, repeat: { cron: '* * * * *' } } });
    clock = Date.parse('2026-11-24T09:31:20-03:00');
    await processor.handleTick(job('2026-11-24T09:30:00-03:00'));
    assert.equal(phases.length, 1); assert.equal(phases[0].kind, 'start');
    clock = Date.parse('2026-11-24T09:32:30-03:00');
    await processor.handleTick(job('2026-11-24T09:30:00-03:00'));
    assert.equal(phases.length, 1, 'too late to start: the event would already be over');
    clock = Date.parse('2026-11-24T09:28:30-03:00');
    await processor.handleTick(job('2026-11-24T09:25:00-03:00'));
    assert.equal(phases.length, 1, 'a 5-minute warning 3 minutes late is skipped');
    clock = Date.parse('2026-11-24T09:25:20-03:00');
    await processor.handleTick({});
    assert.equal(phases.length, 2, 'no schedule info: falls back to now');
  }
  // I3: no Bull consumer or scheduler in maintenance contexts.
  {
    const modulePath = require.resolve('../dist/apps/api/src/modules/town-event/town-event.module');
    delete require.cache[modulePath];
    process.env.BATTLE_QUEUE_MAINTENANCE_ONLY = 'true';
    const { TownEventModule } = require(modulePath);
    delete process.env.BATTLE_QUEUE_MAINTENANCE_ONLY;
    const providers = Reflect.getMetadata('providers', TownEventModule).map((p) => p.name);
    assert.ok(!providers.includes('TownEventProcessor') && !providers.includes('TownEventScheduler'), providers.join(','));
    assert.ok(providers.includes('TownEventService'));
  }
  // M5: lock release failing after the bag commit does not mail a second copy.
  {
    let mailed = 0;
    const svc = new TownEventGrantService(createFakeRedis(), { transaction: async (fn) => fn({}) }, { addItem: async () => ({}) },
      { sendSystemMail: async () => { mailed++; return { id: 'm' }; } },
      { withCharacterQueueLock: async (_id, op) => { await op(); throw new Error('advisory unlock failed'); } },
      { publishMailNewItem: async () => undefined, publishItemsObtained: async () => undefined });
    svc.logger = { warn() {}, error() {} };
    assert.equal(await svc.grant('c1', eventKey, 'map_town', 'v1', { itemId: 'mat_divine_shard', quantity: 1 }), 'bag');
    assert.equal(mailed, 0);
  }
  Date.now = realNow;
  console.log('smashing-spree-review-fixes passed');
})().catch((e) => { Date.now = realNow; console.error(e); process.exitCode = 1; });
