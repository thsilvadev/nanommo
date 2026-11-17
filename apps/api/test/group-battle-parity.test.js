const assert=require('node:assert/strict');
const s=require('../../../packages/shared/dist');
const stats={level:1,hp:100,sp:50,maxHp:100,maxSp:50,atk:10,matk:20,def:0,mdefPercent:0,accuracy:100,evasion:0,critChance:0,hpRegenPerTenTicks:0,spRegenPerTenTicks:0,agi:5,dex:5,attackSpeed:800,moveSpeed:100};
const page={lines:[{priority:1,conditions:[{id:'always'}],action:{id:'attack'}}]};
const fairy={type:'consumable',alchemyCategory:'super_tonics',cooldownInSeconds:60,effect:{type:'revive_full_cleanse'}};
assert.equal(s.GambitEvaluator.isActionLegal({id:'use_item',itemId:'fairy'},{...stats,hp:0,cooldowns:{'item:super_tonic':120}},{fairy:2},{fairy}),false,'Fairy blocked by shared super tonic cooldown');
const input=(self={},foe={})=>({version:2,tickDurationMs:500,seed:'parity',definitions:{},actors:[{id:'a',kind:'character',team:'a',position:{row:5,column:4},snapshot:{...stats,...self},gambits:page,inventory:{}},{id:'b',kind:'monster',team:'b',position:{row:5,column:5},snapshot:{...stats,atk:1,...foe},gambits:page,inventory:{},attackIntervalTicks:100}]});
const solo=s.simulateBattleV2(input());
assert.deepEqual(solo.events.filter(e=>e.actorId==='a'&&e.action==='attack').slice(0,3).map(e=>e.tick),[0,2,4]);
const prep=s.simulateBattleV2(input({attackSpeed:400}));
assert.deepEqual(prep.events.filter(e=>e.actorId==='a'&&e.action==='attack').slice(0,3).map(e=>e.tick),[7,17,27]);
const regenInput=input({hp:10,hpRegenPerTenTicks:4});regenInput.actors.forEach(a=>a.snapshot.atk=0);
assert.equal(s.replayBattleV2(regenInput,18).actorsAfter.a.hp,10);assert.equal(s.replayBattleV2(regenInput,19).actorsAfter.a.hp,14);
const moveInput=input();moveInput.actors[0].position.column=0;moveInput.actors[1].position.column=9;
const moves=s.replayBattleV2(moveInput,4).events.filter(e=>e.actorId==='a'&&e.action==='move');assert.deepEqual(moves.map(e=>e.tick),[2,4]);
const limited=s.simulateBattleV2({...input(),maxTicks:1});assert.equal(limited.termination,'limit');assert.equal(limited.ended,false,'execution bound must not be mistaken for a resolved defeat');
// Native V1 chronology remains callable and keeps its old eight-column arena.
const legacy=s.BattleEngine.simulateBattle(stats,{id:'mon_test',hp:20,atk:1,def:0,evasion:0,accuracy:100,critChance:0,atkSpeedTicks:100,gambit:page},page,'legacy');
assert.equal(legacy.outcome,'win');assert.equal(legacy.log.header.characterSnapshot.position,3);
assert.equal(s.adaptBattleLogV1(legacy.log,'a','m').events[0].actorId,'a');
// Real catalog monster skills keep their distinct effects in the unified engine.
const monsterDefs=Object.fromEntries(require('../../../skill_trees.json').monsterSkills.map(d=>[d.id,d]));
function monsterSkill(skillId,override={}) {
 const battle=input({hp:100,maxHp:100,inventory:{}},{hp:50,maxHp:100,sp:100,maxSp:100,atk:10,skills:{[skillId]:true},skillDefs:{[skillId]:{...monsterDefs[skillId],baseCastTicks:0,...override}}});
 battle.actors[0].gambits={lines:[]};battle.actors[1].gambits={lines:[{priority:1,conditions:[{id:'always'}],action:{id:'use_skill',skillId}}]};
 return battle;
}
const monsterHeal=s.replayBattleV2(monsterSkill('monster_skill_self_heal'),0);assert.equal(monsterHeal.actorsAfter.b.hp,75,'monster healPercentMaxHp is a fraction');
const rage=s.replayBattleV2(monsterSkill('monster_skill_rage'),0);assert.equal(rage.actorsAfter.b.hp,50);assert(rage.actorsAfter.b.statusEffects.some(x=>x.type==='rage'&&x.atkBonus===20));
const sting=s.replayBattleV2(monsterSkill('monster_skill_sting'),0);assert.equal(sting.actorsAfter.b.hp,50);assert(sting.actorsAfter.b.statusEffects.some(x=>x.type==='tip_of_pain'));
const massive=s.replayBattleV2(monsterSkill('monster_skill_massive_damage'),0);assert(massive.events.some(e=>e.actorId==='b'&&e.action==='use_skill'&&e.payload.damage>=29));
const stealInput=monsterSkill('monster_skill_pickpocket',{effect:{type:'pickpocket',chance:1}});stealInput.actors[0].inventory={herb:4,food:2};stealInput.definitions.items={herb:{type:'consumable',maxStack:4},food:{type:'consumable',effect:{type:'food_buff'}}};
const stolen=s.replayBattleV2(stealInput,0);assert.equal(stolen.actorsAfter.a.inventory.herb,0);assert.equal(stolen.actorsAfter.a.inventory.food,2);assert.equal(stolen.actorsAfter.a.hp,100);
const empty=input();empty.actors.forEach(a=>a.gambits={lines:[]});assert.equal(s.simulateBattleV2(empty).termination,'stalemate');
const doubled=input({masteryEquipment:[{slot:'mainHand',category:'dagger',twoHanded:false},{slot:'offHand',category:'dagger',twoHanded:false}],skillDefs:{double_strike:{masteryRank:20}},skills:{}},{hp:1000,maxHp:1000});
assert(s.replayBattleV2(doubled,0).events.some(e=>e.actorId==='a'&&e.action==='attack'&&e.payload.damageComponents?.length===2));
const focus=input({skillDefs:{fearless_focus:{masteryRank:1,effect:{atkPerRank:5,atkPerSpace:5,accuracyPerRank:5,accuracyPerSpace:5}}}},{hp:1000,maxHp:1000});
assert(s.replayBattleV2(focus,0).events.find(e=>e.action==='attack'&&e.actorId==='a').payload.damage>=14);
const tipped=input({hp:1000,maxHp:1000},{statusEffects:[{type:'tip_of_pain',appliedAtTick:0,expiresAtTick:100}],atk:10});tipped.actors[0].gambits={lines:[]};tipped.actors[1].attackIntervalTicks=1;
const tip=s.replayBattleV2(tipped,0);assert(tip.events.some(e=>e.action==='attack'&&e.actorId==='b'&&e.payload.damage>=19));assert(tip.actorsAfter.a.statusEffects.some(x=>x.type==='disarm'));assert(!tip.actorsAfter.b.statusEffects.some(x=>x.type==='tip_of_pain'));
const channel=input({skills:{fire:true},skillDefs:{fire:{target:'foe',baseCastTicks:0,cooldownTicks:20,effect:{type:'magic_damage'}}}},{hp:1000,maxHp:1000});channel.actors[0].gambits={lines:[{conditions:[{id:'always'}],action:{id:'use_skill',skillId:'fire'}}]};channel.actors[1].definitionId='mon_unicorn';
assert(s.replayBattleV2(channel,0).actorsAfter.b.statusEffects.some(x=>x.type==='magic_prowess'&&x.matkBonus===20));
const slowMove=input({attackSpeed:400});slowMove.actors[0].position.column=0;slowMove.actors[1].position.column=9;
assert.equal(s.replayBattleV2(slowMove,2).events.find(e=>e.actorId==='a'&&e.action==='move')?.tick,2,'movement intent must not wait for attack gauge');
const adapterStats={...stats,characterId:'player'};
const monster={id:'mon_fixture',name:'Fixture',hp:20,atk:1,def:0,evasion:0,accuracy:100,critChance:0,atkSpeedTicks:100,gambit:page};
assert.equal(typeof s.simulateBattleV2Solo,'function','new solo adapter exported');
const adapted=s.simulateBattleV2Solo(adapterStats,monster,page,'adapter');
assert.equal(adapted.outcome,'win');assert.equal(adapted.log.header.engineVersion,2);assert(adapted.log.events.every(e=>e.hpRemaining&&e.spRemaining));
assert.equal(adapted.inventoryAfter&&typeof adapted.inventoryAfter,'object');
const adaptedCheckpoint=s.simulateBattleV2Solo(adapterStats,{...monster,hp:10000},page,'adapter',{stopAfterTick:1});assert.equal(adaptedCheckpoint.checkpoint.battleEnded,false);assert.equal(adaptedCheckpoint.durationTicks,2);

