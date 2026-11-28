const assert=require('node:assert/strict');
const {BattleService}=require('../dist/apps/api/src/modules/battle/battle.service');
const shared=require('../../../packages/shared/dist');
(async()=>{
 const stats={level:1,hp:1,sp:50,maxHp:100,maxSp:50,atk:0,matk:0,def:0,mdefPercent:0,accuracy:1000,evasion:0,critChance:0,hpRegenPerTenTicks:0,spRegenPerTenTicks:0,agi:5,dex:5,luk:500,attackSpeed:800,moveSpeed:100,masteryEquipment:[]};
 const page={lines:[{conditions:[{id:'upon_death'}],action:{id:'use_item',itemId:'fairy'}}]};
 const input={version:2,balanceRulesVersion:1,tickDurationMs:500,seed:'fairy-flee',definitions:{items:{fairy:{type:'consumable',alchemyCategory:'super_tonics',effect:{type:'revive_full_cleanse'}}}},actors:[{id:'character',kind:'character',team:'a',position:{row:5,column:4},snapshot:stats,gambits:page,inventory:{fairy:1}},{id:'monster',kind:'monster',team:'b',position:{row:5,column:5},snapshot:{...stats,hp:100000,maxHp:100000,atk:30},gambits:{lines:[{conditions:[{id:'always'}],action:{id:'attack'}}]},inventory:{},attackIntervalTicks:2}]};
 const now=Date.now(),c={id:'c',level:1,xp:500,currentMapId:'field',status:'grinding',hpCurrent:1,spCurrent:50,travelIntent:{kind:'saved-town-teleport',fleeRequested:true,generation:1},consumableCooldowns:{}};
 const b={id:'flee-fixture',characterId:'c',monsterId:'mob',startAt:new Date(now-2000),endAt:new Date(now+60000),resolved:false,tickDurationMs:500,seedUsed:input.seed,startingSnapshot:{snapshot:stats,inventory:{fairy:1},worldMoveSpd:10000,gambitPage:page},log:{header:{engineVersion:2,v2Input:input},events:[]}};
 const repo={findOne:async()=>b,save:async x=>x,find:async()=>[],delete:async()=>{}};
 const chars={findOne:async()=>c,save:async x=>x};
 const manager={getRepository:e=>e.name==='Character'?chars:e.name==='InventoryItem'?{find:async()=>[{itemId:'fairy',quantity:1}]}:repo};repo.manager={transaction:async work=>work(manager)};
 const service=Object.create(BattleService.prototype);
 Object.assign(service,{characterRepo:chars,battleQueueRepo:repo,getBattleQueue:async()=>[b],getBattleById:async()=>b,withCharacterQueueLock:async(_id,work)=>work(),dataService:{getItems:()=>({}),getMonsterSkills:()=>[],getStatusEffects:()=>[],getMonsterById:()=>({id:'mob',moveSpd:0})},inventoryService:{removeItem:async()=>{}},equipmentService:{applyPendingEquipmentChanges:async()=>false},logger:{log(){},debug(){},warn(){}},bullQueue:{getJob:async()=>null,add:async()=>{}},idleJournal:{fled:async()=>{}},publishCommittedBattleJournal:async()=>{},applyResolvedFoodState:()=>{},advanceResourceRegenCheckpoint:()=>{},safePublishBattleResolved:async()=>{},safePublishQueueUpdated:async()=>{},buildAuthoritativeBattleSnapshot:async()=>({})});
 assert.equal(await service.attemptFlee('c',1,b.id),'cancelled');
 assert.equal(c.xp,500);assert.equal(c.spCurrent,0);
 const until=Date.parse(c.consumableCooldowns['item:super_tonic']);assert.ok(until>Date.now()+50000,'Fairy cooldown must survive the committed solo escape');
 console.log('Real solo Fairy -> flee settlement preserves XP, SP0 and remaining cooldown');
})().catch(e=>{console.error(e);process.exitCode=1});
