const assert = require('node:assert/strict');
const {
  findCardinalRoute, isInstantTownExitEdge, calculateWorldMoveSpeed,
  calculateTravelDurationSeconds, calculateFleeChancePercent,
  deterministicIntInclusive, calculateGatheringBaseDurationSeconds,
  calculateGatheringDurationSeconds, accrueTravelSegmentProgress,
} = require('../../../packages/shared/dist/world-activity.js');
const maps = require('../../../maps.json').maps;
const monsters = require('../../../monsters.json').monsters;
const { BattleEngine } = require('../../../packages/shared/dist/battle-engine/index.js');
const route = findCardinalRoute(maps, 'map_town', 'map_green_grounds_1');
assert.equal(route[0].id, 'map_town');
assert.equal(route.at(-1).id, 'map_green_grounds_1');
assert.ok(route.every((m, i) => i === 0 || Math.abs(m.coordinates.x-route[i-1].coordinates.x)+Math.abs(m.coordinates.y-route[i-1].coordinates.y)===1));
for (const map of maps) assert.ok(findCardinalRoute(maps, 'map_town', map.id).length, `route from Town to ${map.id}`);
assert.deepEqual(findCardinalRoute(maps, 'map_town', 'map_green_grounds_1').map(m=>m.id), findCardinalRoute(maps, 'map_town', 'map_green_grounds_1').map(m=>m.id), 'BFS ties deterministic');
assert.ok(isInstantTownExitEdge(maps.find(m=>m.id==='map_town'), maps.find(m=>m.id==='map_green_grounds_0')), 'Town → adjacent Grind is instant');
assert.equal(isInstantTownExitEdge(maps.find(m=>m.id==='map_green_grounds_0'), maps.find(m=>m.id==='map_town')), false, 'Grind → adjacent Town is timed');
assert.equal(isInstantTownExitEdge(maps.find(m=>m.id==='map_town'), maps.find(m=>m.id==='map_outpost')), false, 'non-adjacent Town edge is not instant');
assert.equal(calculateTravelDurationSeconds(100, Number(maps.find(m=>m.id==='map_green_grounds_0').mapLength)), 20, 'returning to Town uses source Grind mapLength');
assert.equal(calculateTravelDurationSeconds(51,25),30);
assert.equal(calculateTravelDurationSeconds(100,25),20);
assert.equal(calculateTravelDurationSeconds(250,25),5);
assert.equal(calculateTravelDurationSeconds(0,25),Infinity);
assert.equal(calculateTravelDurationSeconds(100,50),40);
const travelCatchup = accrueTravelSegmentProgress(0.25, 1_000, 91_000, 30);
assert.equal(travelCatchup.completed, true);
assert.equal(travelCatchup.completedAt, 23_500);
assert.equal(travelCatchup.remainingSeconds, 67.5);
const followingLeg = accrueTravelSegmentProgress(0, travelCatchup.completedAt, 91_000, 30);
assert.equal(followingLeg.completedAt, 53_500, 'offline elapsed time carries into the following route segment');
assert.equal(followingLeg.remainingSeconds, 37.5);
assert.equal(accrueTravelSegmentProgress(0.25, 1_000, 6_000, Infinity).progress, 0.25, 'zero speed pauses accrued progress');
const partialTravelCatchup = accrueTravelSegmentProgress(0.25, 1_000, 4_000, 30);
assert.equal(partialTravelCatchup.completed, false);
assert.equal(partialTravelCatchup.progress, 0.35);
assert.equal(calculateWorldMoveSpeed({level:1}),51);
assert.equal(calculateWorldMoveSpeed({level:1},[{fixedStats:{moveSpd:30,moveSpdMultiplier:1.2}}]),97);
assert.equal(calculateWorldMoveSpeed({level:1},[],[{moveSpdFlat:30,expiresAt:10_000}],[],9_999),81);
assert.equal(calculateWorldMoveSpeed({level:1},[],[{moveSpdFlat:30,expiresAt:10_000}],[],10_000),51,'expired movement buff no longer affects world speed');
assert.equal(calculateFleeChancePercent(50,100,1),1);
assert.equal(calculateFleeChancePercent(100,100,5),50);
assert.equal(calculateFleeChancePercent(150,100,99),99);
assert.ok(calculateFleeChancePercent(100,100,20)>50);
assert.ok(calculateFleeChancePercent(100,100,1)<50);
assert.equal(calculateFleeChancePercent(0,1,99),1);
assert.equal(calculateFleeChancePercent(1000,1,1),99);
assert.equal(deterministicIntInclusive('cycle-a',2,6),deterministicIntInclusive('cycle-a',2,6));
assert.ok(deterministicIntInclusive('cycle-a',2,6)>=2 && deterministicIntInclusive('cycle-a',2,6)<=6);
assert.equal(calculateGatheringBaseDurationSeconds(25,1,1),300);
assert.equal(calculateGatheringBaseDurationSeconds(50,1,1),600);
assert.equal(calculateGatheringBaseDurationSeconds(25,2,1),330);
assert.ok(calculateGatheringDurationSeconds(25,1,1,'g1')>=300 && calculateGatheringDurationSeconds(25,1,1,'g1')<=305);
for (const map of maps) assert.equal(map.mapLength, map.type==='town'?0:25, `${map.id} mapLength`);
const peaceful = monsters.filter(monster=>!monster.isAggressive).map(monster=>monster.id).sort();
assert.deepEqual(peaceful,['mon_moonleafarcanist','mon_saltfangcrab','mon_slime','mon_thornsprout']);
assert.ok(monsters.every(monster=>Number.isFinite(monster.moveSpd)&&monster.moveSpd>=0));
const items = require('../../../items.json');
assert.equal(items.materials.length,10);
assert.equal(items.consumables.find(item=>item.id==='food_blueberry').name,'Blueberry Jelly');
assert.equal(items.consumables.find(item=>item.id==='food_honey').name,'Honey');
assert.equal(maps.filter(map=>map.type==='grind' && Array.isArray(map.gatheringPool)).length,36);
assert.ok(maps.filter(map=>map.type==='grind').every(map=>Array.isArray(map.gatheringPool) && map.gatheringPool.length>0), 'every Grind map can yield Gathering materials');
assert.ok(maps.filter(map=>map.type==='town').every(map=>map.gatheringPool===undefined), 'Town maps never gather materials');
assert.deepEqual(new Set(maps.flatMap(map=>(map.gatheringPool??[]).map(entry=>entry.itemId))), new Set(items.materials.map(item=>item.id).filter(id=>id!=='mat_meat')), 'every gatherable material is distributed across the world and Meat remains excluded');
for (const map of maps.filter(map=>map.gatheringPool)) {
  assert.equal(map.gatheringPool.reduce((sum,entry)=>sum+entry.weight,0),100,map.id);
  assert.ok(map.gatheringPool.every(entry=>items.materials.some(item=>item.id===entry.itemId&&item.type==='material')));
  assert.ok(!map.gatheringPool.some(entry=>entry.itemId==='mat_meat'));
}
assert.deepEqual(monsters.filter(monster=>monster.drops.some(drop=>drop.itemId==='mat_meat'&&drop.chance===0.2)).map(monster=>monster.id).sort(),['mon_direwolf','mon_needlebackstalker']);
console.log('world-travel-gathering-flee contract tests passed');

