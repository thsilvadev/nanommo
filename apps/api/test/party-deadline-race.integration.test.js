/** Reproduce a late database commit on the disposable test database only. */
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {DataSource}=require('typeorm'),entities=require('../dist/apps/api/src/database/entities');
const {PartyService}=require('../dist/apps/api/src/modules/party/party.service');
const {SharedBattleService}=require('../dist/apps/api/src/modules/party/shared-battle.service');
if(process.env.PARTY_TEST_DATABASE!=='nanommo_party_test')throw Error('Disposable test DB required');
const db=new DataSource({type:'postgres',host:'127.0.0.1',port:55439,username:'party_test',database:'nanommo_party_test',entities:Object.values(entities).filter(x=>typeof x==='function')});
(async()=>{
 await db.initialize();const rows=await db.query(`SELECT c.id FROM characters c LEFT JOIN party_members m ON m."characterId"=c.id LEFT JOIN active_battle_participants a ON a."characterId"=c.id WHERE m."characterId" IS NULL AND a."characterId" IS NULL LIMIT 1`);assert(rows.length);const id=rows[0].id;
 await db.query('DELETE FROM battle_queue_entries WHERE "characterId"=$1',[id]);await db.query('DELETE FROM character_action_intents WHERE "characterId"=$1',[id]);await db.query('UPDATE characters SET "unspentAttributePoints"=5 WHERE id=$1',[id]);
 const shared=new SharedBattleService(db,{}, {}, {}, {}, {}),party=new PartyService(db,{}, {},shared),requestId=randomUUID();
 await db.query(`INSERT INTO encounter_clocks("ownerKind","ownerId","mapId","searchStartedAt","dueAt",seed,status,roster) VALUES('character',$1,'field',clock_timestamp(),clock_timestamp()+interval '1 second','race','searching','[]') ON CONFLICT("ownerKind","ownerId") DO UPDATE SET status='searching',"dueAt"=EXCLUDED."dueAt",seed='race'`,[id]);
 await party.serialized([id],async ctx=>{
   await shared.enqueue(ctx,id,requestId,'attributes',{str:1});
   ctx.now=Number((await ctx.manager.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now'))[0].now);
   await shared.drain(ctx);
   await ctx.manager.query('SELECT pg_sleep(1.1)'); // emulate a stalled transaction after the final deadline check
 });
 const action=(await db.query('SELECT status FROM character_action_intents WHERE "characterId"=$1 AND "clientRequestId"=$2',[id,requestId]))[0];
 assert.notEqual(action.status,'applied','a command that commits after the encounter deadline must remain pending');
 console.log('party-deadline-race: delayed commit cannot alter the encounter snapshot');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.isInitialized&&db.destroy());
