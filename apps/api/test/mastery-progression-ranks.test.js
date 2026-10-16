const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { masteryLevelForXp, MASTERY_LEVEL_XP_THRESHOLDS, masteryProgressForXp, availableMasterySkillPoints, resolveRankScaledSkill } = require('../../../packages/shared/dist');
const root = path.resolve(__dirname, '../../..');
const curve = require(path.join(root, 'char_xp_curve.json'));
const monsters = require(path.join(root, 'monsters.json')).monsters;
const trees = require(path.join(root, 'skill_trees.json')).trees;

assert.equal(masteryLevelForXp(0), 0);
assert.equal(masteryLevelForXp(4), 0);
assert.equal(masteryLevelForXp(5), 1);
assert.equal(masteryLevelForXp(99), 4);
assert.equal(masteryLevelForXp(100), 5);
assert.equal(masteryLevelForXp(499), 5);
assert.equal(masteryLevelForXp(500), 6);
assert.equal(masteryLevelForXp(19_999), 6);
assert.equal(masteryLevelForXp(20_000), 7);
assert.equal(masteryLevelForXp(20_120), 7);
assert.deepEqual(masteryProgressForXp(19_999), { totalXp:19_999, level:6, xpIntoLevel:19_499, xpToNextLevel:19_500, nextLevelAtXp:20_000 });
assert.deepEqual(masteryProgressForXp(20_120), { totalXp:20_120, level:7, xpIntoLevel:120, xpToNextLevel:15_000, nextLevelAtXp:35_000 });
assert.deepEqual(masteryProgressForXp(34_999), { totalXp:34_999, level:7, xpIntoLevel:14_999, xpToNextLevel:15_000, nextLevelAtXp:35_000 });
assert.deepEqual(masteryProgressForXp(35_000), { totalXp:35_000, level:8, xpIntoLevel:0, xpToNextLevel:10_000, nextLevelAtXp:45_000 });
assert.deepEqual(masteryProgressForXp(60_000), { totalXp:60_000, level:10, xpIntoLevel:0, xpToNextLevel:0, nextLevelAtXp:null });
assert.equal(availableMasterySkillPoints(7, 6), 1);
assert.equal(availableMasterySkillPoints(7, 9), 0);
assert.equal(availableMasterySkillPoints(99, 6), 4);
assert.equal(masteryLevelForXp(34_999), 7);
assert.equal(masteryLevelForXp(34_999), 7);
assert.equal(masteryLevelForXp(35_000), 8);
assert.equal(masteryLevelForXp(44_999), 8);
assert.equal(masteryLevelForXp(45_000), 9);
assert.equal(masteryLevelForXp(59_999), 9);
assert.equal(masteryLevelForXp(60_000), 10);
assert.equal(masteryLevelForXp(1e9), 10);
assert.equal(MASTERY_LEVEL_XP_THRESHOLDS.length, 11);

const resolved = (id, rank) => {
  const skill = Object.values(trees).flat().find((entry) => entry.id === id);
  assert.ok(skill, `skill ${id} exists`);
  return resolveRankScaledSkill(skill, rank);
};
assert.deepEqual([1,2,3,4,5].map((rank) => resolved('heavy_swing', rank).spCost), [30,35,40,45,50]);
for (const [id, perRank] of [['fire_ball',10],['fire_blast',100],['wisp_flow',5],['light_of_heaven',20],['magic_barrier',50]]) {
  assert.deepEqual([1,2,3,4,5].map((rank) => resolved(id,rank).spCost), [1,2,3,4,5].map((rank) => perRank*rank));
}
assert.deepEqual([1,2,3,4,5].map((rank) => resolved('light_of_heaven',rank).cooldownTicks), [9,8,7,6,5]);
assert.deepEqual([1,2,3,4,5].map((rank) => resolved('blinkstrike',rank).cooldownTicks), [100,85,70,55,40]);
assert.deepEqual([1,2,3,4,5].map((rank) => resolved('violent_shot',rank).spCost), [20,40,60,80,100]);

// Deterministic calibration: use each character XP curve cumulative target,
// cycle eligible monsters in level order, apply the exact production payout floor
// floor(xpReward * 0.25) per kill, and model actions as ceil(HP / (5 x character level)).
// simple equal-level attack proxy puts the documented anchors within the target
// rank bands; actual combat stats/telemetry remain the balance validation.
const charXpAt = (level) => curve.find((entry) => entry.level === level)?.cumulativeXp;
assert.ok(charXpAt(23) > 0 && charXpAt(28) > charXpAt(23) && charXpAt(50) > charXpAt(28));
assert.ok(monsters.some((monster) => monster.level <= 23 && monster.xpReward > 0));
function estimatedMasteryXp(characterLevel, twoHanded) {
  const eligible = monsters.filter((monster) => monster.level <= characterLevel).sort((a,b) => a.level-b.level);
  let characterXp = 0, actionCount = 0, next = 0;
  while (characterXp < charXpAt(characterLevel)) {
    const monster = eligible[next++ % eligible.length];
    // Match resolveXpGain(): floor each kill's payout after the global 0.25 rate.
    characterXp += Math.max(0, Math.floor(Number(monster.xpReward) * 0.25));
    actionCount += Math.ceil(Number(monster.hp) / (5 * characterLevel));
  }
  return actionCount * (twoHanded ? 2 : 1);
}
const level23TwoHanded = masteryLevelForXp(estimatedMasteryXp(23, true));
const level28Sword = masteryLevelForXp(estimatedMasteryXp(28, false));
const level28Dagger = masteryLevelForXp(estimatedMasteryXp(28, false));
const level50TwoHanded = masteryLevelForXp(estimatedMasteryXp(50, true));
const level50Sword = masteryLevelForXp(estimatedMasteryXp(50, false));
const level50Dagger = masteryLevelForXp(estimatedMasteryXp(50, false));
assert.equal(level23TwoHanded, 5);
assert.equal(level28Sword, 5, 'L28 one-handed Sword category reaches Mastery 5');
assert.equal(level28Dagger, 5, 'L28 one-handed Dagger category reaches Mastery 5');
assert.equal(level50TwoHanded, 10, 'around L50 two-handed category reaches Mastery 10');
assert.equal(level50Sword, 10, 'current monster catalogue proxy reaches the Mastery cap for one-handed categories');
assert.equal(level50Dagger, 10, 'both one-handed categories receive identical proxy XP');
assert.equal(estimatedMasteryXp(23, true), 470, 'L23 two-handed proxy applies per-kill Grind floor to the current monster catalogue');
assert.equal(estimatedMasteryXp(28, false), 344, 'L28 one-handed proxy applies per-kill Grind floor to the current monster catalogue');
assert.equal(estimatedMasteryXp(50, false), 80_912, 'current monster catalogue proxy reflects the updated map and HP catalogues');
assert.equal(estimatedMasteryXp(50, true), 161_824, 'two-handed category receives twice the one-handed proxy XP');
console.log(`mastery-progression-ranks: passed; thresholds=${MASTERY_LEVEL_XP_THRESHOLDS.join(',')}; proxyXP=L23-2H:${estimatedMasteryXp(23,true)} L28-1H:${estimatedMasteryXp(28,false)} L50-2H:${estimatedMasteryXp(50,true)} L50-1H:${estimatedMasteryXp(50,false)}; levels=L23-2H:${level23TwoHanded} L28-1H:${level28Sword}/${level28Dagger} L50-2H:${level50TwoHanded} L50-1H:${level50Sword}/${level50Dagger}`);
