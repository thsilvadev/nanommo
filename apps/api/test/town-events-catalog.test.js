const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../..');
const { validateSmashingSpreeConfig } = require('../dist/apps/api/src/modules/town-event/smashing-spree.types');

const catalog = require(path.join(root, 'town_events.json'));
const cfg = catalog.smashingSpree;
const itemsJson = require(path.join(root, 'items.json'));
const itemIds = new Set(Object.values(itemsJson).filter(Array.isArray).flat().map(item => item.id));

assert.equal(cfg.prizes.reduce((sum, rule) => sum + rule.count, 0), 20);
for (const rule of cfg.prizes) for (const id of rule.oneOf ?? [rule.itemId]) assert.ok(itemIds.has(id), `unknown item ${id}`);
assert.deepEqual(validateSmashingSpreeConfig(cfg, itemIds), []);

const bad = (patch) => validateSmashingSpreeConfig({ ...cfg, ...patch }, itemIds);
assert.ok(bad({ prizes: [{ count: 1, itemId: 'nope', quantity: 1 }] }).length > 0, 'unknown item');
assert.ok(bad({ vasesPerTown: 10 }).length > 0, 'prize count above vases');
assert.ok(bad({ prizes: [{ count: 1, itemId: 'mega_elixir', oneOf: ['tonic_capo'], quantity: 1 }] }).length > 0, 'itemId and oneOf');
assert.ok(bad({ startTimes: ['9:30'] }).length > 0, 'HH:MM');
assert.ok(bad({ announceMinutesBefore: [30, 0] }).length > 0, 'zero minutes');
assert.ok(validateSmashingSpreeConfig(null, itemIds).length > 0, 'missing config');
assert.ok(!fs.existsSync(path.join(root, 'apps/frontend/public/data/town_events.json')), 'must not be mirrored');
console.log('town-events-catalog passed');
