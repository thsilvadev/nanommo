const assert=require('node:assert/strict');
const {PartyService}=require('../dist/apps/api/src/modules/party/party.service');
(async()=>{
 const service=Object.create(PartyService.prototype);
 let reservedAt;
 const ctx={now:100000,party:{id:'party',mapId:'field',leaderCharacterId:'a',revision:1,activity:null},members:[{characterId:'a',partyId:'party',orderIndex:0,pendingLeave:false},{characterId:'b',partyId:'party',orderIndex:1,pendingLeave:false}],characters:[{id:'a',currentMapId:'field',status:'town'},{id:'b',currentMapId:'field',status:'town'}]};
 ctx.manager={query:async sql=>sql.includes('JOIN active_battle_participants')?[{endAt:new Date(10000)}]:[]};
 Object.assign(service,{db:{query:async()=>[{characterId:'a'}]},serialized:async(_ids,op)=>op(ctx),shared:{resolve:async()=>{},drain:async()=>{}},reserveClock:async c=>{reservedAt=c.now;}});
 await service.tickParty('party');
 assert.equal(reservedAt,10000,'offline recovery must schedule the next search at the resolved battle boundary, not at wall clock restart');
 console.log('party-offline-recovery: chronological battle boundary passed');
})().catch(e=>{console.error(e);process.exitCode=1});
