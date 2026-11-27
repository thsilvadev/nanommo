const assert = require('node:assert/strict');
const dist = '../dist/apps/api/src';
const { GmTeleportModeService } = require(`${dist}/modules/gm/gm-teleport-mode.service`);
const { TeleportCommand } = require(`${dist}/modules/gm/commands/teleport.command`);
(async () => {
  let role = true;
  const values = new Set();
  const redis = { get: async key => values.has(key) ? '1' : null, eval: async (_, n, key) => { if(values.has(key)){values.delete(key);return 0;}values.add(key);return 1; } };
  const mode = new GmTeleportModeService(redis, {isGm:async () => role});
  assert.equal(await mode.enabled('u','c'), false);
  const command = new TeleportCommand(mode);
  assert.match(await command.run([], {userId:'u',characterId:'c',characterName:'GM'}), /enabled/i);
  assert.equal(await mode.enabled('u','c'), true);
  assert.equal(await mode.enabled('u','other'), false);
  await assert.rejects(command.run(['on'], {userId:'u',characterId:'c'}), /arguments/i);
  role = false;
  assert.equal(await mode.enabled('u','c'), false);
  await assert.rejects(mode.assertEnabled('u','c'), /GM teleport mode is not enabled/);
  await assert.rejects(mode.toggle('u','c'), /GM access required/);
  role = true;
  assert.match(await command.run([], {userId:'u',characterId:'c',characterName:'GM'}), /disabled/i);
  await assert.rejects(mode.assertEnabled('u','c'), /GM teleport mode is not enabled/);
  console.log('GM teleport mode tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

// Force relocation uses the same transaction/party authority as shared battles.
(async () => {
  const { MapService } = require(`${dist}/modules/map/map.service`);
  const { Character, BattleQueueEntry } = require(`${dist}/database/entities`);
  const calls = [];
  const c = {id:'c',userId:'u',currentMapId:'old',status:'grinding',travelIntent:{scheduledJobId:'travel-old'},gatheringCycle:{cycleIndex:3,scheduledJobId:'activity-old'},encounterCycle:{cycleIndex:4},discoveredMapIds:['old']};
  const queue = [{id:'battle-old',startAt:new Date(0),endAt:new Date(Date.now()+1000),resolved:false}];
  const repo = {findOne:async()=>c,save:async()=>c};
  const manager = {getRepository: entity => entity === Character ? repo : {find:async()=>queue,delete:async()=>calls.push('deleted')},query:async(sql)=>{calls.push(sql);return [];}};
  const party = {serialized:async(ids, fn)=>fn({manager,characters:[c],now:Date.now(),members:[],party:null}),prepareGmTeleport:async()=>calls.push('detach')};
  const svc = Object.create(MapService.prototype);
  Object.assign(svc,{gmTeleportMode:{assertEnabled:async(_user,_character,executor)=>{if(executor)assert.equal(executor,manager);calls.push(executor?'authorized-transaction':'authorized');}},characterRepo:repo,dataService:{getMapById:id=>id==='target'?{id,type:'town',isClickable:true}:null},battleService:{partyCoordinator:()=>party,cancelPendingEncounterSearch:async()=>calls.push('search-cancelled'),removeBattleQueueJobs:async ids=>calls.push(ids),publishQueueUpdated:async()=>calls.push('published')},mapPresenceService:{syncCharacter:async()=>calls.push('presence')},bullQueue:{getJob:async id=>({getState:async()=> 'delayed',remove:async()=>calls.push(id)})},logger:{warn(){}}});
  await assert.rejects(svc.gmTeleport('u','c','decorative'),/Map not found/);
  const result=await svc.gmTeleport('u','c','target');
  assert.equal(result.currentMapId,'target'); assert.equal(c.currentMapId,'target'); assert.equal(c.travelIntent,null);
  assert.equal(c.pendingMapTransition,null); assert.equal(c.status,'town'); assert.equal(c.gatheringCycle.cycleIndex,4);
  assert.ok(c.discoveredMapIds.includes('target')); assert.ok(calls.includes('authorized-transaction')); assert.ok(calls.includes('detach')); assert.ok(calls.includes('presence')); assert.ok(calls.includes('published'));
  assert.ok(calls.includes('travel-old')); assert.ok(calls.includes('activity-old')); assert.ok(calls.includes('deleted'));
  svc.dataService.getMapById = id => ({id,type:'grind',isClickable:true});
  svc.battleService.queueBattles = async () => { throw Error('encounters must resume asynchronously'); };
  svc.scheduleStationaryActivity = async id => calls.push(`schedule:${id}`);
  await svc.gmTeleport('u','c','far-undiscovered-grind');
  assert.equal(c.currentMapId,'far-undiscovered-grind');
  assert.equal(c.status,'grinding');
  assert.ok(calls.includes('schedule:c'));
  console.log('GM teleport relocation tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async () => {
  const { PartyService } = require(`${dist}/modules/party/party.service`);
  const shared = require('../../../packages/shared/dist');
  const statuses = Object.fromEntries(require('../../../status_effects.json').statusEffects.map(s=>[s.id,s]));
  const monsters = require('../../../monsters.json').monsters;
  const slime = monsters.find(m=>m.id==='mon_slime');
  const snapshot = {characterId:'gm',characterName:'GM',level:10,hp:900,maxHp:900,sp:50,maxSp:50,atk:1,matk:1,def:0,mdefPercent:0,accuracy:100,evasion:0,critChance:0,hpRegenPerTenTicks:0,spRegenPerTenTicks:0,agi:5,dex:5,attackSpeed:100,moveSpeed:50,luk:5};
  const input = shared.simulateBattleV2Solo(snapshot,slime,[{priority:1,conditions:[{id:'always'}],action:{id:'attack'}}],'gm-checkpoint',{statusEffectDefs:statuses}).log.header.v2Input;
  const row = {id:'shared',startAt:new Date(0),endAt:new Date(60000),snapshot:input,log:{durationTicks:120}};
  const members=[{characterId:'gm'},{characterId:'a'},{characterId:'b'}];
  const chars=members.map(m=>({id:m.characterId,currentMapId:'field'}));
  const ctx={now:8000,members,characters:chars,party:{id:'party'},manager:{query:async sql=>sql.includes('FOR UPDATE OF b')?[row]:sql.includes('UPDATE party_invites')?[[],0]:[]}};
  const calls=[];
  const service=Object.create(PartyService.prototype);
  Object.assign(service,{shared:{resolve:async(_ctx,_row,remove,fled,checkpoint)=>calls.push({fled,checkpoint})},remove:async(_ctx,id,reason)=>{calls.push({id,reason});ctx.members=ctx.members.filter(m=>m.characterId!==id);},event:async()=>{}});
  await service.prepareGmTeleport(ctx,'gm');
  assert.equal(calls[0].fled,true);
  assert.deepEqual(calls[0].checkpoint, shared.replayBattleV2(input,16),'settles elapsed real battle ticks');
  assert.deepEqual(calls[1],{id:'gm',reason:'map'});
  assert.deepEqual(ctx.members.map(m=>m.characterId),['a','b']);
  assert.ok(chars.every(c=>c.currentMapId==='field'),'cleanup never relocates party companions');
  calls.length=0;ctx.members=members;ctx.now=60000;
  await service.prepareGmTeleport(ctx,'gm');
  assert.equal(calls[0].fled,false,'already ended encounters retain normal rewards');
  assert.equal(calls[0].checkpoint,undefined);
  console.log('GM teleport shared checkpoint tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async () => {
  const { GmService } = require(`${dist}/modules/gm/gm.service`);
  const { MapController } = require(`${dist}/modules/map/map.controller`);
  const { MapService } = require(`${dist}/modules/map/map.service`);
  const command = new TeleportCommand({toggle:async()=>true});
  const gm = new GmService([command],{isGm:async()=>true},{findOne:async()=>({name:'GM'})});
  gm.logger={warn(){},error(){}};
  assert.match((await gm.execute('u','c','/gm-help')).message,/\/teleport — Toggles instant teleport/);
  const dto = {id:'c',currentMapId:'target',hpCurrent:99,stats:{atk:5}};
  const calls=[];
  const controller = new MapController({gmTeleport:async(...args)=>{calls.push(args);return {currentMapId:'target',deferred:false};},gmTeleportEnabled:async()=>true},{getCharacterByUserId:async()=>({id:'c'}),getCharacterDtoById:async()=>dto});
  const req={user:{userId:'u'}};
  assert.deepEqual(await controller.gmTeleportMode(req),{enabled:true});
  assert.deepEqual(await controller.gmTeleport(req,'target'),{success:true,currentMapId:'target',deferred:false,character:dto});
  assert.deepEqual(calls,[['u','c','target']]);
  const denied = Object.create(MapService.prototype);
  Object.assign(denied,{gmTeleportMode:{assertEnabled:async()=>{throw Error('not enabled');}},dataService:{getMapById:()=>{throw Error('should not inspect or move');}}});
  await assert.rejects(denied.gmTeleport('player','c','target'),/not enabled/);
  console.log('GM teleport controller, help and authorization tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async () => {
  const { GmAccessService } = require(`${dist}/modules/gm/gm-access.service`);
  let defaultQueries=0, transactionQueries=0;
  const access = new GmAccessService({query:async()=>{defaultQueries++;return [{role:'gm'}];}});
  const manager = {query:async(sql,args)=>{transactionQueries++;assert.match(sql,/SELECT "role"/);assert.deepEqual(args,['u']);return [{role:'gm'}];}};
  const mode = new GmTeleportModeService({get:async()=> '1'},access);
  await mode.assertEnabled('u','c',manager);
  assert.equal(transactionQueries,1,'in-transaction role check uses its existing connection');
  assert.equal(defaultQueries,0,'in-transaction authorization must not borrow another pooled connection');
  await mode.assertEnabled('u','c');
  assert.equal(defaultQueries,1,'outside checks retain the default executor');
  console.log('GM teleport transaction authorization connection tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

// Exercise the real TypeORM PostgresQueryRunner result conversion. PostgreSQL
// UPDATE ... RETURNING is [rows, affected], including [[], 0] without invitations.
(async () => {
  const { PartyService } = require(`${dist}/modules/party/party.service`);
  const { PostgresQueryRunner } = require('typeorm/driver/postgres/PostgresQueryRunner');
  for (const {invites,recipients} of [
    {invites:[],recipients:[]},
    {invites:[{inviterId:'gm',candidateId:'outside-a'}],recipients:['gm','outside-a']},
    {invites:[{inviterId:'gm',candidateId:'outside-a'},{inviterId:'outside-b',candidateId:'gm'}],recipients:['gm','outside-a','outside-b']},
  ]) {
    const events=[];
    const connection={subscribers:[],logger:{logQuery(){},logQueryError(){}}};
    const runner=new PostgresQueryRunner({connection,options:{}}, 'master');
    runner.databaseConnection={query:async(sql,args)=>{
      if(sql.includes('UPDATE party_invites')) {
        assert.deepEqual(args,['gm']);
        return {command:'UPDATE',rows:invites,rowCount:invites.length};
      }
      if(sql.includes('INSERT INTO party_outbox')) {
        assert.equal(typeof args[1],'string','outbox recipient must be a character ID');
        assert.ok(args[1].length>0,'outbox recipient must not be empty');
        events.push({id:args[1],event:args[2],payload:JSON.parse(args[3])});
        return {command:'INSERT',rows:[],rowCount:1};
      }
      return {command:sql.startsWith('UPDATE')?'UPDATE':'SELECT',rows:[],rowCount:0};
    }};
    const ctx={members:[],manager:{query:runner.query.bind(runner)}};
    const service=Object.create(PartyService.prototype);
    await service.prepareGmTeleport(ctx,'gm');
    const refreshes=events.filter(e=>e.event==='party:updated');
    assert.deepEqual(refreshes.map(e=>e.id).sort(),recipients,'each affected invitation participant receives one refresh');
    assert.ok(refreshes.every(e=>e.payload.refresh===true));
    assert.deepEqual(events.filter(e=>e.event==='party:actionUpdated').map(e=>e.id),['gm']);
  }
  console.log('GM teleport Postgres outbox recipient regression tests passed (0, 1 and 2 invitations)');
})().catch(error=>{console.error(error);process.exitCode=1;});
