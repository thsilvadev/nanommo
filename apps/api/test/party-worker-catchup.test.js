const assert=require('node:assert/strict');
const {PartyWorkerService}=require('../dist/apps/api/src/modules/party/party-worker.service');
(async()=>{
 let calls=0,checks=0;
 const db={query:async sql=>sql.includes('SELECT id FROM parties')?[{id:'p'}]:sql.includes('AS "due"')?[{due:++checks<4}]:[]};
 const party={tickParty:async()=>{calls++},tryAccepted:async()=>{},matchmake:async()=>{}};
 const worker=new PartyWorkerService(db,party,{isLocallyReady:()=>true,assertReadyForProcessing:async()=>{}},{},{},{},{});
 await worker.pulse();assert.equal(calls,4,'one wake-up must process overdue boundaries until caught up');
 console.log('party-worker-catchup: offline boundaries drained in one pulse');
})().catch(e=>{console.error(e);process.exitCode=1});
