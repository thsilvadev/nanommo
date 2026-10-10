const assert = require('node:assert/strict');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service.js');

function makeHarness({ remainingMs, queuedEndOffsetMs, queuedStartOffsetMs }) {
  const now = Date.now();
  const character = {
    id: 'char-food-regression',
    currentMapId: 'map_green_grounds',
    status: 'grinding',
    pendingMapTransition: null,
    hpCurrent: 100,
    spCurrent: 20,
    lastSeenAt: new Date(now - 10_000),
    activeFoodBuff: {
      itemId: 'food_bread',
      hpRegenPerTenTicks: 4,
      spRegenPerTenTicks: 1,
      expiresAt: new Date(now + remainingMs).toISOString(),
    },
    diet: [],
    dietLevels: {},
  };
  const queued = [{
    id: 'future-battle',
    characterId: character.id,
    sequenceIndex: 0,
    mapId: character.currentMapId,
    startAt: new Date(now + queuedStartOffsetMs),
    endAt: new Date(now + queuedEndOffsetMs),
    resolved: false,
    hpAfter: 100,
    spAfter: 20,
    itemsConsumed: [],
    log: { events: [] },
  }];
  const presenceCalls = [];
  const saved = [];
  const published = [];
  const discarded = [];
  const service = Object.create(BattleService.prototype);
  service.QUEUE_DEPTH_TARGET = 5;
  service.characterRepo = {
    findOne: async () => character,
    save: async row => { saved.push({ status: row.status, mapId: row.currentMapId }); return row; },
  };
  service.battleQueueRepo = { find: async () => queued, save: async row => row };
  service.mapPresenceService = { syncCharacter: async (...args) => { presenceCalls.push(args); } };
  service.getBattleQueue = async () => queued;
  service.buildInventoryMap = async () => ({});
  service.discardUnresolvedBattles = async id => { discarded.push(id); };
  service.safePublishQueueUpdated = async (...args) => { published.push(args); };
  service.dataService = { getItemById: () => null };
  service.logger = { log() {}, warn() {}, debug() {}, error() {} };
  return { service, character, queued, presenceCalls, saved, published, discarded, now };
}

async function testPositiveFoodMustNotRouteTown(remainingMs) {
  const h = makeHarness({ remainingMs, queuedStartOffsetMs: Math.max(1, Math.floor(remainingMs / 2)), queuedEndOffsetMs: 180_000 });
  const expiryAt = Date.parse(h.character.activeFoodBuff.expiresAt);
  assert.ok(expiryAt > h.now, 'test precondition: authoritative food is still valid now');
  assert.ok(h.queued[0].startAt.getTime() < expiryAt, 'test precondition: queued battle starts while food is valid');
  assert.ok(h.queued[0].endAt.getTime() > expiryAt, 'test precondition: projected future battle crosses food expiry');
  assert.ok(!(h.queued[0].startAt.getTime() <= h.now && h.now < h.queued[0].endAt.getTime()), 'test precondition: no battle is active now');

  const result = await h.service.queueBattles(h.character.id, 5, true);

  assert.equal(h.character.status, 'grinding', 'positive-duration food must keep the character grinding');
  assert.equal(h.character.currentMapId, 'map_green_grounds', 'projection must not mutate actual map');
  assert.equal(h.presenceCalls.length, 0, 'no map-presence transition while current food is valid');
  assert.equal(h.saved.length, 0, 'no Town state should be persisted');
  assert.deepEqual(h.discarded, [], 'do not discard a queued battle merely because its end crosses expiry');
  assert.equal(result.length, 1, 'preserve the already queued future battle');
  assert.equal(h.published.length, 0, 'no false empty-queue Town snapshot');
}

async function testActiveBattleIsPreservedWhenFoodExpiresDuringIt() {
  const h = makeHarness({ remainingMs: 60_000, queuedStartOffsetMs: -1_000, queuedEndOffsetMs: 180_000 });
  const result = await h.service.queueBattles(h.character.id, 5, true);
  assert.equal(h.character.status, 'grinding');
  assert.equal(h.character.currentMapId, 'map_green_grounds');
  assert.deepEqual(result, h.queued, 'do not cancel or rewrite the battle already in progress');
  assert.equal(h.saved.length, 0);
  assert.equal(h.discarded.length, 0);
  assert.equal(h.presenceCalls.length, 0);
}