const lethal=input({hp:10,maxHp:100,atk:0,hpRegenPerTenTicks:100},{atk:20});lethal.actors[1].attackIntervalTicks=20;assert.equal(s.replayBattleV2(lethal,19).actorsAfter.a.hp,0,'regen cannot rescue a combatant killed on the boundary tick');
// Exercise every active catalog entry with its actual effect and rank-scaled cost.
const catalog=require('../../../skill_trees.json');
for(const definition of Object.values(catalog.trees).flat().filter(d=>d.kind==='active')) {
 const resolved={...s.resolveRankScaledSkill(definition,3),masteryRank:3,baseCastTicks:0};
 const battle=input({hp:50,maxHp:10000,sp:10000,maxSp:10000,skills:{[definition.id]:true},skillDefs:{[definition.id]:resolved}},{hp:10000,maxHp:10000});
 battle.actors[0].gambits={lines:[{conditions:[{id:'always'}],action:{id:'use_skill',skillId:definition.id}}]};battle.actors[1].gambits={lines:[]};
 const res=s.replayBattleV2(battle,0);const event=res.events.find(e=>e.action==='use_skill'&&e.actorId==='a');assert(event,definition.id+' executes');
 assert.equal(res.actorsAfter.a.sp,10000-resolved.spCost,definition.id+' pays rank-scaled SP exactly once');
 if(definition.target==='foe')assert(event.payload.damage>0,definition.id+' applies damage');
 if(definition.effect.type==='magic_barrier')assert(res.actorsAfter.a.statusEffects.some(x=>x.absorbRemaining===300));
 if(definition.effect.type==='defense_buff')assert(res.actorsAfter.a.statusEffects.some(x=>x.defBonus===30));
 if(definition.effect.type==='self_heal')assert(res.actorsAfter.a.hp>50);
}
for(const definition of catalog.monsterSkills.filter(d=>d.effect)) {
 const res=s.replayBattleV2(monsterSkill(definition.id),0);assert(res.events.some(e=>e.action==='use_skill'&&e.actorId==='b'),definition.id+' executes');
}
const monsterCadence=input({hp:10000,maxHp:10000,atk:0},{atk:1});monsterCadence.actors[1].attackIntervalTicks=2;assert.deepEqual(s.replayBattleV2(monsterCadence,5).events.filter(e=>e.action==='attack'&&e.actorId==='b').map(e=>e.tick),[1,3,5],'monsters keep catalog cadence without the player swing lock');
const chain=monsterSkill('monster_skill_ice_bolt',{baseCastTicks:2,cooldownTicks:0});assert.deepEqual(s.replayBattleV2(chain,6).events.filter(e=>e.action==='use_skill'&&e.actorId==='b').map(e=>e.tick),[2,4,6],'zero cooldown monster casts chain at their resolution boundary');
const foodBoundary=input({hp:10,atk:0,foodBuffs:[{itemId:'bread',remainingTicks:20,hpRegenPerTenTicks:7,spRegenPerTenTicks:0}]},{atk:0});assert.equal(s.replayBattleV2(foodBoundary,19).actorsAfter.a.hp,10,'food expiring on regeneration boundary contributes no extra tick');
console.log('group-battle-parity: passed');
