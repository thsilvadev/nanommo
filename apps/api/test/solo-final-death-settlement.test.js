const assert=require('node:assert/strict');
const {BattleService}=require('../dist/apps/api/src/modules/battle/battle.service');
async function check(hp,expected){
 const c={id:'c',level:1,xp:500,currentMapId:'field',status:'grinding',hpCurrent:100,spCurrent:50};
 const b={id:'b',characterId:'c',mapId:'field',monsterId:'m',outcome:'loss',hpAfter:hp,spAfter:0,log:{events:[{revived:true}]},endAt:new Date(),resolved:false,itemsConsumed:[]};
 const service=Object.create(BattleService.prototype);
 const chars={findOne:async()=>c,save:async x=>x};
 const battles={findOne:async()=>b,save:async x=>x,find:async()=>[],delete:async()=>{}};
 const manager={getRepository:e=>e.name==='Character'?chars:battles};
 battles.manager={transaction:async work=>work(manager)};
 Object.assign(service,{battleQueueRepo:battles,dataService:{getXpToNextLevel:()=>1000,getMapById:()=>({id:'map_town',type:'town'})},logger:{log(){},debug(){},warn(){}},bullQueue:{getJob:async()=>null},mapPresenceService:{syncCharacter:async()=>{}},withCharacterQueueLock:async(_id,work)=>work()});
 for(const method of ['applyMasteryRewards','applyResolvedFoodState','advanceResourceRegenCheckpoint','resetEncounterSequence','publishCommittedBattleJournal','safePublishBattleResolved','safePublishCharacterDied'])service[method]=async()=>{};
 assert.equal(await service.resolveBattle('b'),true);assert.equal(c.xp,expected);
 assert.equal(await service.resolveBattle('b'),false);assert.equal(c.xp,expected);
}
(async()=>{await check(0,480);await check(100,500);console.log('Solo definitive death and surviving loss settlements/retry passed');})().catch(e=>{console.error(e);process.exitCode=1});
