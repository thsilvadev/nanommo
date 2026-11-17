const assert = require('node:assert/strict');
const shared = require('../../../packages/shared/dist');
assert.equal(typeof shared.simulateBattleV2, 'function', 'V2 simulator is exported');
const snapshot = (extra = {}) => ({ level:1,hp:100,sp:50,maxHp:100,maxSp:50,atk:25,matk:20,def:0,mdefPercent:0,accuracy:100,evasion:0,critChance:0,hpRegenPerTenTicks:0,spRegenPerTenTicks:0,agi:5,dex:5,attackSpeed:800,moveSpeed:100,...extra });
const actor = (id, team, extra={}) => ({ id,team,kind:team==='a'?'character':'monster',name:team==='a'?id:'Slime',position:{row:5,column:team==='a'?4:5},snapshot:snapshot(extra),gambits:{lines:[{priority:1,conditions:[{id:'always'}],action:{id:'attack'}}]},inventory:{} });
const input = actors => ({version:2,seed:'group-test',tickDurationMs:500,actors:shared.placeBattleActors(actors),definitions:{}});
const first = input([actor('a','a'),actor('b','b',{atk:1})]);
const before = JSON.stringify(first);
const result = shared.simulateBattleV2(first);
assert.equal(JSON.stringify(first),before,'does not mutate snapshot');
assert.deepEqual(shared.simulateBattleV2(first),result,'same seed gives byte-for-byte result');
assert.equal(result.outcome,'win');
assert.equal(result.actorsAfter.b.hp,0);
assert(result.events.every(e=>e.actorId&&Array.isArray(e.targetIds)));
for(const tick of [0,1,3,result.durationTicks-1]) {
 const replay=shared.replayBattleV2(first,tick);
 assert.deepEqual(replay.events,result.events.filter(e=>e.tick<=tick));
}
assert.deepEqual(shared.replayBattleV2(first,result.durationTicks+5).actorsAfter,result.actorsAfter);
assert.throws(()=>shared.simulateBattleV2(input([actor('same','a'),actor('same','b')])),/unique/i);
for(let n=1;n<=5;n++) {
 const roster=Array.from({length:n},(_,i)=>actor('a'+i,'a'));
 const enemies=Array.from({length:n*2},(_,i)=>actor('b'+i,'b'));
 const positioned=shared.placeBattleActors([...roster,...enemies]);
 assert.equal(new Set(positioned.map(a=>`${a.position.row},${a.position.column}`)).size,positioned.length);
 assert.deepEqual(positioned.filter(a=>a.team==='a').map(a=>a.position.row),({1:[5],2:[4,5],3:[4,5,6],4:[3,4,5,6],5:[3,4,5,6,7]})[n]);
}
const crowded=shared.placeBattleActors(Array.from({length:20},(_,i)=>actor('id'+String(i).padStart(2,'0'),i<10?'a':'b')));
assert.equal(new Set(crowded.map(a=>`${a.position.row},${a.position.column}`)).size,20);
assert.equal(shared.findGridPath({row:0,column:0},{row:0,column:2},[{row:0,column:1}]).length,4);
const wall=Array.from({length:10},(_,row)=>({row,column:1}));
assert.equal(shared.findGridPath({row:0,column:0},{row:0,column:2},wall),null);
const big=input(shared.placeBattleActors(Array.from({length:15},(_,i)=>actor('id'+String(i).padStart(2,'0'),i<5?'a':'b',{hp:40,maxHp:40}))));
assert.deepEqual(shared.simulateBattleV2(big),shared.simulateBattleV2(big));
const ten=input(crowded); assert.deepEqual(shared.simulateBattleV2(ten),shared.simulateBattleV2(ten));
// Healing must select by ratio and test every condition on that same candidate.
const healer=actor('healer','a',{hp:100,maxHp:100,skills:{heal:true},skillDefs:{heal:{target:'ally',baseCastTicks:0,spCost:2,cooldownTicks:20,effect:{type:'self_heal',flatPerRank:30}}}});
healer.gambits={lines:[{priority:1,conditions:[{id:'ally_lowest_hp'},{id:'ally_hp',params:{comparator:'lt',value:50,unit:'percent'}}],action:{id:'use_skill',params:{skillId:'heal'}}}]};
const healInput=input([healer,actor('injured','a',{hp:20,maxHp:100}),actor('low-absolute','a',{hp:10,maxHp:20}),actor('foe','b',{atk:0})]);
const healResult=shared.replayBattleV2(healInput,0);
const healEvent=healResult.events.find(e=>e.action==='use_skill');
assert.deepEqual(healEvent.targetIds,['injured']);
assert.equal(healResult.actorsAfter.injured.hp,51);
const ko=actor('fallen','a',{hp:0});
const reviver=actor('reviver','a'); reviver.inventory={tea:1}; reviver.gambits={lines:[{priority:1,conditions:[{id:'ally_has_status',params:{status:'ko'}}],action:{id:'use_item',params:{itemId:'tea'}}}]};
const reviveInput=input([reviver,ko,actor('foe','b')]); reviveInput.definitions.items={tea:{type:'consumable',alchemyCategory:'super_tonics',effect:{type:'revive_half'}}};
const revived=shared.replayBattleV2(reviveInput,20);
assert(revived.actorsAfter.fallen.hp>0); assert.equal(revived.actorsAfter.reviver.inventory.tea,0);
assert(revived.actorsAfter.reviver.cooldowns['item:super_tonic']>0);
// Each generated principal is row-aligned even when raid extras outnumber the party.
for(let size=1;size<=5;size++) {
 const allies=Array.from({length:size},(_,i)=>({...actor('p'+i,'a'),orderIndex:i}));
 const enemies=allies.flatMap((a,i)=>[{...actor('principal'+i,'b'),principalActorId:a.id,encounterRole:'principal'},{...actor('raid'+i,'b'),principalActorId:a.id,encounterRole:'raid'}]);
 const positions=shared.placeBattleActors([...allies,...enemies]);
 for(let i=0;i<size;i++)assert.equal(positions.find(a=>a.id==='principal'+i).position.row,positions.find(a=>a.id==='p'+i).position.row);
 assert.equal(new Set(positions.map(a=>`${a.position.row},${a.position.column}`)).size,positions.length);
 assert(positions.filter(a=>a.encounterRole==='raid').every(a=>a.position.column===9));
}
// A cast holds its chosen identity. A target KO before resolution cannot redirect damage.
const caster=actor('caster','a',{skills:{bolt:true},skillDefs:{bolt:{target:'foe',baseCastTicks:4,spCost:5,effect:{type:'magic_damage'}}}});caster.position={row:5,column:4};caster.gambits={lines:[{conditions:[{id:'foe_lowest_hp'}],action:{id:'use_skill',skillId:'bolt'}}]};
const killer=actor('killer','a',{atk:1000});killer.position={row:4,column:4};
const doomed=actor('doomed','b',{hp:1,maxHp:1});doomed.position={row:5,column:5};
const other=actor('other','b',{hp:10000,maxHp:10000,atk:0});other.position={row:4,column:5};
const casting={version:2,seed:'cast-target',tickDurationMs:500,definitions:{},actors:[caster,killer,doomed,other]};
const castReplay=shared.replayBattleV2(casting,4);assert(castReplay.events.some(e=>e.actorId==='caster'&&e.action==='cast_fizzle'&&e.targetIds[0]==='doomed'));
// Replay event snapshots are safe public projections and match the state after the event.
for(const event of result.events)for(const state of Object.values(event.actorStates)){assert.equal('inventory' in state,false);assert.equal('gambits' in state,false);assert(state.position);}

console.log('group-battle-engine: passed');
