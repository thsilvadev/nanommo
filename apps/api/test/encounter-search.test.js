const assert = require('assert');
const { calculateEncounterSearchDelayMs } = require('../dist/apps/api/src/modules/battle/battle.service');

assert.strictEqual(calculateEncounterSearchDelayMs(0), 2000);
assert.strictEqual(calculateEncounterSearchDelayMs(1), 2100);
assert.strictEqual(calculateEncounterSearchDelayMs(3), 2300);
assert.strictEqual(calculateEncounterSearchDelayMs(-10), 2000);
assert.strictEqual(calculateEncounterSearchDelayMs(3.9), 2300);

console.log('Encounter search timing: 5 assertions passed');
