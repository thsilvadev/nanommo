const assert = require('node:assert/strict');
const { calculateEncounterSearchDelayMs, calculateNextEncounterBoundaryAt } = require('../dist/apps/api/src/modules/battle/battle.service');
const delay = calculateEncounterSearchDelayMs(1, 'single-player-cycle');
assert.ok(delay >= 3000 && delay <= 7000, 'single player: randInt(2,6) + population seconds');
assert.equal(delay, calculateEncounterSearchDelayMs(1, 'single-player-cycle'), 'seeded interval repeats deterministically');
assert.equal(calculateEncounterSearchDelayMs(4, 'same-cycle') - calculateEncounterSearchDelayMs(1, 'same-cycle'), 3000, 'population is included linearly');
assert.equal(calculateNextEncounterBoundaryAt(5_000_000, 7, 'boundary-cycle'), 5_000_000 + calculateEncounterSearchDelayMs(7, 'boundary-cycle'));
for (let population = 1; population <= 12; population++) {
  const seconds = calculateEncounterSearchDelayMs(population, `cycle-${population}`) / 1000 - population;
  assert.ok(seconds >= 2 && seconds <= 6 && Number.isInteger(seconds), `population ${population}: inclusive 2–6 seconds`);
}
console.log('Encounter search timing: 16 assertions passed');
