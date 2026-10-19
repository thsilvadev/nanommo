const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BattleEngine, effectiveSkillCastTicks } = require('../../../packages/shared/dist/battle-engine');
const root = path.resolve(__dirname, '../../..');
const tree = JSON.parse(fs.readFileSync(path.join(root, 'skill_trees.json'), 'utf8'));
const statusRows = JSON.parse(fs.readFileSync(path.join(root, 'status_effects.json'), 'utf8')).statusEffects;
const statusEffectDefs = Object.fromEntries(statusRows.map(x => [x.id, x]));
const allSkills = [...Object.values(tree.trees).flat(), ...(tree.legacySkills ?? [])];
const skills = Object.fromEntries(allSkills.map(x => [x.id, x]));

assert.equal(BattleEngine.calculateDerivedStats(1, {str:5,agi:5,dex:5,vit:5,int:5,luk:5}, {}).castTimeReduction, 10);
assert.equal(effectiveSkillCastTicks(2, 10), 2);
assert.equal(effectiveSkillCastTicks(2, 100), 1);
assert.equal(effectiveSkillCastTicks(2, 200), 0);
assert.equal(effectiveSkillCastTicks(0, 0), 0);
assert.equal(effectiveSkillCastTicks(undefined, 0), 2);

function run(skillId, {dex=5, includeAttack=false, target='melee', duration, sp=1000}={}) {
  const base = skills[skillId];
  assert(base, `Missing catalog skill ${skillId}`);
  const skill = {...base, ...(duration === undefined ? {} : {baseCastTicks:duration}), effect:{...(base.effect??{})}, masteryRank:1};
  const character = {characterName:'CastTest',level:1,hp:10000,maxHp:10000,sp,maxSp:1000,atk:50000,matk:1,def:0,mdefPercent:0,accuracy:100,evasion:0,critChance:0,agi:5,dex,attackSpeed:800,hpRegenPerTenTicks:0,spRegenPerTenTicks:0,combatStyle:'melee',basicAttackDamageType:'melee',basicAttackRange:0,statusEffects:[],skills:{[skillId]:skill},skillDefs:{[skillId]:skill},masteryEquipment:[]};
  const monster = {id:'dummy',name:'Dummy',level:1,hp:10,atk:0,matk:0,def:0,mdefPercent:0,accuracy:0,evasion:0,critChance:0,atkSpeedTicks:100,combatStyle:'melee',basicAttackDamageType:'melee',basicAttackRange:0,moveSpeedBase:0,gambit:[]};
  const lines = [{priority:1,conditions:[{id:'always'}],action:{id:'use_skill',params:{skillId}}}];
  if (includeAttack) lines.push({priority:2,conditions:[{id:'always'}],action:{id:'attack'}});
  return BattleEngine.simulateBattle(character,monster,{lines},'ctr-'+skillId,{statusEffectDefs,itemDefinitions:{}});
}

const war = run('war_cry', {dex:5, includeAttack:true, duration:2});
const warEvent = war.log.events.find(e => e.action === 'use_skill' && e.skillId === 'war_cry');
assert(warEvent, 'War Cry should resolve');
assert.equal(warEvent.tick, 2, 'DEX 5 gives 10 CTR; two-tick War Cry resolves at T2');
assert(!war.log.events.some(e => e.actor === 'character' && e.action === 'attack' && e.tick <= 2), 'Attack must not resolve on start/pending/resolution ticks');

const instant = run('war_cry', {dex:100, includeAttack:true, duration:2});
assert.equal(instant.log.events.find(e => e.action === 'use_skill' && e.skillId === 'war_cry').tick, 0, 'CTR 200 makes a two-tick skill instant');
const zero = run('war_cry', {dex:5, includeAttack:true, duration:0});
assert.equal(zero.log.events.find(e => e.action === 'use_skill' && e.skillId === 'war_cry').tick, 0, 'catalog zero cast time resolves in intention tick');

console.log('cast-time-reduction-intent: passed');