// Checkpoint replay must stop after the requested full tick, return the complete
// partial state and remain deterministic without changing the normal simulation result.
const monsterBase = monsters.find(monster => monster.id === 'mon_slime');
const durableMonster = { ...monsterBase, hp: 100000, atk: 1, matk: 1, def: 0, evasion: 0, accuracy: 1, drops: [] };
const combatant = {
  level: 10, hp: 100000, sp: 60, maxHp: 100000, maxSp: 60, atk: 1, matk: 1, def: 100,
  mdefPercent: 0, accuracy: 100, evasion: 0, critChance: 0, hpRegenPerTenTicks: 0,
  spRegenPerTenTicks: 0, agi: 5, dex: 5, luk: 5, statusEffects: [], skills: {}, skillDefs: {},
  foodBuffs: [], foodDigestRemainingTicksByItem: {}, equippedWeaponTypes: [], attackSpeed: 0,
};
const gambit = { lines: [{ priority: 1, enabled: true, conditions: [{ id: 'always' }], action: { id: 'attack' } }] };
const checkpointOptions = { inventory: { potion: 2 }, itemDefinitions: {}, stopAfterTick: 1 };
const checkpointRunA = BattleEngine.simulateBattle(combatant, durableMonster, gambit, 'flee-checkpoint-seed', checkpointOptions);
const checkpointRunB = BattleEngine.simulateBattle(combatant, durableMonster, gambit, 'flee-checkpoint-seed', checkpointOptions);
const normalRun = BattleEngine.simulateBattle(combatant, durableMonster, gambit, 'flee-checkpoint-seed', { inventory: { potion: 2 }, itemDefinitions: {} });
assert.ok(checkpointRunA.checkpoint, 'partial simulator yields complete checkpoint');
assert.equal(checkpointRunA.checkpoint.tick, 1, 'checkpoint covers the full requested zero-based tick');
assert.equal(checkpointRunA.checkpoint.battleEnded, false, 'fixture remains alive at both sides at checkpoint');
assert.deepEqual(checkpointRunA.checkpoint, checkpointRunB.checkpoint, 'checkpoint replay is deterministic');
assert.deepEqual(checkpointRunA.log.events, normalRun.log.events.filter(event => Number(event.tick) <= 1), 'partial replay shares the original seeded event prefix');
assert.equal(normalRun.log.outcome, normalRun.outcome, 'ordinary battle outcome remains normal');

