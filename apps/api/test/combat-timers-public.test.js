const assert=require('node:assert/strict');
const {SharedBattleService}=require('../dist/apps/api/src/modules/party/shared-battle.service');
const actor={id:'ally',kind:'character',team:'a',inventory:{secret:10},gambits:{private:true},snapshot:{hp:50,sp:20,maxHp:100,maxSp:50,skillDefs:{bolt:{cooldownTicks:8}},cooldowns:{'skill:bolt':4,'item:potion':10},statusEffects:[]}};
const row={id:'battle',revision:1,state:'started',snapshot:{actors:[actor],definitions:{items:{hp:{type:'consumable',alchemyCategory:'potions',cooldownInSeconds:10,effect:{type:'heal_hp'}}}}},log:{actorsAfter:{ally:{hp:50,sp:20,inventory:{secret:9},cooldowns:{},statusEffects:[]}},events:[
  {tick:0,actorId:'ally',action:'cast_start',targetIds:[],payload:{type:'cast',skillId:'bolt'}},
  {tick:2,actorId:'ally',action:'use_skill',targetIds:[],payload:{type:'action',skillId:'bolt'}},
  {tick:3,actorId:'ally',action:'use_item',targetIds:[],payload:{type:'action',itemId:'hp'}},
]}};
const service=Object.create(SharedBattleService.prototype);service.db={query:async()=>[row]};
(async()=>{
 const view=await service.publicBattle('ally');
 assert.deepEqual(view.snapshot.actors[0].snapshot.cooldownDurations,{'item:potion':20,'skill:bolt':9});
 assert.deepEqual(view.log.events[1].payload.cooldown,{key:'skill:bolt',durationTicks:9},'existing persisted battles receive timer metadata from their effective snapshot');
 assert.deepEqual(view.log.events[2].payload.cooldown,{key:'item:potion',durationTicks:20});
 assert.equal(view.log.events[0].payload.cooldown,undefined);
 const publicActor=view.snapshot.actors[0];assert.equal(publicActor.inventory,undefined);assert.equal(publicActor.gambits,undefined);assert.equal(publicActor.snapshot.skillDefs,undefined);
 assert.equal(view.log.actorsAfter.ally.inventory,undefined);
 assert.equal(row.log.events[1].payload.cooldown,undefined,'projection does not mutate the immutable log');
 console.log('combat-timers-public: opening timers, old logs and private-data boundary passed');
})().catch(e=>{console.error(e);process.exitCode=1});
