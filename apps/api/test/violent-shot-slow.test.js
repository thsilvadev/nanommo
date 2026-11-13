const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BattleEngine } = require('../../../packages/shared/dist/battle-engine');
const root = path.resolve(__dirname, '../../..');
const skills = JSON.parse(fs.readFileSync(path.join(root, 'skill_trees.json'), 'utf8'));
const statuses = JSON.parse(fs.readFileSync(path.join(root, 'status_effects.json'), 'utf8'));
const statusEffectDefs = Object.fromEntries(statuses.statusEffects.map((row) => [row.id, row]));
const violentShot = skills.trees.bow.find((row) => row.id === 'violent_shot');
const skill = { ...violentShot, masteryRank: 1, spCost: 20 };
const snapshot = {
  characterName: 'ViolentShotTest', level: 1, hp: 5000, maxHp: 5000, sp: 500, maxSp: 500,
  atk: 100000, matk: 0, def: 0, mdefPercent: 0, accuracy: 500, evasion: 0, critChance: 0,
  agi: 5, dex: 100, attackSpeed: 0, moveSpeedBase: 51, moveSpeed: 51, movementGauge: 0,
  hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0,
  combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0,
  statusEffects: [], masteryEquipment: [{ slot: 'mainHand', category: 'bow', twoHanded: true }],
  skills: { violent_shot: skill }, skillDefs: { violent_shot: skill },
};
const monster = {
  id: 'violent-shot-dummy', name: 'Dummy', level: 1, hp: 150000, atk: 0, matk: 0,
  def: 0, mdefPercent: 0, accuracy: 0, evasion: 0, critChance: 0, atkSpeedTicks: 99,
  combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0,
  moveSpeedBase: 300, canMove: true, gambit: [],
};
const page = { lines: [
  { priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } },
  { priority: 2, conditions: [{ id: 'always' }], action: { id: 'use_skill', params: { skillId: 'violent_shot' } } },
] };
const result = BattleEngine.simulateBattle(snapshot, monster, page, 'violent-shot-momentum', { statusEffectDefs, itemDefinitions: {}, stopAfterTick: 14 });
const hit = result.log.events.find((event) => event.action === 'use_skill' && event.skillId === 'violent_shot');
const push = result.log.events.find((event) => event.action === 'move' && event.reason === 'violent_shot_push');
const slow = result.log.events.find((event) => event.action === 'status_applied' && event.status === 'violent_shot_slow');
assert(hit && hit.damage >= 24 && hit.damage <= 26, `rank 1 damage is 25 (actual ${hit?.damage})`);
assert(push, 'successful push is recorded');
assert(slow && slow.target === 'monster' && slow.durationTicks === 12, 'successful push applies a 12-tick / 6-second slow to the monster');
const activeResult = BattleEngine.simulateBattle(snapshot, monster, page, 'violent-shot-slow-active', { statusEffectDefs, itemDefinitions: {}, stopAfterTick: 5 });
const activeSlow = activeResult.checkpoint?.monsterStatusEffects?.find((status) => status.type === 'violent_shot_slow');
assert(activeSlow && Math.abs(activeSlow.moveSpeedMultiplier - 0.2) < 0.0001, 'target status applies an 80% Move Speed reduction');
assert(result.log.events.some((event) => event.action === 'status_ended' && event.status === 'violent_shot_slow'), 'target slow expires after 6 seconds');
const rankFiveSkill = { ...violentShot, masteryRank: 5, spCost: 100 };
const rankFiveSnapshot = { ...snapshot, sp: 500, skillDefs: { violent_shot: rankFiveSkill }, skills: { violent_shot: rankFiveSkill } };
const rankFiveResult = BattleEngine.simulateBattle(rankFiveSnapshot, monster, page, 'violent-shot-momentum-rank-five', { statusEffectDefs, itemDefinitions: {} });
const rankFiveHit = rankFiveResult.log.events.find((event) => event.action === 'use_skill' && event.skillId === 'violent_shot');
assert(rankFiveHit && rankFiveHit.damage >= 124 && rankFiveHit.damage <= 126, `rank 5 damage is 125 (actual ${rankFiveHit?.damage})`);
const edgeSnapshot = { ...snapshot, combatStyle: 'ranged', basicAttackDamageType: 'ranged' };
const edgeMonster = { ...monster, combatStyle: 'melee', basicAttackDamageType: 'melee' };
const edgeResult = BattleEngine.simulateBattle(edgeSnapshot, edgeMonster, page, 'violent-shot-no-displacement', { statusEffectDefs, itemDefinitions: {} });
assert(edgeResult.log.events.some((event) => event.action === 'use_skill' && event.skillId === 'violent_shot'), 'edge-case Violent Shot still resolves');
assert(!edgeResult.log.events.some((event) => event.action === 'status_applied' && event.status === 'violent_shot_slow'), 'no displacement at the lane edge grants no slow');
console.log('violent-shot-slow: damage scaling, successful-push trigger, -80% target Move Speed and 6-second expiry passed');