async function testNoBattleStartsAfterExpiryDuringSearchGap() {
  const h = makeHarness({ remainingMs: 1_000, queuedStartOffsetMs: 1, queuedEndOffsetMs: 180_000 });
  const emptyQueue = [];
  const scheduled = [];
  h.service.getBattleQueue = async () => emptyQueue;
  h.service.buildInventoryMap = async () => ({});
  h.service.mapPresenceService.countActiveGrinders = async () => 1;
  h.service.loadCombatantLoadout = async () => ({ weaponTypes: [] });
  h.service.getWeaponBaseAttackTicks = () => 6;
  h.service.getOrCreateKillCounter = async () => ({ epoch: 0, mapKillCount: 0, perMonsterKillCount: {} });
  h.service.dataService = {
    getMonstersInMap: () => [{ id: 'mon_slime' }],
    getMonsterSkills: () => [],
    getItems: () => ({ consumables: [] }),
    getItemById: () => null,
  };
  h.service.bullQueue = { add: async (...args) => { scheduled.push(args); } };

  const result = await h.service.queueBattles(h.character.id, 1, true);
  assert.deepEqual(result, [], 'do not queue a battle whose start is after food expiry');
  assert.equal(h.character.status, 'grinding', 'positive-duration food does not trigger an early Town exit');
  assert.equal(h.character.currentMapId, 'map_green_grounds');
  assert.equal(h.presenceCalls.length, 0);
  assert.equal(scheduled.length, 1, 'schedule an authoritative server recheck at food expiry');
  assert.equal(scheduled[0][0], 'queue-battles');
  assert.equal(scheduled[0][2].jobId, `food-expiry-check-${h.character.id}-${Date.parse(h.character.activeFoodBuff.expiresAt)}`);
  assert.ok(scheduled[0][2].delay >= 0 && scheduled[0][2].delay <= 1_000);
}

async function testAutoFeedGetsBoundaryOpportunityBeforeTown() {
  const h = makeHarness({ remainingMs: -1, queuedStartOffsetMs: 30_000, queuedEndOffsetMs: 180_000 });
  h.character.autoFeed = true;
  let autoFeedAttempts = 0;
  let queueReads = 0;
  const rebuiltEntry = { id: 'rebuilt-after-food', sequenceIndex: 0 };
  h.service.getBattleQueue = async () => (++queueReads === 1 ? [] : [rebuiltEntry]);
  h.service.tryAutoFeed = async character => {
    autoFeedAttempts += 1;
    character.activeFoodBuff = {
      itemId: 'food_bread',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    return true;
  };

  const result = await h.service.queueBattles(h.character.id, 1, true);
  assert.equal(autoFeedAttempts, 1, 'Auto Feed must be tried at actual exhaustion before Town fallback');
  assert.equal(h.character.status, 'grinding');
  assert.equal(h.character.currentMapId, 'map_green_grounds');
  assert.equal(h.presenceCalls.length, 0, 'successful Auto Feed must not publish a Town transition');
  assert.equal(h.saved.length, 1, 'persist the newly consumed food state');
  assert.deepEqual(h.discarded, ['char-food-regression'], 'discard stale queue projections before rebuilding');
  assert.deepEqual(result, [rebuiltEntry], 'return the rebuilt queue after Auto Feed');
}

async function testAutoFeedWithoutEligibleFoodRoutesTown() {
  const h = makeHarness({ remainingMs: -1, queuedStartOffsetMs: 30_000, queuedEndOffsetMs: 180_000 });
  h.character.autoFeed = true;
  const result = await h.service.queueBattles(h.character.id, 5, true);
  assert.deepEqual(result, []);
  assert.equal(h.character.status, 'town', 'enabled Auto Feed without eligible Diet food must fall back to Town');
  assert.equal(h.character.currentMapId, 'map_town');
  assert.equal(h.presenceCalls.length, 1);
  assert.equal(h.saved.length, 1);
}

async function testActuallyExpiredFoodStillRoutesTown() {
  const h = makeHarness({ remainingMs: -1, queuedStartOffsetMs: 30_000, queuedEndOffsetMs: 180_000 });
  const result = await h.service.queueBattles(h.character.id, 5, true);
  assert.deepEqual(result, [], 'expired food with no active battle must not retain future encounters');
  assert.equal(h.character.status, 'town');
  assert.equal(h.character.currentMapId, 'map_town');
  assert.equal(h.presenceCalls.length, 1, 'real exhaustion synchronizes map presence once');
  assert.equal(h.saved.length, 1, 'real exhaustion persists Town exactly once');
  assert.deepEqual(h.discarded, ['char-food-regression']);
  assert.equal(h.published.length, 1, 'real exhaustion publishes an empty queue');
}

(async () => {
  for (const remainingMs of [120_000, 60_000, 5_000, 1_000]) {
    await testPositiveFoodMustNotRouteTown(remainingMs);
    console.log(`[PASS] positive food duration ${remainingMs}ms never causes projected early Town transition`);
  }
  await testActiveBattleIsPreservedWhenFoodExpiresDuringIt();
  console.log('[PASS] active battle is preserved when food expires during it');
  await testNoBattleStartsAfterExpiryDuringSearchGap();
  console.log('[PASS] no battle starts after expiry when the encounter-search gap crosses the boundary');
  await testAutoFeedGetsBoundaryOpportunityBeforeTown();
  console.log('[PASS] Auto Feed gets the actual exhaustion boundary before Town fallback');
  await testAutoFeedWithoutEligibleFoodRoutesTown();
  console.log('[PASS] enabled Auto Feed without eligible food falls back to Town');
  await testActuallyExpiredFoodStillRoutesTown();
  console.log('[PASS] actually expired food still routes Town when no battle is active');
  console.log('Grind food-expiry early-exit regression tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
