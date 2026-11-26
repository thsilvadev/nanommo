// Movement gauge cap (movementRulesVersion 1): an actor that stands still (in melee, casting) must not
// bank movement and then cross the arena one cell per tick — which also made Violent Shot's slow moot.
// Run: pnpm --filter @nanommo/shared build && node apps/api/test/movement-gauge-cap.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const shared = require(path.join(root, 'packages/shared/dist'));
const monsters = require(path.join(root, 'monsters.json'));
const statuses = Object.fromEntries(require(path.join(root, 'status_effects.json')).statusEffects.map((s) => [s.id, s]));
const trees = require(path.join(root, 'skill_trees.json')).trees;
const list = Array.isArray(monsters) ? monsters : (monsters.monsters ?? Object.values(monsters).flat());
const allSkills = Object.values(trees).flat();
const skill = (id) => allSkills.find((s) => s.id === id);

const brute = list.find((m) => m.id === 'mon_rootboundbrute');
const monsterSkillDefs = Object.fromEntries((brute.gambit ?? []).map((g) => g.action?.skillId).filter(Boolean).map((id) => [id, skill(id)]).filter(([, d]) => d));
const violentShot = { ...skill('violent_shot'), masteryRank: 1 };
const archer = {
  level: 30, hp: 540, maxHp: 540, sp: 200, maxSp: 200, atk: 300, matk: 10, def: 10, mdefPercent: 0, accuracy: 200, evasion: 5,
  critChance: 0, hpRegenPerTenTicks: 0, spRegenPerTenTicks: 7, agi: 10, dex: 20, attackSpeed: 200, moveSpeed: 100,
  characterId: 'char-self', characterName: 'Archer', basicAttackDamageType: 'ranged', basicAttackRange: 8, combatStyle: 'ranged',
  skillDefs: { violent_shot: violentShot }, skills: { violent_shot: violentShot },
};
const gambits = [
  { priority: 1, conditions: [{ id: 'always' }], action: { id: 'use_skill', params: { skillId: 'violent_shot' } } },
  { priority: 2, conditions: [{ id: 'always' }], action: { id: 'attack' } },
];
const MONSTER = 'monster:mon_rootboundbrute:0';
const run = () => shared.simulateBattleV2Solo(archer, brute, gambits, 'seed-1', { statusEffectDefs: statuses, monsterSkillDefs });

const fresh = run();
const input = fresh.log.header.v2Input;
assert.equal(input.movementRulesVersion, 1, 'new solo inputs use the capped movement gauge');

/** The first push of the brute after it had stood still (in melee) for a while, and its steps after it. */
function afterPush(events) {
  const approaches = events.filter((e) => e.action === 'move' && e.actorId === MONSTER && e.payload.reason === 'approach');
  const pushes = events.filter((e) => e.action === 'move' && e.payload.reason === 'push' && e.targetIds[0] === MONSTER);
  const push = pushes.find((p) => { const last = approaches.filter((e) => e.tick < p.tick).pop(); return last && p.tick - last.tick >= 5; });
  assert(push, 'the archer pushes the brute after it stood in melee');
  const before = approaches.filter((e) => e.tick < push.tick);
  const next = pushes.find((p) => p.tick > push.tick)?.tick ?? Infinity;
  const steps = approaches.filter((e) => e.tick >= push.tick && e.tick < next);
  return { push, standing: push.tick - before[before.length - 1].tick, steps };
}

const capped = afterPush(fresh.log.v2Events);
assert(capped.standing >= 5, `the brute stood in melee for a while first (${capped.standing} ticks)`);
const slowEndsAt = capped.push.tick + 12;
const slowedSteps = capped.steps.filter((e) => e.tick < slowEndsAt);
// 80% slower: one cell takes ~5x its normal ticks. At most the first (already earned) step and one more fit in 6 s.
assert(slowedSteps.length <= 2, `slowed brute takes at most 2 steps in the 6 s slow (took ${slowedSteps.length} at ${slowedSteps.map((e) => e.tick)})`);

// Determinism: an input persisted before this rule (no movementRulesVersion) replays as it was generated.
const legacyInput = { ...input };
delete legacyInput.movementRulesVersion;
const legacy = shared.simulateBattleV2(legacyInput);
const banked = afterPush(legacy.events);
assert(banked.steps.filter((e) => e.tick < banked.push.tick + 12).length >= 4, `legacy inputs keep the banked dash through the slow (${banked.steps.map((e) => e.tick)})`);
const replayed = shared.replayBattleV2(legacyInput, legacy.durationTicks);
assert.deepEqual(replayed.events.map((e) => [e.tick, e.action, e.actorId]), legacy.events.map((e) => [e.tick, e.action, e.actorId]), 'legacy replay matches its original run');
const replayedNew = shared.replayBattleV2(input, fresh.durationTicks);
assert.deepEqual(replayedNew.events.map((e) => [e.tick, e.action, e.actorId]), fresh.log.v2Events.map((e) => [e.tick, e.action, e.actorId]), 'new replay matches its original run');

console.log(`movement-gauge-cap: brute stood ${capped.standing} ticks, slowed steps ${slowedSteps.map((e) => e.tick)}; legacy inputs unchanged`);
