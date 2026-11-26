// Rootbound Brute: always attacks; Rage only when it cannot attack (Disarm). Attack and skill lines feed
// separate gauges, so an `always → Rage` line fired at the start of every battle (full SP) whatever the
// attack line above it said (2026-11-26).
// Run: pnpm --filter @nanommo/shared build && node apps/api/test/brute-rage-only-when-disarmed.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const shared = require(path.join(root, 'packages/shared/dist'));
const monsters = require(path.join(root, 'monsters.json'));
const mirror = require(path.join(root, 'apps/frontend/public/data/monsters.json'));
const statuses = Object.fromEntries(require(path.join(root, 'status_effects.json')).statusEffects.map((s) => [s.id, s]));
const trees = require(path.join(root, 'skill_trees.json')).trees;
const list = (m) => (Array.isArray(m) ? m : (m.monsters ?? Object.values(m).flat()));
const allSkills = Object.values(trees).flat();
const skill = (id) => allSkills.find((s) => s.id === id);

const brute = list(monsters).find((m) => m.id === 'mon_rootboundbrute');
assert.deepEqual(list(mirror).find((m) => m.id === 'mon_rootboundbrute').gambit, brute.gambit, 'frontend mirror in sync (node scripts/sync-frontend-data.js)');
// As BattleService does: every monster skill from skill_trees.json `monsterSkills`.
const monsterSkillDefs = Object.fromEntries(require(path.join(root, 'skill_trees.json')).monsterSkills.map((s) => [s.id, s]));
assert(monsterSkillDefs.monster_skill_rage, 'Rage is a monster skill');
const MONSTER = 'monster:mon_rootboundbrute:0';

const swordsman = (skills) => ({
  level: 30, hp: 4000, maxHp: 4000, sp: 400, maxSp: 400, atk: 120, matk: 10, def: 40, mdefPercent: 0, accuracy: 200, evasion: 5,
  critChance: 0, hpRegenPerTenTicks: 0, spRegenPerTenTicks: 20, agi: 10, dex: 10, attackSpeed: 100, moveSpeed: 100,
  characterId: 'char-self', characterName: 'Swordsman', basicAttackDamageType: 'melee', basicAttackRange: 0, combatStyle: 'melee',
  skillDefs: skills, skills,
});
const attackOnly = [{ priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } }];
const run = (character, gambits, seed) => shared.simulateBattleV2Solo(character, brute, gambits, seed, { statusEffectDefs: statuses, monsterSkillDefs }).log.v2Events;
const rages = (events) => events.filter((e) => e.actorId === MONSTER && e.action === 'use_skill' && e.payload?.skillId === 'monster_skill_rage');

// 1. Never disarmed: never rages (it used to rage at tick 0 of every battle).
for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
  const events = run(swordsman({}), attackOnly, seed);
  assert.equal(rages(events).length, 0, `seed ${seed}: no Rage without Disarm (Rage at ticks ${rages(events).map((e) => e.tick)})`);
  assert(events.some((e) => e.actorId === MONSTER && e.action === 'attack'), `seed ${seed}: the brute attacks`);
}

// 2. Disarmed by Heavy Swing: it rages while disarmed (Rage cleanses the Disarm), and only then.
const heavySwing = { ...skill('heavy_swing'), masteryRank: 1 };
const withSwing = [
  { priority: 1, conditions: [{ id: 'always' }], action: { id: 'use_skill', params: { skillId: 'heavy_swing' } } },
  { priority: 2, conditions: [{ id: 'always' }], action: { id: 'attack' } },
];
let raged = 0;
for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']) {
  const events = run(swordsman({ heavy_swing: heavySwing }), withSwing, seed);
  const disarms = events.filter((e) => e.action === 'status_apply' && e.targetIds?.[0] === MONSTER && e.payload?.statusId === 'disarm');
  for (const rage of rages(events)) {
    const covering = disarms.some((d) => d.tick <= rage.tick && rage.tick < d.tick + 20);
    assert(covering, `seed ${seed}: Rage at tick ${rage.tick} only while disarmed (disarms at ${disarms.map((d) => d.tick)})`);
    raged++;
  }
}
assert(raged > 0, 'a disarmed brute rages');
console.log(`brute-rage-only-when-disarmed: no Rage without Disarm; ${raged} Rage(s), all while disarmed`);
