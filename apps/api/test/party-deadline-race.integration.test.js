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
 const original=(await db.query('SELECT str FROM characters WHERE id=$1',[id]))[0].str;
 const shared=new SharedBattleService(db,{}, {}, {}, {}, {}),party=new PartyService(db,{}, {},shared),requestId=randomUUID();
 await db.query(`INSERT INTO encounter_clocks("ownerKind","ownerId","mapId","searchStartedAt","dueAt",seed,status,roster) VALUES('character',$1,'field',clock_timestamp(),clock_timestamp()+interval '1 second','race','searching','[]') ON CONFLICT("ownerKind","ownerId") DO UPDATE SET status='searching',"dueAt"=EXCLUDED."dueAt",seed='race'`,[id]);
 await party.serialized([id],async ctx=>{
   await shared.enqueue(ctx,id,requestId,'attributes',{str:1});
   ctx.now=Number((await ctx.manager.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now'))[0].now);
   await shared.drain(ctx);
   await ctx.manager.query('SELECT pg_sleep(1.1)'); // emulate a stalled transaction after the final deadline check
 });
 const action=(await db.query('SELECT status FROM character_action_intents WHERE "characterId"=$1 AND "clientRequestId"=$2',[id,requestId]))[0];
 assert.equal(action.status,'pending','a command that misses the deadline must remain pending');
 assert.equal((await db.query('SELECT str FROM characters WHERE id=$1',[id]))[0].str,original,'the rejected transaction must not change combat attributes');
 await db.query(`UPDATE encounter_clocks SET status='consumed' WHERE "ownerKind"='character' AND "ownerId"=$1`,[id]);
 await party.enqueueDrain(id);
 assert.equal((await db.query('SELECT str FROM characters WHERE id=$1',[id]))[0].str,original+1,'the retained command applies after the encounter');
 await party.enqueueDrain(id);
 assert.equal((await db.query('SELECT str FROM characters WHERE id=$1',[id]))[0].str,original+1,'retry cannot apply the same command twice');

 const users=db.getRepository(entities.User);
 const characters=db.getRepository(entities.Character);
 const pair=[];
 for(let n=0;n<2;n++){
   const user=await users.save({email:`${randomUUID()}@test.invalid`,emailVerified:true,provider:'local'});
   pair.push(await characters.save({userId:user.id,name:`Race${randomUUID().slice(0,8)}`,hpCurrent:100,spCurrent:50,lastSeenAt:new Date(),appearance:{test:true},currentMapId:'map_town'}));
 }
 const [leader,candidate]=pair;
 const invite=randomUUID();
 await db.query(`INSERT INTO party_invites(id,"inviterId","candidateId",mode,status,"expiresAt","clientRequestId") VALUES($1,$2,$3,'manual','accepted',clock_timestamp()+interval '1 minute',$1::uuid::text)`,[invite,leader.id,candidate.id]);
 await db.query(`INSERT INTO encounter_clocks("ownerKind","ownerId","mapId","searchStartedAt","dueAt",seed,status,roster) VALUES('character',$1,'map_town',clock_timestamp(),clock_timestamp()+interval '1 second','join-race','searching','[]')`,[leader.id]);
 const joinParty=new PartyService(db,{}, {getMapById:()=>({type:'town'})},shared);
 const changed=joinParty.changed.bind(joinParty);
 joinParty.changed=async ctx=>{await changed(ctx);await ctx.manager.query('SELECT pg_sleep(1.1)');};
 await joinParty.tryAccepted();
 assert.equal(await joinParty.member(candidate.id),null,'a join that misses the deadline must not change membership');
 assert.equal((await db.query('SELECT status FROM party_invites WHERE id=$1',[invite]))[0].status,'accepted','the accepted invitation remains pending');
 assert.equal((await db.query('SELECT status FROM encounter_clocks WHERE "ownerId"=$1',[leader.id]))[0].status,'searching','the original encounter remains reserved');
 await db.query(`UPDATE encounter_clocks SET status='consumed' WHERE "ownerId"=$1`,[leader.id]);
 joinParty.changed=changed;
 await joinParty.tryAccepted();
 assert.ok(await joinParty.member(candidate.id),'the accepted invitation joins after the encounter');
 assert.equal((await db.query('SELECT count(*)::int AS count FROM party_deadline_checks'))[0].count,0,'deadline checks must not leave durable rows');
 console.log('party-deadline-race: delayed commit cannot alter the encounter snapshot');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.isInitialized&&db.destroy());
