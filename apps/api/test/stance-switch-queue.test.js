const assert=require('node:assert/strict');
const {MapService}=require('../dist/apps/api/src/modules/map/map.service');
const {Character,BattleQueueEntry}=require('../dist/apps/api/src/database/entities');
(async()=>{
 for(const hasActive of [false,true]){
  const now=Date.now();
  const character={id:'hero',status:'grinding',currentMapId:'field',lastGrindStance:'gathering',travelIntent:null,gatheringCycle:{cycleIndex:3},updatedAt:new Date(now),stateVersion:42};
  const active={id:'active',startAt:new Date(now-1000),endAt:new Date(now+10000)};
  const future={id:'future',startAt:new Date(now+20000),endAt:new Date(now+30000)};
  const calls=[];let locked=false;
  const repo={findOne:async()=>character,save:async()=>character};
  const queue={find:async()=>hasActive?[active,future]:[future],delete:async options=>{calls.push('delete');assert(options.id);}};
  const manager={getRepository:entity=>entity===Character?repo:entity===BattleQueueEntry?queue:null};
  const service=Object.create(MapService.prototype);
  service.characterRepo={...repo,manager:{transaction:async fn=>fn(manager)}};
  service.dataService={getMapById:()=>({type:'grind'})};
  service.battleService={cancelPendingEncounterSearch:async()=>calls.push('cancel-search'),withCharacterQueueLock:async(_id,fn)=>{locked=true;try{return await fn()}finally{locked=false}},removeBattleQueueJobs:async ids=>{assert.deepEqual(ids,['future']);calls.push('remove-jobs')},queueBattles:async()=>{assert.equal(character.lastGrindStance,'hunting');calls.push('queue')},publishQueueUpdated:async()=>calls.push('publish')};
  service.scheduleStationaryActivity=async()=>calls.push('stationary');
  const result=await service.setStance('hero','hunting');
  assert.equal(result.lastGrindStance,'hunting');assert.equal(result.stateVersion,42);
  assert(calls.includes('delete'));assert(calls.includes('remove-jobs'));assert(calls.includes('stationary'));
  assert.equal(calls.includes('cancel-search'),!hasActive);
  assert.equal(calls.includes('queue'),!hasActive,'restart the hunting queue immediately when no battle is active');
  assert.equal(calls.includes('publish'),hasActive,'keep the active encounter immutable');
 }
 console.log('stance-switch-queue: Hunting resumes in place and active fights stay immutable');
})().catch(error=>{console.error(error);process.exitCode=1});
