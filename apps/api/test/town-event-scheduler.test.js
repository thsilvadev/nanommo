const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../..');
const src = (p) => fs.readFileSync(path.join(root, 'apps/api/src', p), 'utf8');
const { TownEventProcessor, TownEventScheduler, SMASHING_SPREE_TICK } = require('../dist/apps/api/src/modules/town-event/town-event.processor');
const cfg = require(path.join(root, 'town_events.json')).smashingSpree;

const moduleSrc = src('modules/town-event/town-event.module.ts');
assert.match(moduleSrc, /BullModule\.registerQueue\(\{\s*name:\s*'town-event'\s*\}\)/);
assert.match(src('app.module.ts'), /TownEventModule/);
const processorSrc = src('modules/town-event/town-event.processor.ts');
assert.match(processorSrc, /@Processor\('town-event'\)/);
assert.match(processorSrc, /@Process\(SMASHING_SPREE_TICK\)/);
assert.equal(SMASHING_SPREE_TICK, 'smashing-spree-tick');

(async () => {
  const realNow = Date.now;
  // Scheduler registers one repeatable per-minute job in the configured timezone, removing stale ones.
  {
    const added = []; const removed = [];
    const queue = {
      getRepeatableJobs: async () => [
        { name: 'smashing-spree-tick', key: 'old', cron: '*/5 * * * *', tz: 'UTC' },
        { name: 'smashing-spree-tick', key: 'same', cron: '* * * * *', tz: 'America/Sao_Paulo' },
        { name: 'other', key: 'x', cron: '* * * * *', tz: 'UTC' },
      ],
      removeRepeatableByKey: async (key) => removed.push(key),
      add: async (...args) => added.push(args),
    };
    const scheduler = new TownEventScheduler(queue, { getSmashingSpreeConfig: () => cfg });
    await scheduler.onModuleInit();
    assert.deepEqual(removed, ['old']);
    assert.equal(added.length, 1);
    const [name, data, opts] = added[0];
    assert.equal(name, 'smashing-spree-tick'); assert.deepEqual(data, {});
    assert.deepEqual(opts.repeat, { cron: '* * * * *', tz: 'America/Sao_Paulo' });
    assert.equal(opts.jobId, 'smashing-spree-tick');
    assert.equal(opts.removeOnComplete, true);
  }
  // Tick → phase.
  {
    const phases = [];
    const processor = new TownEventProcessor({ runPhase: async (p) => phases.push(p) }, { getSmashingSpreeConfig: () => cfg });
    Date.now = () => Date.parse('2026-11-24T09:25:03-03:00');
    await processor.handleTick({});
    assert.equal(phases.length, 1); assert.equal(phases[0].kind, 'announce'); assert.equal(phases[0].minutes, 5);
    Date.now = () => Date.parse('2026-11-24T09:26:00-03:00');
    await processor.handleTick({});
    assert.equal(phases.length, 1);
    Date.now = () => Date.parse('2026-11-24T09:30:01-03:00');
    await processor.handleTick({}); await processor.handleTick({});
    assert.equal(phases.length, 3); assert.equal(phases[2].kind, 'start');
    const failing = new TownEventProcessor({ runPhase: async () => { throw new Error('redis down'); } }, { getSmashingSpreeConfig: () => cfg });
    failing.logger = { error: () => undefined };
    await assert.rejects(() => failing.handleTick({}), /redis down/);
  }
  // Dev-only manual phases (maintenance/smashing-spree-start-now).
  {
    const { SMASHING_SPREE_RUN_PHASE } = require('../dist/apps/api/src/modules/town-event/town-event.processor');
    const { devStartPhases } = require('../dist/apps/api/src/maintenance/smashing-spree-start-now');
    assert.equal(SMASHING_SPREE_RUN_PHASE, 'smashing-spree-run-phase');
    assert.match(processorSrc, /@Process\(SMASHING_SPREE_RUN_PHASE\)/);
    Date.now = realNow;
    const [start, end] = devStartPhases(Date.parse('2026-11-24T10:07:12Z'), 120);
    assert.equal(start.kind, 'start'); assert.equal(end.kind, 'end'); assert.equal(start.eventKey, end.eventKey);
    assert.match(start.eventKey, /^ss-dev-/);
    assert.equal(start.endsAt, Date.parse('2026-11-24T10:07:12Z') + 120000);
    const phases = [];
    const processor = new TownEventProcessor({ runPhase: async (p) => phases.push(p) }, { getSmashingSpreeConfig: () => cfg });
    const env = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await processor.handleRunPhase({ data: { phase: start } });
      assert.equal(phases.length, 0, 'refused in production');
      process.env.NODE_ENV = 'development';
      await processor.handleRunPhase({ data: { phase: start } });
      assert.deepEqual(phases, [start]);
    } finally { process.env.NODE_ENV = env; }
  }
  Date.now = realNow;
  console.log('town-event-scheduler passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
