/** Explicit opt-in disposable PostgreSQL only; never reads game .env. */
const assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {DataSource}=require('typeorm'),entities=require('../dist/apps/api/src/database/entities');
const {PartyService}=require('../dist/apps/api/src/modules/party/party.service');
const {SharedBattleService}=require('../dist/apps/api/src/modules/party/shared-battle.service');
const {PartyGroupCombat1800500000000}=require('../dist/apps/api/src/database/migrations/1800500000000-PartyGroupCombat');
const {InventoryService}=require('../dist/apps/api/src/modules/inventory/inventory.service');
const {QuestService}=require('../dist/apps/api/src/modules/quests/quest.service');
const {DataService}=require('../dist/apps/api/src/modules/data/data.service');
if(process.env.PARTY_TEST_DATABASE!=='nanommo_party_test')throw new Error('Set PARTY_TEST_DATABASE=nanommo_party_test for disposable DB');
const db=new DataSource({type:'postgres',host:'127.0.0.1',port:55439,username:'party_test',database:'nanommo_party_test',entities:Object.values(entities).filter(e=>typeof e==='function'&&!['Party','PartyMember','PartyInvite','CharacterActionIntent','EncounterClock','SharedBattle','SharedBattleParticipant','ActiveBattleParticipant','PartyOutbox'].includes(e.name)),synchronize:false});
(async()=>{
 await db.initialize();await db.synchronize(true);
 await db.query('ALTER TABLE characters DROP COLUMN "autoPartyEnabled", DROP COLUMN "autoPartyEnabledAt"');
 const runner=db.createQueryRunner();await runner.startTransaction();await new PartyGroupCombat1800500000000().up(runner);await runner.commitTransaction();await runner.release();
 const data=new DataService(),cwd=process.cwd();process.chdir(path.resolve(__dirname,'..'));data.onModuleInit();process.chdir(cwd);
 const snapshot={level:1,hp:100,sp:50,maxHp:100,maxSp:50,atk:30,matk:20,def:5,mdefPercent:0,accuracy:100,evasion:0,critChance:0,hpRegenPerTenTicks:0,spRegenPerTenTicks:0,agi:5,dex:5,luk:5,attackSpeed:200,moveSpeed:100,moveSpeedBase:100,isPlayerCharacter:true,basicAttackDamageType:'melee',basicAttackRange:0};
 const battle={buildCharacterSnapshot:async c=>({...snapshot,hp:c.hpCurrent,sp:c.spCurrent}),preparePartyFood:async()=>true};
 const inventory=new InventoryService(db.getRepository(entities.InventoryItem),db.getRepository(entities.Character),data);
 const quests=new QuestService(db.getRepository(entities.Character),db.getRepository(entities.InventoryItem),db.getRepository(entities.QuestInstance),data,{get:()=>undefined});
 const shared=new SharedBattleService(db,battle,data,inventory,quests, {assertValidGambitPage:async()=>{},canonicalizeLines:x=>x});
 const party=new PartyService(db,battle,data,shared),chars=[];
 for(let n=0;n<8;n++){const user=await db.getRepository(entities.User).save({email:`p${n}@test.invalid`,emailVerified:true,provider:'local'});chars.push(await db.getRepository(entities.Character).save({userId:user.id,name:`Party${n}`,hpCurrent:100,spCurrent:50,lastSeenAt:new Date(),appearance:{test:true},currentMapId:'map_town'}));}
 // More than 100 accepted, blocked invitations must not starve a later eligible pair.
 await db.getRepository(entities.Character).update(chars[0].id,{travelIntent:{kind:'route'}});
 for(let n=0;n<100;n++) await db.query(`INSERT INTO party_invites(id,"inviterId","candidateId",mode,status,"expiresAt","clientRequestId","createdAt") VALUES($1,$2,$3,'manual','accepted',clock_timestamp()+interval '1 minute',$4,TIMESTAMPTZ '2026-01-01 00:00:00.123456+00')`,[randomUUID(),chars[0].id,chars[1].id,`blocked-${n}`]);
 const later=randomUUID();await db.query(`INSERT INTO party_invites(id,"inviterId","candidateId",mode,status,"expiresAt","clientRequestId") VALUES($1,$2,$3,'manual','accepted',clock_timestamp()+interval '1 minute','later')`,[later,chars[6].id,chars[7].id]);
 await party.tryAccepted();assert.equal((await db.query('SELECT status FROM party_invites WHERE id=$1',[later]))[0].status,'joined','blocked older requests must not starve a free pair');
 await party.leave(chars[6].id);await db.query('DELETE FROM party_invites');await db.getRepository(entities.Character).update(chars[0].id,{travelIntent:null});
 // Legacy solo operations and Party transactions share PostgreSQL authority.
 const {BattleService}=require('../dist/apps/api/src/modules/battle/battle.service');
 const {AsyncLocalStorage}=require('node:async_hooks');
 const legacy=Object.create(BattleService.prototype);
 Object.assign(legacy,{characterRepo:db.getRepository(entities.Character),queueAuthority:new AsyncLocalStorage(),redis:{set:async()=>"OK",eval:async()=>1},logger:{log(){},error(){}}});
 let release,entered;const held=new Promise(resolve=>release=resolve),locked=new Promise(resolve=>entered=resolve);
 const soloOperation=legacy.withCharacterQueueLock(chars[0].id,async()=>{entered();await held;});await locked;
 let partyEntered=false;const joiningOperation=party.serialized([chars[0].id],async()=>{partyEntered=true;});
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(partyEntered,false,'Party must wait for the solo PostgreSQL authority');
 release();await Promise.all([soloOperation,joiningOperation]);assert.equal(partyEntered,true);
 // Offline auto-feed must use the encounter's historic boundary, not wall time.
 legacy.dataService=data;legacy.inventoryService=inventory;
 const feedAt=Date.now()-3600000,food='food_bread',oldDigest=new Date(feedAt-1000).toISOString();
 await db.getRepository(entities.Character).update(chars[3].id,{autoFeed:true,diet:[{itemId:food,consumedAt:new Date(feedAt-3601000).toISOString(),digestUntil:oldDigest,dietLevel:0}],dietLevels:{[food]:{level:0,lastDigestUntil:oldDigest}}});
 await db.getRepository(entities.InventoryItem).save({characterId:chars[3].id,location:'inventory',slotIndex:0,itemId:food,quantity:2});
 await db.transaction(async manager=>{const c=await manager.getRepository(entities.Character).findOneBy({id:chars[3].id});assert.deepEqual(await legacy.tryAutoFeed(c,feedAt-2000,manager),[],'food still digesting at historic boundary must not be consumed');});
 await db.transaction(async manager=>{const c=await manager.getRepository(entities.Character).findOneBy({id:chars[3].id});assert.deepEqual(await legacy.tryAutoFeed(c,feedAt,manager),[food]);});
 const afterFeed=await db.getRepository(entities.Character).findOneBy({id:chars[3].id});assert.equal(afterFeed.diet[0].consumedAt,new Date(feedAt).toISOString(),'diet timestamp belongs to historic boundary');assert.equal(await inventory.getItemCount(chars[3].id,food),1,'exactly one food consumed');
 // Legacy boundary 0 must continue to use wall-clock time.
 const legacyBefore=Date.now();
 await db.getRepository(entities.Character).update(chars[3].id,{diet:[{itemId:food,consumedAt:new Date(legacyBefore-7200000).toISOString(),digestUntil:new Date(legacyBefore-1).toISOString(),dietLevel:0}],dietLevels:{[food]:{level:0,lastDigestUntil:new Date(legacyBefore-1).toISOString()}}});
 await db.transaction(async manager=>{const c=await manager.getRepository(entities.Character).findOneBy({id:chars[3].id});assert.deepEqual(await legacy.tryAutoFeed(c,0,manager),[food]);});
 const legacyAfter=await db.getRepository(entities.Character).findOneBy({id:chars[3].id});assert.ok(Date.parse(legacyAfter.diet[0].consumedAt)>=legacyBefore,'legacy 0 uses wall-clock time');assert.equal(await inventory.getItemCount(chars[3].id,food),0);
 const invite=async(a,b)=>{await party.invite(a.id,b.id,undefined,randomUUID());return(await db.query('SELECT * FROM party_invites WHERE "inviterId"=$1 AND "candidateId"=$2 ORDER BY "createdAt" DESC',[a.id,b.id]))[0];};
 let inv=await invite(chars[0],chars[1]);await party.accept(chars[1].id,inv.id);await party.accept(chars[1].id,inv.id);
 let state=await party.get(chars[0].id);assert.equal(state.party.members.length,2);
 for(let n=2;n<4;n++){inv=await invite(chars[0],chars[n]);await party.accept(chars[n].id,inv.id);}
 const a=await invite(chars[0],chars[4]),b=await invite(chars[0],chars[5]);await Promise.allSettled([party.accept(chars[4].id,a.id),party.accept(chars[5].id,b.id)]);
 state=await party.get(chars[0].id);assert.equal(state.party.members.length,5,'last slot cannot be double-claimed');
 await assert.rejects(()=>party.reorder(chars[1].id,state.party.members.map(m=>m.characterId)),/PARTY LEADER REQUIRED/);
 await party.reorder(chars[0].id,state.party.members.map(m=>m.characterId).reverse());
 const candidate=chars.find(c=>!state.party.members.some(m=>m.characterId===c.id));
 await assert.rejects(()=>db.query('INSERT INTO party_members("partyId","characterId","orderIndex") VALUES($1,$2,0)',[state.party.id,candidate.id]),/unique/i);
 const battleIds=[randomUUID(),randomUUID()];for(const id of battleIds)await db.query(`INSERT INTO shared_battles(id,"mapId",seed,"startAt","endAt",state,snapshot,log) VALUES($1,'field','seed',clock_timestamp(),clock_timestamp(),'started','{}','{}')`,[id]);
 const claims=await Promise.allSettled(battleIds.map(id=>db.transaction(m=>m.query('INSERT INTO active_battle_participants("characterId","battleId") VALUES($1,$2)',[candidate.id,id]))));assert.equal(claims.filter(c=>c.status==='fulfilled').length,1);
 const {CharacterService}=require('../dist/apps/api/src/modules/character/character.service');
 const regen=Object.create(CharacterService.prototype);
 Object.assign(regen,{characterRepository:db.getRepository(entities.Character),battleService:{withCharacterQueueLock:(_id,fn)=>fn(),partyCoordinator:()=>({})},dataService:data});
 const occupied=await regen.applyOffBattleRegeneration(candidate.id);
 assert.equal(occupied.resourcesChanged,false,'active shared battle suppresses off-battle regeneration');
 await db.query('DELETE FROM active_battle_participants');
 await party.enqueue(candidate.id,'bad','attributes',{str:999});await party.enqueue(candidate.id,'good','attributes',{str:1});
 let actions=await party.actions(candidate.id);assert.equal(actions.find(a=>a.sequence==='1').status,'failed');assert.equal(actions.find(a=>a.sequence==='2').status,'failed');
 await db.getRepository(entities.Character).update(candidate.id,{unspentAttributePoints:200});await party.enqueue(candidate.id,'valid','attributes',{str:1});await party.enqueue(candidate.id,'valid','attributes',{str:1});assert.equal((await db.getRepository(entities.Character).findOneBy({id:candidate.id})).str,6);
 await db.query(`INSERT INTO encounter_clocks("ownerKind","ownerId","mapId","searchStartedAt","dueAt",seed,status,roster) VALUES('character',$1,'field',clock_timestamp(),clock_timestamp()+interval '30 seconds','reserved','searching','[{"monsterId":"fixed"}]')`,[candidate.id]);
 const before=(await db.query('SELECT * FROM encounter_clocks WHERE "ownerId"=$1',[candidate.id]))[0];
 for(let n=0;n<100;n++)await party.enqueue(candidate.id,`spam-${n}`,'attributes',{str:1});
 const oldRetry=await party.enqueue(candidate.id,'valid','attributes',{str:1});assert.equal(oldRetry.intent?.clientRequestId,'valid','old retry returns its own persisted action after 100 newer requests');assert.equal(oldRetry.intent.status,'applied');
 const after=(await db.query('SELECT * FROM encounter_clocks WHERE "ownerId"=$1',[candidate.id]))[0];assert.equal(after.dueAt.getTime(),before.dueAt.getTime());assert.equal(after.seed,'reserved');assert.deepEqual(after.roster,[{monsterId:'fixed'}]);
 await db.query(`UPDATE encounter_clocks SET "dueAt"=clock_timestamp()-interval '1 second' WHERE "ownerId"=$1`,[candidate.id]);
 for(let n=0;n<32;n++)await party.enqueue(candidate.id,`pending-${n}`,'attributes',{str:1});
 await assert.rejects(()=>party.enqueue(candidate.id,'over-limit','attributes',{str:1}),/Too many pending/);
 const pending=await party.actions(candidate.id);assert.equal(pending.filter(a=>a.status==='pending').length,32);const cancelled=pending.find(a=>a.status==='pending');await party.cancelAction(candidate.id,cancelled.id);await party.cancelAction(candidate.id,cancelled.id);assert.equal((await party.actions(candidate.id)).find(a=>a.id===cancelled.id).status,'cancelled');
 await party.leave(chars[0].id);state=await party.get(chars[1].id);assert.notEqual(state.party.leaderCharacterId,chars[0].id);assert.equal(state.party.members.length,4);
 for(const m of state.party.members.slice(0,3))await party.leave(m.characterId);assert.equal(Number((await db.query('SELECT count(*) AS n FROM parties'))[0].n),0);
 // An intent issued now cannot affect a replayed historical boundary.
 await db.getRepository(entities.Character).update(chars[0].id,{unspentAttributePoints:2});
 await party.serialized([chars[0].id],async ctx=>{await shared.enqueue(ctx,chars[0].id,'historical','attributes',{str:1});ctx.now-=60000;await shared.drain(ctx);});
 assert.equal((await party.actions(chars[0].id)).find(a=>a.clientRequestId==='historical').status,'pending','future request must wait when processing an earlier boundary');
 await party.enqueueDrain(chars[0].id);
 assert.equal((await party.actions(chars[0].id)).find(a=>a.clientRequestId==='historical').status,'applied');
 // Saved Gambit metadata and lines must be persisted together by the pending action.
 const draft=await db.getRepository(entities.GambitPage).save({characterId:chars[0].id,slotIndex:0,title:'Before',lines:[]});
 await party.enqueue(chars[0].id,'edit-page','gambit_update',{pageId:draft.id,title:'After',slotIndex:1,lines:[{conditions:[{id:'always'}],action:{id:'attack'}}]});
 const edited=await db.getRepository(entities.GambitPage).findOneBy({id:draft.id});
 assert.equal(edited.title,'After');assert.equal(edited.slotIndex,1);assert.equal(edited.lines.length,1);
 const clash=await db.getRepository(entities.GambitPage).save({characterId:chars[0].id,slotIndex:2,title:'Other',lines:[]});
 await party.enqueue(chars[0].id,'invalid-page','gambit_update',{pageId:draft.id,title:'Invalid',slotIndex:2,lines:[]});
 assert.equal((await party.actions(chars[0].id)).find(a=>a.clientRequestId==='invalid-page').status,'failed','occupied Gambit slot rejected');
 assert.equal((await db.getRepository(entities.GambitPage).findOneBy({id:draft.id})).title,'After','failed update is atomic');
 // Actual V2 2v2 encounter, immutable shared log, redelivery-safe rewards and private snapshot.
 const field='map_green_grounds_0';
 const fighters=chars.slice(6,8);
 await db.query(`UPDATE characters SET "currentMapId"=$1,status='grinding',"autoPartyEnabled"=false WHERE id=ANY($2::uuid[])`,[field,fighters.map(c=>c.id)]);
 const originalPool=data.getMonstersInMap.bind(data),originalMonster=data.getMonsterById.bind(data);
 const monster={id:'test_target',name:'Training Target',level:1,hp:20,atk:1,matk:1,def:0,mdefPercent:0,accuracy:100,evasion:0,critChance:0,atkSpeedTicks:20,moveSpd:100,combatStyle:'melee',basicAttackDamageType:'melee',basicAttackRange:0,xpReward:11,gambit:[{condition:{type:'always'},action:{type:'attack'}}],drops:[]};
 data.getMonstersInMap=()=>[monster];data.getMonsterById=id=>id===monster.id?monster:originalMonster(id);
 for(const c of fighters){const page=await db.getRepository(entities.GambitPage).save({characterId:c.id,slotIndex:0,title:'Attack',lines:[{conditions:[{id:'always'}],action:{id:'attack'}}]});await db.getRepository(entities.Character).update(c.id,{activeGambitPageId:page.id});}
 inv=await invite(fighters[0],fighters[1]);await party.accept(fighters[1].id,inv.id);
 const group=(await party.get(fighters[0].id)).party;assert.equal(group.members.length,2);
 await db.query(`UPDATE encounter_clocks SET "dueAt"=clock_timestamp()-interval '1 second' WHERE "ownerId"=$1`,[group.id]);
 await party.tickParty(group.id);
 const started=(await db.query('SELECT * FROM shared_battles WHERE "partyId"=$1',[group.id]))[0];assert.ok(started,'V2 party encounter starts');assert.equal(started.snapshot.actors.length,4);assert.equal(started.state,'started');
 assert.equal(new Set(started.snapshot.actors.map(a=>JSON.stringify(a.position))).size,4,'unique formation in persisted snapshot');
 const joining=chars[2];await db.getRepository(entities.Character).update(joining.id,{currentMapId:field,status:'grinding'});const pendingInvite=await invite(fighters[0],joining);await db.query('DELETE FROM party_outbox WHERE "characterId"=$1',[fighters[0].id]);await party.accept(joining.id,pendingInvite.id);assert.ok((await db.query("SELECT id FROM party_outbox WHERE \"characterId\"=$1 AND event='party:updated'",[fighters[0].id])).length,'inviter sees accepted pending synchronization');assert.equal(await party.member(joining.id),null,'accepted invite cannot enter started battle');
 const originalSnapshot=JSON.stringify(started.snapshot);await party.leave(fighters[1].id);assert.equal((await party.get(fighters[1].id)).party.members.find(m=>m.characterId===fighters[1].id).pendingLeave,true);assert.equal(JSON.stringify((await db.query('SELECT snapshot FROM shared_battles WHERE id=$1',[started.id]))[0].snapshot),originalSnapshot,'leave preserves started snapshot');
 const view=await shared.publicBattle(fighters[0].id);assert.ok(view.snapshot.actors.every(a=>a.inventory===undefined&&a.gambits===undefined));assert.ok(Object.values(view.log.actorsAfter).every(a=>a.inventory===undefined));
 const beforeXp=await db.getRepository(entities.Character).findBy({id:require('typeorm').In(fighters.map(c=>c.id))});
 // Death of one member dissolves this two-person party, but must not erase either consumed encounter.
 await db.query(`UPDATE shared_battles SET log=jsonb_set(log,ARRAY['actorsAfter',$2::text,'hp'],'0'::jsonb),"endAt"=clock_timestamp()-interval '1 millisecond' WHERE id=$1`,[started.id,fighters[1].id]);
 await Promise.all([party.tickParty(group.id),party.tickParty(group.id)]);
 const terminal=(await db.query('SELECT * FROM shared_battles WHERE id=$1',[started.id]))[0];assert.equal(terminal.state,'resolved');
 const afterXp=await db.getRepository(entities.Character).findBy({id:require('typeorm').In(fighters.map(c=>c.id))});assert.equal(Object.values(terminal.result.awards).reduce((n,a)=>n+Number(a.xp),0),22,'shared XP grants exactly once across concurrent redelivery');
 assert.equal(Number((await db.query('SELECT count(*) AS n FROM active_battle_participants WHERE "battleId"=$1',[started.id]))[0].n),0);
 const counters=await db.getRepository(entities.MapKillCounter).findBy({characterId:require('typeorm').In(fighters.map(c=>c.id)),mapId:field});
 assert.deepEqual(counters.map(c=>Number(c.mapKillCount)).sort(),[1,1],'party dissolution must preserve all consumed encounter counters');
 data.getMonstersInMap=originalPool;
 // Leaving/cancelling a shared route cannot leave orphan per-character travel intents.
 const travelers=[];for(let n=8;n<11;n++){const user=await db.getRepository(entities.User).save({email:`p${n}@test.invalid`,emailVerified:true,provider:'local'});travelers.push(await db.getRepository(entities.Character).save({userId:user.id,name:`Party${n}`,hpCurrent:100,spCurrent:50,lastSeenAt:new Date(),appearance:{test:true},currentMapId:'map_town'}));}
 for(const follower of travelers.slice(1)){const offer=await invite(travelers[0],follower);await party.accept(follower.id,offer.id);}
 const travelingGroup=(await party.get(travelers[0].id)).party;
 const route={kind:'route',destinationMapId:'map_green_grounds_0',participantIds:travelers.map(c=>c.id),segmentDueAt:Date.now()+60000};
 await db.query('UPDATE parties SET activity=$2 WHERE id=$1',[travelingGroup.id,JSON.stringify(route)]);
 for(const c of travelers)await db.getRepository(entities.Character).update(c.id,{travelIntent:{kind:'route',partyId:travelingGroup.id}});
 await party.leave(travelers[1].id);
 assert.equal((await db.getRepository(entities.Character).findOneBy({id:travelers[1].id})).travelIntent,null,'leaving member cancels own shared route');
 assert.ok((await db.getRepository(entities.Character).findOneBy({id:travelers[2].id})).travelIntent,'other members keep travelling');
 await party.leave(travelers[0].id);
 assert.equal((await db.getRepository(entities.Character).findOneBy({id:travelers[0].id})).travelIntent,null,'leaving leader has no orphan route');
 assert.equal((await db.getRepository(entities.Character).findOneBy({id:travelers[2].id})).travelIntent,null,'dissolution cancels remaining shared route');

 // Restart recovery resumes the timeline at the actual historical battle end.
 data.getMonstersInMap=()=>[monster];
 const offline=[];for(let n=11;n<13;n++){const user=await db.getRepository(entities.User).save({email:`p${n}@test.invalid`,emailVerified:true,provider:'local'});const c=await db.getRepository(entities.Character).save({userId:user.id,name:`Party${n}`,hpCurrent:100,spCurrent:50,lastSeenAt:new Date(),appearance:{test:true},currentMapId:field,status:'grinding'});const page=await db.getRepository(entities.GambitPage).save({characterId:c.id,slotIndex:0,title:'Attack',lines:[{conditions:[{id:'always'}],action:{id:'attack'}}]});await db.getRepository(entities.Character).update(c.id,{activeGambitPageId:page.id});offline.push(c);}
 const offlineOffer=await invite(offline[0],offline[1]);await party.accept(offline[1].id,offlineOffer.id);
 const offlineGroup=(await party.get(offline[0].id)).party;
 await db.query(`UPDATE encounter_clocks SET "dueAt"=clock_timestamp()-interval '90 seconds' WHERE "ownerId"=$1`,[offlineGroup.id]);
 await party.tickParty(offlineGroup.id);
 const prior=(await db.query('SELECT * FROM shared_battles WHERE "partyId"=$1',[offlineGroup.id]))[0];
 assert.ok(prior&&prior.endAt.getTime()<Date.now()-10000,'fixture battle ended in the past');
 await party.tickParty(offlineGroup.id);
 const recoveryClock=(await db.query(`SELECT * FROM encounter_clocks WHERE "ownerKind"='party' AND "ownerId"=$1`,[offlineGroup.id]))[0];
 assert.equal(recoveryClock.searchStartedAt.getTime(),prior.endAt.getTime(),'next search begins at historical combat end');
 assert.ok(recoveryClock.dueAt.getTime()<Date.now(),'offline deadline must remain in the past and be caught up');
 await assert.rejects(()=>new PartyGroupCombat1800500000000().down(),/forward-only/);
 console.log('party-concurrency.integration passed migration, constraints, last-slot race, active-claim race, intents FIFO/retry/limit/cancel, immutable clock, leader/dissolve');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.isInitialized&&db.destroy());
