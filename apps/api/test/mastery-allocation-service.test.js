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

async function rejectAllocation(harness, skillId, message) {
  await assert.rejects(harness.service.allocateMasterySkill('user-1', 'sword', skillId), message);
}

(async () => {
  // Mastery 0 cannot spend points. Invalid requests must not persist or invalidate.
  const level0 = makeHarness(0);
  await rejectAllocation(level0, 'swordsmanship', /No unspent Mastery points/);
  assert.equal(level0.row.spentSkillPoints, 0);
  assert.equal(level0.transactionCount, 1);

  // Mastery 1 can purchase exactly one first-node rank, then must wait for XP.
  const level1 = makeHarness(1);
  const rank1 = await level1.service.allocateMasterySkill('user-1', 'sword', 'swordsmanship');
  assert.equal(rank1.skillRanks.swordsmanship, 1);
  assert.equal(rank1.spentSkillPoints, 1);
  await rejectAllocation(level1, 'swordsmanship', /No unspent Mastery points/);

  // Node two is locked at rank 0 and while node one is below rank 5.
  const level5 = makeHarness(5);
  await rejectAllocation(level5, 'power_strike', /prerequisite|First node/);
  for (let i = 0; i < 4; i += 1) await level5.service.allocateMasterySkill('user-1', 'sword', 'swordsmanship');
  assert.equal(level5.row.skillRanks.swordsmanship, 4);
  await rejectAllocation(level5, 'power_strike', /prerequisite|First node|No unspent/);

  // At Mastery 6, all five first-node points unlock one second-node point.
  const level6 = makeHarness(6);
  for (let i = 0; i < 5; i += 1) await level6.service.allocateMasterySkill('user-1', 'sword', 'swordsmanship');
  const rank2 = await level6.service.allocateMasterySkill('user-1', 'sword', 'power_strike');
  assert.equal(rank2.skillRanks.swordsmanship, 5);
  assert.equal(rank2.skillRanks.power_strike, 1);
  assert.equal(rank2.spentSkillPoints, 6);
  assert.equal(level6.lockCount, 6, 'each allocation locks the authoritative mastery row');

  // Mastery 10 allows five ranks per node and never more than ten total points.
  const level10 = makeHarness(10);
  for (let i = 0; i < 5; i += 1) await level10.service.allocateMasterySkill('user-1', 'sword', 'swordsmanship');
  for (let i = 0; i < 5; i += 1) await level10.service.allocateMasterySkill('user-1', 'sword', 'power_strike');
  assert.equal(level10.row.spentSkillPoints, 10);
  assert.equal(level10.row.skillRanks.power_strike, 5);
  await rejectAllocation(level10, 'power_strike', /No unspent Mastery points|maximum rank/);
  assert.equal(level10.transactionCount, 11);

  await assert.rejects(level10.service.allocateMasterySkill('user-1', 'unknown', 'power_strike'), /Unknown Mastery category or skill/);
  console.log('mastery-allocation-service: passed (Mastery levels 0/1/5/6/10, prerequisites, point limits and row locking)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
