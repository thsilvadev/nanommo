const assert=require('node:assert/strict');
const {simulateBattleV2Solo}=require('../../../packages/shared/dist');
const statuses=Object.fromEntries(require('../../../status_effects.json').statusEffects.map(s=>[s.id,s]));
const hero={level:1,hp:10000,maxHp:10000,sp:0,maxSp:0,atk:1,matk:1,def:0,mdefPercent:20,accuracy:100,evasion:0,critChance:0,hpRegenPerTenTicks:0,spRegenPerTenTicks:0,agi:5,dex:5,element:'fire',basicAttackElement:'neutral'};
const foe={id:'different-opponent',name:'Other monster',hp:10000,atk:1,matk:1,gambit:[]};
function run(type){return simulateBattleV2Solo({...hero,statusEffects:[{type,damageType:'magic',damagePerTick:200,damageIntervalTicks:10,nextDamageAtTick:0,expiresAtTick:50,sourceActorId:'monster:mon_flamingtreant:0',sourceSkillId:'old-source'},{type:'magic_barrier',absorbRemaining:1000,expiresAtTick:100}]},foe,[],'carried-burn',{statusEffectDefs:statuses,stopAfterTick:1});}
const burned=run('burn'),burnTick=burned.log.events.find(event=>event.action==='status_tick');
assert.equal(burnTick.actorId,'monster:mon_flamingtreant:0','carried Burn retains its actual source instead of attributing damage to the victim');
assert.equal(burnTick.actor,'monster','old carried sources without sourceActor infer monster kind from the original ID');assert.equal(burnTick.damage,0,'Burn is mitigated by the magic barrier');
const poison=run('poison');assert.equal(poison.log.events.find(event=>event.action==='status_tick').damage,160,'unrelated poison keeps its previous MDEF-only mitigation and bypasses the barrier');
console.log('elemental carried status: original source identity, legacy kind inference, Burn barrier and unchanged poison semantics passed');
