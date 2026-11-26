// A travel / stance change never deletes a battle that has started (2026-11-26: the running battle was
// deleted when an earlier, ended one was still unresolved; the arena played it as a ghost).
// Run: pnpm --filter @nanommo/api build && node apps/api/test/travel-keeps-started-battles.test.js
const assert = require('node:assert/strict');
const { startedBattlesOf } = require('../dist/apps/api/src/modules/map/map.service');

const now = 100_000;
const row = (id, start, end) => ({ id, startAt: new Date(start), endAt: new Date(end) });
const endedUnresolved = row('ended', now - 20_000, now - 500); // its Bull job has not run yet
const running = row('running', now - 2_000, now + 15_000);
const queued = row('queued', now + 18_000, now + 30_000);

const { started, active } = startedBattlesOf([endedUnresolved, running, queued], now);
assert.deepEqual(started.map((e) => e.id), ['ended', 'running'], 'every started battle is kept');
assert.equal(active.id, 'running', 'travel waits for (and flees) the battle that ends last');

assert.equal(startedBattlesOf([queued], now).active, undefined);
assert.deepEqual(startedBattlesOf([queued], now).started, []);
console.log('travel-keeps-started-battles: started battles kept, the last-ending one is active');
