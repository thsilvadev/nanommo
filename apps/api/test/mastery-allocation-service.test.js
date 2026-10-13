const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CharacterService } = require('../dist/apps/api/src/modules/character/character.service.js');

const root = path.resolve(__dirname, '../../..');
const trees = JSON.parse(fs.readFileSync(path.join(root, 'skill_trees.json'), 'utf8')).trees;
const skills = Object.fromEntries(Object.entries(trees).map(([category, entries]) => [category, entries]));

function makeHarness(level) {
  const character = { id: 'character-1', userId: 'user-1', level: 1 };
  const row = { id: 'mastery-sword', characterId: character.id, weaponType: 'sword', level, xp: 0, spentSkillPoints: 0, skillRanks: {} };
  const rows = new Map([['sword', row]]);
  let transactionCount = 0;
  let lockCount = 0;
  const repo = {
    findOne: async ({ where, lock } = {}) => {
      if (lock?.mode === 'pessimistic_write') lockCount += 1;
      return where?.weaponType ? (rows.get(where.weaponType) ?? null) : null;
    },
    save: async (entity) => { rows.set(entity.weaponType, entity); return entity; },
  };
  const manager = { getRepository: () => repo };
  const masteryRepo = { manager: { transaction: async (work) => { transactionCount += 1; return work(manager); } } };
  const characterRepo = { findOne: async ({ where } = {}) => where?.userId === character.userId ? character : null };
  const emptyRepo = {};
  const dataService = { getSkillsForWeapon: (category) => skills[category] ?? [] };
  const battleService = { runFutureCombatMutation: async (_characterId, mutation) => mutation() };
  const service = new CharacterService(characterRepo, masteryRepo, emptyRepo, emptyRepo, emptyRepo, dataService, battleService);
  return { service, row, rows, get transactionCount() { return transactionCount; }, get lockCount() { return lockCount; } };
}

async function rejectAllocation(harness, targetRanks, message) {
  await assert.rejects(harness.service.applyMasteryRanks('user-1', 'sword', targetRanks), message);
}
function ranks(swordsmanship=0,powerStrike=0){return {swordsmanship,power_strike:powerStrike};}

(async () => {
  // Mastery 0 cannot spend points. Invalid requests must not persist or invalidate.
  const level0 = makeHarness(0);
  await rejectAllocation(level0, ranks(1,0), /exceed available Mastery points/);
  assert.equal(level0.row.spentSkillPoints, 0);
  assert.equal(level0.transactionCount, 1);

  // Mastery 1 can purchase exactly one first-node rank, then must wait for XP.
  const level1 = makeHarness(1);
  const rank1 = await level1.service.applyMasteryRanks('user-1', 'sword', ranks(1,0));
  assert.equal(rank1.skillRanks.swordsmanship, 1);
  assert.equal(rank1.spentSkillPoints, 1);
  await rejectAllocation(level1, ranks(2,0), /exceed available Mastery points/);

  // Node two is locked at rank 0 and while node one is below rank 5.
  const level5 = makeHarness(5);
  await rejectAllocation(level5, ranks(0,1), /prerequisite|First node/i);
  await level5.service.applyMasteryRanks('user-1', 'sword', ranks(4,0));
  assert.equal(level5.row.skillRanks.swordsmanship, 4);
  await rejectAllocation(level5, ranks(4,1), /prerequisite|First node/i);

  // At Mastery 6, all five first-node points unlock one second-node point.
  const level6 = makeHarness(6);
  await level6.service.applyMasteryRanks('user-1', 'sword', ranks(5,0));
  const rank2 = await level6.service.applyMasteryRanks('user-1', 'sword', ranks(5,1));
  assert.equal(rank2.skillRanks.swordsmanship, 5);
  assert.equal(rank2.skillRanks.power_strike, 1);
  assert.equal(rank2.spentSkillPoints, 6);
  assert.equal(level6.lockCount, 2, 'each Apply locks the authoritative mastery row once');

  // Mastery 10 allows five ranks per node and never more than ten total points.
  const level10 = makeHarness(10);
  await level10.service.applyMasteryRanks('user-1', 'sword', ranks(5,5));
  assert.equal(level10.row.spentSkillPoints, 10);
  assert.equal(level10.row.skillRanks.power_strike, 5);
  await rejectAllocation(level10, ranks(5,6), /Invalid target rank/);
  assert.equal(level10.transactionCount, 1);

  await assert.rejects(level10.service.applyMasteryRanks('user-1', 'unknown', ranks(0,0)), /Unknown Mastery category/);
  console.log('mastery-allocation-service: passed (absolute target ranks, prerequisites, point limits and row locking)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