// Exercise a real partial checkpoint across item consumption, food digestion,
// timed-effect expiry, and a status with time remaining.
const statefulCombatant = {
  ...combatant,
  hp: 100, maxHp: 1000,
  statusEffects: [
    { type: 'expires_early', appliedAtTick: 0, expiresAtTick: 3, moveSpeedPenalty: 0 },
    { type: 'expires_later', appliedAtTick: 0, expiresAtTick: 50, moveSpeedPenalty: 0 },
  ],
  foodBuffs: [{ itemId: 'food_existing', hpRegenPerTenTicks: 2, spRegenPerTenTicks: 3, remainingTicks: 20 }],
  foodDigestRemainingTicksByItem: { food_existing: 25 },
};
const checkpointItems = {
  food_checkpoint: { id: 'food_checkpoint', type: 'consumable', effect: { type: 'food_buff', durationSeconds: 120, hpRegenPerTenTicks: 2, spRegenPerTenTicks: 1 }, cooldownInSeconds: 0 },
  pot_checkpoint: { id: 'pot_checkpoint', type: 'consumable', effect: { type: 'heal_hp', amount: 30 }, cooldownInSeconds: 0, maxStack: 20 },
};
const statefulGambit = { lines: [
  { priority: 1, enabled: true, conditions: [{ id: 'always' }], action: { id: 'use_item', params: { itemId: 'food_checkpoint' } } },
  { priority: 2, enabled: true, conditions: [{ id: 'always' }], action: { id: 'use_item', params: { itemId: 'pot_checkpoint' } } },
  { priority: 3, enabled: true, conditions: [{ id: 'always' }], action: { id: 'attack' } },
] };
const statefulCheckpoint = BattleEngine.simulateBattle(statefulCombatant, durableMonster, statefulGambit, 'flee-stateful-checkpoint', {
  inventory: { food_checkpoint: 1, pot_checkpoint: 1 }, itemDefinitions: checkpointItems,
  statusEffectDefs: { expires_early: { statusDurationTicks: 3 }, expires_later: { statusDurationTicks: 50 } },
  stopAfterTick: 19,
}).checkpoint;
assert.equal(statefulCheckpoint.tick, 19);
assert.equal(statefulCheckpoint.battleEnded, false);
assert.equal(statefulCheckpoint.inventoryAfter.food_checkpoint, 0, 'food consumption is in checkpoint inventory');
assert.equal(statefulCheckpoint.inventoryAfter.pot_checkpoint, 0, 'potion consumption is in checkpoint inventory');
assert.ok(!statefulCheckpoint.statusEffects.some(status => status.type === 'expires_early'), 'expired status absent at checkpoint');
assert.ok(statefulCheckpoint.statusEffects.some(status => status.type === 'expires_later'), 'nonexpired status retained');
assert.ok(statefulCheckpoint.foodBuffs.some(food => food.itemId === 'food_checkpoint' && food.remainingTicks > 0 && food.remainingTicks < 120), 'new food buff retains remaining duration');
assert.ok(statefulCheckpoint.foodDigestRemainingTicksByItem.food_checkpoint > 0 && statefulCheckpoint.foodDigestRemainingTicksByItem.food_checkpoint < 120, 'food digestion retains remaining duration');
const lethalMonster = { ...durableMonster, hp: 100000, atk: 1000000, accuracy: 100, atkSpeedTicks: 1 };
const nearDeath = { ...combatant, hp: 1, maxHp: 100, def: 0, evasion: 0, statusEffects: [] };
const lethalCheckpoint = BattleEngine.simulateBattle(nearDeath, lethalMonster, gambit, 'flee-lethal-checkpoint', {
  inventory: {}, itemDefinitions: {}, stopAfterTick: 10,
}).checkpoint;
assert.ok(lethalCheckpoint.hp <= 0 || lethalCheckpoint.monsterHp <= 0 || lethalCheckpoint.battleEnded, 'checkpoint replay recognizes a lethal battle boundary');
console.log('world-travel-gathering-flee checkpoint replay tests passed');
