const assert=require('node:assert/strict');
const {SharedBattleService}=require('../dist/apps/api/src/modules/party/shared-battle.service');
(async()=>{
 const service=Object.create(SharedBattleService.prototype);
 const ctx={now:5000,manager:{query:async()=>[{id:'battle',startAt:new Date(0),endAt:new Date(5000),log:{durationTicks:10}}]}};
 await assert.rejects(()=>service.flee(ctx,'leader',async()=>{}),/already ended/i,'finished battle must resolve rewards instead of accepting a late FLEE');
 console.log('party-flee-boundary: finished encounter cannot be converted to flee');
})().catch(e=>{console.error(e);process.exitCode=1});
