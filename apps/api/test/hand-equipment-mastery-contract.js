const assert = require('node:assert/strict');
const { validateHandLoadout, effectiveWeaponAttack, BattleEngine, calculateMasteryXpAwards } = require('../../../packages/shared/dist');
const { getMasteryXpPolicy } = require('../dist/apps/api/src/modules/battle/battle.service.js');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service.js');
const items = require('../../../items.json').equipment;
const skillTrees = require('../../../skill_trees.json').trees;
const item = (id) => items.find((row) => row.id === id);

assert.deepEqual(validateHandLoadout(item('equip_sword_t1'), item('equip_dagger_t1')), []);
assert.deepEqual(validateHandLoadout(item('equip_dagger_t1'), item('equip_dagger_t1')), []);
assert.ok(validateHandLoadout(item('equip_sword_t1'), item('equip_sword_t1')).length > 0);
assert.ok(validateHandLoadout(item('equip_greatsword_t1'), item('equip_shield_t1')).length > 0);
assert.ok(validateHandLoadout(null, item('equip_shield_t1')).length > 0);
assert.deepEqual(validateHandLoadout(item('equip_rod_t1'), item('equip_rune_t1')), []);
for (const primary of ['sword','dagger','rod']) {
  for (const secondary of ['dagger','shield','rune']) {
    assert.deepEqual(validateHandLoadout(item(`equip_${primary}_t1`), item(`equip_${secondary}_t1`)), [], `${primary}+${secondary}`);
  }
}
for (const type of ['greatsword','bow','staff']) {
  for (const secondary of ['dagger','shield','rune']) {
    assert.ok(validateHandLoadout(item('equip_' + type + '_t1'), item('equip_' + secondary + '_t1')).length, type + '+' + secondary + ' forbidden');
  }
}
assert.ok(validateHandLoadout(item('equip_sword_t1'), item('equip_sword_t1')).length, 'Sword+Sword forbidden');
for (const secondary of ['dagger','shield','rune']) {
  assert.ok(validateHandLoadout(null, item('equip_' + secondary + '_t1')).length, secondary + ' cannot be secondary alone');
}
assert.deepEqual(Object.keys(skillTrees).sort(), ['bow','dagger','greatsword','rod','rune','shield','staff','sword']);
for (const [category, skills] of Object.entries(skillTrees)) {
  assert.equal(skills.length, 2, `${category} has exactly two skills`);
  assert.ok(skills.every((skill) => ['active','passive'].includes(skill.kind)));
}
assert.equal(effectiveWeaponAttack({ fixedStats: { atk: 120 } }, 'mainHand'), 120);
assert.equal(effectiveWeaponAttack({ fixedStats: { atk: 120 } }, 'offHand'), 60);

const runeTiers = [1, 2, 3].map((tier) => item(`equip_rune_t${tier}`));
assert.deepEqual(runeTiers.map((r) => r.fixedStats.def), [2, 5, 10]);
assert.deepEqual(runeTiers.map((r) => r.fixedStats.mdefPercent), [10, 20, 35]);
assert.ok(runeTiers.every((r) => r.slot === 'offHand'));
assert.deepEqual(
  ['equip_bow_t1', 'equip_bow_t2', 'equip_bow_t3'].map((id) => item(id).fixedStats.accuracyModifier),
  [-75, -74, -73],
);
assert.equal(BattleEngine.calculateDerivedStats(1, { str: 5, agi: 5, dex: 5, vit: 5, int: 5, sor: 5 }, {}).accuracy, 80);
assert.equal(BattleEngine.calculateDerivedStats(1, { str: 5, agi: 5, dex: 5, vit: 5, int: 5, sor: 5 }, { accuracyModifier: -75 }).accuracy, 5);

const policy = { twoHandedAction: 2, oneHandedAction: 1, shieldOnHit: 1, runeOnHit: 1 };
assert.deepEqual(getMasteryXpPolicy({}), policy);
assert.deepEqual(getMasteryXpPolicy({ MASTERY_XP_TWO_HANDED_ACTION: '4', MASTERY_XP_ONE_HANDED_ACTION: '3', MASTERY_XP_SHIELD_ON_HIT: '2', MASTERY_XP_RUNE_ON_HIT: '5' }), { twoHandedAction: 4, oneHandedAction: 3, shieldOnHit: 2, runeOnHit: 5 });
assert.throws(() => getMasteryXpPolicy({ MASTERY_XP_RUNE_ON_HIT: '-1' }), /non-negative integer/);
const log = { header: { characterSnapshot: { masteryEquipment: [
  { slot: 'mainHand', category: 'dagger', twoHanded: false },
  { slot: 'offHand', category: 'dagger', twoHanded: false },
  { slot: 'offHand', category: 'rune', twoHanded: false },
] } }, events: [
  { actor: 'character', action: 'attack', target: 'monster', hit: false },
  { actor: 'character', action: 'attack', target: 'monster', hit: true, doubleStrikeTriggered: true, damageComponents: [25, 25] },
  { actor: 'character', action: 'use_skill', target: 'monster', hit: true },
  { actor: 'character', action: 'use_skill', target: 'character', hit: true },
  { actor: 'monster', action: 'use_skill', target: 'character', hit: true, damage: 0, damageType: 'magic' },
  { actor: 'monster', action: 'attack', target: 'character', hit: false },
] };
assert.deepEqual(calculateMasteryXpAwards(log, policy), { dagger: 6, rune: 1 });
const shieldLog = {
  header: { characterSnapshot: { masteryEquipment: [
    { slot: 'mainHand', category: 'sword', twoHanded: false },
    { slot: 'offHand', category: 'shield', twoHanded: false },
  ] } },
  events: log.events,
};
assert.deepEqual(calculateMasteryXpAwards(shieldLog, policy), { sword: 3, shield: 1 }, 'landed non-damaging magic action grants exactly one Shield defensive XP; miss and double-strike components grant none extra');

(async () => {
  const now = Date.now();
  const active = { id: 'active', characterId: 'c1', sequenceIndex: 0, startAt: new Date(now - 1000), endAt: new Date(now + 60000), resolved: false };
  const future = { id: 'future', characterId: 'c1', sequenceIndex: 1, startAt: new Date(now + 60000), endAt: new Date(now + 120000), resolved: false };
  const rows = [active, future];
  const removedJobs = [];
  const queueRepo = {
    find: async () => [...rows],
    delete: async ({ id }) => { for (let i = rows.length - 1; i >= 0; i--) if (id._value?.includes(rows[i].id) || id.includes?.(rows[i].id)) rows.splice(i, 1); },
  };
  const character = { id: 'c1', combatSetting: 'old' };
  const characterRepo = { findOne: async () => character };
  const jobs = { getJob: async (id) => ({ remove: async () => removedJobs.push(id) }) };
  const gateway = { publishBattleQueueUpdated: async () => undefined };
  const service = new BattleService(jobs, queueRepo, characterRepo, {}, {}, {}, {}, {}, {}, {}, {}, gateway, {}, {});
  await service.runFutureCombatMutation('c1', async () => { character.combatSetting = 'new'; });
  assert.equal(rows.length, 1);
  assert.equal(rows[0], active);
  assert.deepEqual(removedJobs, ['future']);
  assert.equal(character.combatSetting, 'new');
  console.log('hand-equipment-mastery-contract: passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
