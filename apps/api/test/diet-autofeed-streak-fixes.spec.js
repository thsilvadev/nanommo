const assert = require('node:assert/strict');

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
    getItemCount: async (_id, itemId) => ['meat', 'carrot', 'fish'].includes(itemId) ? 2 : 0,
    consumeFood: async (id, itemId) => {
      consumed.push(itemId);
      const future = new Date(Date.now() + 3600000).toISOString();
      const currentDiet = id === 'char-1' ? character.diet : boundaryCharacter.diet;
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

  console.log('Diet/Auto Feed boundary regressions: 13 assertions passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
