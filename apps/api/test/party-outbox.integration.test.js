/** Uses only the disposable party database and Redis on ports 55439 and 56380. */
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {DataSource}=require('typeorm'),Redis=require('../node_modules/ioredis');
const {PartyWorkerService}=require('../dist/apps/api/src/modules/party/party-worker.service');
if(process.env.PARTY_TEST_DATABASE!=='nanommo_party_test')throw new Error('Disposable test DB required');
const db=new DataSource({type:'postgres',host:'127.0.0.1',port:55439,username:'party_test',database:'nanommo_party_test'});
(async()=>{
 await db.initialize();const characters=await db.query('SELECT id FROM characters LIMIT 1');assert.ok(characters.length,'run party-concurrency integration first');
 await db.query('DELETE FROM party_outbox');
 const id=randomUUID(),characterId=characters[0].id,event='party:integrationTest';
 await db.query('INSERT INTO party_outbox(id,"characterId",event,payload) VALUES($1,$2,$3,$4)',[id,characterId,event,JSON.stringify({id})]);
 const redis=new Redis({host:'127.0.0.1',port:56380}),subscriber=redis.duplicate();await subscriber.subscribe(`gateway:${event}:${characterId}`);let received=0;
 subscriber.on('message',(_channel,msg)=>{if(JSON.parse(msg).id===id)received++});
 let first=true;const flaky={publish:async(...args)=>{const n=await redis.publish(...args);if(first){first=false;throw new Error('injected crash after publication');}return n;}};
 const party={tickParty:async()=>{},tryAccepted:async()=>{},matchmake:async()=>{},enqueueDrain:async()=>{}};
 const gate={isLocallyReady:()=>true,assertReadyForProcessing:async()=>{}};
 const worker=new PartyWorkerService(db,party,gate,flaky,{getCharacterDtoById:async()=>null},{getInventory:async()=>[]},{queueBattles:async()=>{}});
 await assert.rejects(()=>worker.pulse(),/injected crash/);
 assert.equal((await db.query('SELECT "publishedAt" FROM party_outbox WHERE id=$1',[id]))[0].publishedAt,null,'publication failure must keep durable outbox row pending');
 await worker.pulse();await new Promise(r=>setTimeout(r,30));
 assert.ok((await db.query('SELECT "publishedAt" FROM party_outbox WHERE id=$1',[id]))[0].publishedAt,'retry marks the message delivered');
 assert.equal(received,2,'a crash after publication must redeliver the same event');
 await subscriber.quit();await redis.quit();await db.query('DELETE FROM party_outbox WHERE id=$1',[id]);
 console.log('party-outbox.integration: real Redis/Postgres recovery and redelivery passed');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.isInitialized&&db.destroy());
