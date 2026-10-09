const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');

const { buildDietStateAfterFoodConsumption } =
  require('../dist/apps/api/src/modules/inventory/inventory.service.js');
const {
  BattleService,
  calculateEncounterSearchDelayMs,
  calculateNextEncounterBoundaryAt,
} = require('../dist/apps/api/src/modules/battle/battle.service.js');

const at = (n) => new Date(1_000_000 + n * 10_000).toISOString();

async function run() {
  let r = buildDietStateAfterFoodConsumption([], 'bread', at(0), at(360));
  assert.equal(r.nextLevel, 0);

  let diet = r.diet;
  r = buildDietStateAfterFoodConsumption(diet, 'bread', at(360), at(720));
  assert.equal(r.nextLevel, 1);
  diet = r.diet;
  r = buildDietStateAfterFoodConsumption(diet, 'bread', at(720), at(1080));
  assert.equal(r.nextLevel, 2);
  diet = r.diet;
  r = buildDietStateAfterFoodConsumption(diet, 'bread', at(1080), at(1440));
  assert.equal(r.nextLevel, 3);

  diet = [
    { itemId: 'bread', consumedAt: at(0), digestUntil: at(1), dietLevel: 2 },
    { itemId: 'meat', consumedAt: at(0), digestUntil: at(1), dietLevel: 1 },
    { itemId: 'carrot', consumedAt: at(0), digestUntil: at(1), dietLevel: 1 },
  ];
  r = buildDietStateAfterFoodConsumption(diet, 'fish', at(10), at(370));
  assert.deepEqual(r.diet.map((x) => x.itemId), ['meat', 'carrot', 'fish']);
  assert.equal(r.dietLevels.bread, undefined);

  r = buildDietStateAfterFoodConsumption(r.diet, 'bread', at(370), at(730));
  assert.equal(r.nextLevel, 0);

  diet = [
    { itemId: 'bread', consumedAt: at(0), digestUntil: at(1), dietLevel: 2 },
    { itemId: 'meat', consumedAt: at(0), digestUntil: at(1), dietLevel: 1 },
  ];
  r = buildDietStateAfterFoodConsumption(diet, 'carrot', at(10), at(370));
  assert.equal(r.diet.find((x) => x.itemId === 'bread').dietLevel, 2);
  assert.equal(r.dietLevels.bread.level, 2);

  const food = (id) => ({
    id, type: 'food',
    effect: { type: 'food_buff', durationSeconds: 3600, hpRegenPerTenTicks: 4, spRegenPerTenTicks: 1 },
  });
  const service = Object.create(BattleService.prototype);
  service.dataService = { getItemById: (id) => food(id) };

  const boundaryBase = 5_000_000;
  assert.equal(calculateEncounterSearchDelayMs(0), 2000);
  assert.equal(calculateEncounterSearchDelayMs(7), 2700);
  assert.equal(
    calculateNextEncounterBoundaryAt(boundaryBase, 7),
    boundaryBase + 2700,
  );

  const consumed = [];
  service.inventoryService = {
    getItemCount: async (_id, itemId) => ['bread', 'meat', 'carrot', 'fish'].includes(itemId) ? 2 : 0,
    consumeFood: async (id, itemId) => {
      consumed.push(itemId);
      const future = new Date(Date.now() + 3600000).toISOString();
      const currentDiet = id === 'char-1' ? character.diet : id === 'char-2' ? boundaryCharacter.diet : duplicateCharacter.diet;
      const nextDiet = [...currentDiet.slice(-2), {
        itemId,
        consumedAt: new Date().toISOString(),
        digestUntil: future,
        dietLevel: 1,
      }];
      return {
        id,
        activeFoodBuff: { itemId, expiresAt: future },
        diet: nextDiet,
        dietLevels: Object.fromEntries(nextDiet.map((entry) => [entry.itemId, { level: entry.dietLevel, lastDigestUntil: entry.digestUntil }])),
      };
    },
  };

  const character = {
    id: 'char-1', autoFeed: true, returnToTownAfterBattle: false,
    activeFoodBuff: { itemId: 'bread', expiresAt: new Date(Date.now() - 1000).toISOString() },
    diet: [
      { itemId: 'meat', consumedAt: new Date(Date.now() - 7200000).toISOString(), digestUntil: new Date(Date.now() - 3600000).toISOString(), dietLevel: 1 },
      { itemId: 'carrot', consumedAt: new Date(Date.now() - 7200000).toISOString(), digestUntil: new Date(Date.now() - 3600000).toISOString(), dietLevel: 1 },
      { itemId: 'fish', consumedAt: new Date(Date.now() - 7200000).toISOString(), digestUntil: new Date(Date.now() - 3600000).toISOString(), dietLevel: 1 },
    ],
    dietLevels: {
      meat: { level: 1, lastDigestUntil: new Date(Date.now() - 3600000).toISOString() },
      carrot: { level: 1, lastDigestUntil: new Date(Date.now() - 3600000).toISOString() },
      fish: { level: 1, lastDigestUntil: new Date(Date.now() - 3600000).toISOString() },
    },
  };
  const boundaryCharacter = {
    ...character,
    id: 'char-2',
    activeFoodBuff: { itemId: 'bread', expiresAt: new Date(Date.now() + 1000).toISOString() },
  };

  assert.equal(await service.tryAutoFeed(character, Date.now()), true);
  assert.deepEqual(consumed, ['meat', 'carrot', 'fish']);
  assert.equal(character.activeFoodBuff.itemId, 'fish');

  consumed.length = 0;
  assert.equal(
    await service.tryAutoFeed(boundaryCharacter, Date.now() + 2000),
    true,
  );
  assert.deepEqual(consumed, ['meat', 'carrot', 'fish']);
  assert.equal(boundaryCharacter.activeFoodBuff.itemId, 'fish');

  // Repeated foods occupy multiple retained Diet slots. An expired older
  // occurrence must not make the same food eligible when its newest occurrence
  // is still digesting; Auto Feed should skip that food and try another slot.
  consumed.length = 0;
  const duplicateCharacter = {
    id: 'char-3', autoFeed: true, pendingMapTransition: null,
    activeFoodBuff: { itemId: 'bread', expiresAt: new Date(Date.now() - 1000).toISOString() },
    diet: [
      { itemId: 'bread', consumedAt: new Date(Date.now() - 7200000).toISOString(), digestUntil: new Date(Date.now() - 3600000).toISOString(), dietLevel: 1 },
      { itemId: 'bread', consumedAt: new Date(Date.now() - 1000).toISOString(), digestUntil: new Date(Date.now() + 3600000).toISOString(), dietLevel: 2 },
      { itemId: 'meat', consumedAt: new Date(Date.now() - 7200000).toISOString(), digestUntil: new Date(Date.now() - 3600000).toISOString(), dietLevel: 1 },
    ],
    dietLevels: {},
  };
  assert.equal(await service.tryAutoFeed(duplicateCharacter, Date.now()), true);
  assert.deepEqual(consumed, ['meat']);
  assert.equal(duplicateCharacter.activeFoodBuff.itemId, 'meat');

  // Even if eligibility changes between the scan and consumption, the known
  // digest guard is an expected skip and later candidates are still attempted.
  const raceAttempts = [];
  const raceService = Object.create(BattleService.prototype);
  raceService.dataService = { getItemById: (id) => food(id) };
  raceService.inventoryService = {
    getItemCount: async () => 1,
    consumeFood: async (id, itemId) => {
      raceAttempts.push(itemId);
      if (itemId === 'bread') throw new BadRequestException('Food is still digesting');
      return {
        id,
        activeFoodBuff: { itemId, expiresAt: new Date(Date.now() + 3600000).toISOString() },
        diet: [{ itemId, consumedAt: new Date().toISOString(), digestUntil: new Date(Date.now() + 3600000).toISOString(), dietLevel: 1 }],
        dietLevels: { [itemId]: { level: 1, lastDigestUntil: new Date(Date.now() + 3600000).toISOString() } },
      };
    },
  };
  const raceCharacter = {
    id: 'char-race', autoFeed: true, pendingMapTransition: null,
    activeFoodBuff: { itemId: 'old', expiresAt: new Date(Date.now() - 1000).toISOString() },
    diet: [
      { itemId: 'bread', consumedAt: new Date(Date.now() - 7200000).toISOString(), digestUntil: new Date(Date.now() - 3600000).toISOString(), dietLevel: 1 },
      { itemId: 'meat', consumedAt: new Date(Date.now() - 7200000).toISOString(), digestUntil: new Date(Date.now() - 3600000).toISOString(), dietLevel: 1 },
    ],
    dietLevels: {},
  };
  assert.equal(await raceService.tryAutoFeed(raceCharacter, Date.now()), true);
  assert.deepEqual(raceAttempts, ['bread', 'meat']);
  assert.equal(raceCharacter.activeFoodBuff.itemId, 'meat');

  console.log('Diet/Auto Feed boundary regressions: repeated-food eligibility + digestion conflict skip passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
