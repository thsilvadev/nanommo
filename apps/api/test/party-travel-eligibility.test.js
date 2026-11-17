const assert=require('node:assert/strict');
const {PartyService}=require('../dist/apps/api/src/modules/party/party.service');
(async()=>{
 const service=Object.create(PartyService.prototype),town={id:'town',type:'town',coordinates:{x:0,y:0}},field={id:'field',type:'grind',coordinates:{x:1,y:0}};
 const members=[{characterId:'a'},{characterId:'b'}],characters=[{id:'a',userId:'u1',name:'Leader',currentMapId:'town',discoveredMapIds:['town']},{id:'b',userId:'u2',name:'Member',currentMapId:'town'}];
 const ctx={now:1000,party:{id:'p',kind:'manual',leaderCharacterId:'a',mapId:'town',activity:null},members,characters,manager:{getRepository:()=>({findOneBy:async ({id})=>({id,emailVerified:id==='u1'})})}};
 Object.assign(service,{data:{getMapById:id=>id==='town'?town:field,getMaps:()=>[town,field]},battle:{preparePartyFood:async()=>true},serialized:async(_ids,fn)=>fn(ctx),isBusy:async()=>false,advanceRoute:async()=>{throw Error('unverified party was allowed to travel')}});
 await assert.rejects(()=>service.travel('a','field'),/verified/i);
 assert.equal(ctx.party.activity,null,'unverified member cannot be moved to a Grind map');
 console.log('party-travel-eligibility: every traveling member requires verified email');
})().catch(e=>{console.error(e);process.exitCode=1});
