const assert = require('node:assert/strict');
const { In } = require('typeorm');
const { BattleRecoveryService } = require('../dist/apps/api/src/modules/battle/battle-recovery.service');

function makeJob(id, name, data, initialState='waiting') {
  return { id, name, data, state:initialState, removed:false, async getState(){return this.state;}, async remove(){if(this.state==='active')throw new Error('active job cannot be removed');this.removed=true;jobMap.delete(String(id));} };
}
const now=Date.now();
const characters=[
  {id:'town',status:'town',currentMapId:'map_town',pendingMapTransition:null,lastSeenAt:new Date(now),stateVersion:3},
  {id:'grind',status:'grinding',currentMapId:'map_lv_1',pendingMapTransition:null,lastSeenAt:new Date(now),stateVersion:4},
  {id:'transition',status:'town',currentMapId:'map_town',pendingMapTransition:{destinationMapId:'map_town',reason:'town_request'},lastSeenAt:new Date(now),stateVersion:5},
  {id:'missing-job',status:'grinding',currentMapId:'map_lv_6',pendingMapTransition:null,lastSeenAt:new Date(now),stateVersion:6},
  {id:'invalid-map',status:'grinding',currentMapId:'map_deleted',pendingMapTransition:null,lastSeenAt:new Date(now),stateVersion:7},
  {id:'future-only',status:'grinding',currentMapId:'map_lv_1',pendingMapTransition:null,lastSeenAt:new Date(now),stateVersion:8},
  {id:'dead',status:'dead_pending_return',currentMapId:'map_lv_6',pendingMapTransition:null,lastSeenAt:new Date(now),stateVersion:9},
];
const battles=[
  {id:'town-stale',characterId:'town',mapId:'map_lv_1',startAt:new Date(now+60000),endAt:new Date(now+120000),sequenceIndex:0,resolved:false},
  {id:'grind-live',characterId:'grind',mapId:'map_lv_1',startAt:new Date(now-1000),endAt:new Date(now+60000),sequenceIndex:0,resolved:false},
  {id:'grind-wrong-map',characterId:'grind',mapId:'map_lv_6',startAt:new Date(now+120000),endAt:new Date(now+180000),sequenceIndex:1,resolved:false},
  {id:'transition-active',characterId:'transition',mapId:'map_lv_1',startAt:new Date(now-5000),endAt:new Date(now+50000),sequenceIndex:0,resolved:false},
  {id:'transition-future',characterId:'transition',mapId:'map_lv_1',startAt:new Date(now+50000),endAt:new Date(now+110000),sequenceIndex:1,resolved:false},
  {id:'transition-stale-active',characterId:'transition',mapId:'map_lv_1',startAt:new Date(now-10000),endAt:new Date(now-1000),sequenceIndex:0,resolved:false},
  {id:'missing-resolve-job',characterId:'missing-job',mapId:'map_lv_6',startAt:new Date(now+10000),endAt:new Date(now+70000),sequenceIndex:0,resolved:false},
  {id:'invalid-map-row',characterId:'invalid-map',mapId:'map_deleted',startAt:new Date(now+10000),endAt:new Date(now+70000),sequenceIndex:0,resolved:false},
  {id:'orphan-row',characterId:'deleted-character',mapId:'map_lv_1',startAt:new Date(now+10000),endAt:new Date(now+70000),sequenceIndex:0,resolved:false},
  {id:'future-only-row',characterId:'future-only',mapId:'map_lv_1',startAt:new Date(now+30000),endAt:new Date(now+90000),sequenceIndex:0,resolved:false},
  {id:'resolved-history',characterId:'town',mapId:'map_lv_1',startAt:new Date(now-120000),endAt:new Date(now-60000),sequenceIndex:0,resolved:true},
];
const jobMap=new Map();
jobMap.set('town-stale',makeJob('town-stale','resolve-battle',{battleId:'town-stale'}));
jobMap.set('grind-live',makeJob('grind-live','resolve-battle',{battleId:'grind-live'}));
jobMap.set('grind-wrong-map',makeJob('grind-wrong-map','resolve-battle',{battleId:'grind-wrong-map'}));
jobMap.set('transition-active',makeJob('transition-active','resolve-battle',{battleId:'transition-active'}));
jobMap.set('transition-future',makeJob('transition-future','resolve-battle',{battleId:'transition-future'}));
jobMap.set('transition-stale-active',makeJob('transition-stale-active','resolve-battle',{battleId:'transition-stale-active'},'active'));
jobMap.set('invalid-queue-town',makeJob('invalid-queue-town','queue-battles',{characterId:'town'}));
jobMap.set('invalid-queue-transition',makeJob('invalid-queue-transition','queue-battles',{characterId:'transition'}));
jobMap.set('orphan-row',makeJob('orphan-row','resolve-battle',{battleId:'orphan-row'}));
jobMap.set('future-only-row',makeJob('future-only-row','resolve-battle',{battleId:'future-only-row'}));
jobMap.set('invalid-queue-map',makeJob('invalid-queue-map','queue-battles',{characterId:'invalid-map'}));
const queue={
  async getJobs(){return [...jobMap.values()].filter(job=>!job.removed);},
  async getJob(id){return jobMap.get(String(id))??null;},
  async add(name,data,opts){if(jobMap.has(String(opts.jobId)))return jobMap.get(String(opts.jobId));const job=makeJob(String(opts.jobId),name,data,opts.delay>0?'delayed':'waiting');jobMap.set(String(opts.jobId),job);return job;},
};
const characterRepo={
  async find(){return characters;},
  async save(c){c.saved=true;return c;},
};
const battleRepo={
  async find({where,order}={}){const result=battles.filter(row=>Object.entries(where??{}).every(([key,value])=>row[key]===value));if(order?.startAt==='ASC')result.sort((a,b)=>String(a.characterId).localeCompare(String(b.characterId))||a.startAt-b.startAt||a.sequenceIndex-b.sequenceIndex);return result;},
  async findOne({where}={}){return battles.find(row=>Object.entries(where??{}).every(([key,value])=>row[key]===value))??null;},
  async delete(where){const raw=where.id?.value??where.id?._value??where.id;const ids=new Set(Array.isArray(raw)?raw:[raw]);let count=0;for(let i=battles.length-1;i>=0;i--)if(ids.has(battles[i].id)&&battles[i].resolved===false){battles.splice(i,1);count++;}return {affected:count};},
};
const service=Object.create(BattleRecoveryService.prototype);
service.characterRepo=characterRepo;service.battleQueueRepo=battleRepo;service.bullQueue=queue;
const topUps=[];
service.battleService={async getBattleQueue(){return [{resolved:false}];},async queueBattles(id){topUps.push(id);}};
service.dataService={getMapById:id=>id==='map_town'?{id,type:'town'}:['map_lv_1','map_lv_6'].includes(id)?{id,type:'grind'}:null};
service.logger={log(){},warn(){},error(){}};

(async()=>{
  const result=await service.reconcilePersistedQueueAndJobs();
  assert.equal(result.removedRows,6,'remove Town future, wrong-map, later transition, invalid-map, and orphan queue rows');
  assert.equal(battles.some(row=>row.id==='town-stale'),false);
  assert.equal(battles.some(row=>row.id==='grind-wrong-map'),false);
  assert.equal(battles.some(row=>row.id==='transition-future'),false);
  assert.equal(battles.some(row=>row.id==='transition-stale-active'),true,'the earliest already-started row survives, even if its delayed job is currently active');
  assert.equal(battles.some(row=>row.id==='transition-active'),false,'later unresolved projections are removed even if they would otherwise appear active after an inconsistent schedule');
  assert.equal(battles.some(row=>row.id==='grind-live'),true);
  assert.equal(battles.some(row=>row.id==='future-only-row'),true,'valid Grind character with only future projections remains eligible');
  assert.equal(battles.some(row=>row.id==='orphan-row'),false,'queue rows without a Character are removed');
  assert.equal(battles.some(row=>row.id==='resolved-history'),true,'resolved battle history remains untouched');
  assert.equal(characters.find(c=>c.id==='transition').currentMapId,'map_town');
  assert.equal(characters.find(c=>c.id==='transition').status,'town');
  assert.deepEqual(characters.find(c=>c.id==='transition').pendingMapTransition,{destinationMapId:'map_town',reason:'town_request'});
  assert.equal(characters.find(c=>c.id==='invalid-map').currentMapId,'map_town');
  assert.equal(characters.find(c=>c.id==='invalid-map').status,'town');
  assert.equal(characters.find(c=>c.id==='dead').currentMapId,'map_town','dead/pending-return statuses are settled in Town');
  assert.equal(characters.find(c=>c.id==='dead').status,'town');
  assert.equal(characters.find(c=>c.id==='town').currentMapId,'map_town','already-Town characters remain settled in Town');
  assert.equal(jobMap.has('town-stale'),false);
  assert.equal(jobMap.has('grind-wrong-map'),false);
  assert.equal(jobMap.has('transition-future'),false);
  assert.equal(jobMap.has('transition-stale-active'),true,'already-active job for the preserved earliest battle is preserved');
  assert.equal(jobMap.has('transition-active'),false,'non-active job for a discarded later projection is removed');
  assert.equal(jobMap.has('invalid-queue-town'),false);
  assert.equal(jobMap.has('invalid-queue-transition'),false);
  assert.equal(jobMap.has('invalid-queue-map'),false);
  assert.equal(jobMap.has('future-only-row'),true,'valid future Grind resolve job remains scheduled');
  assert.equal(jobMap.has('orphan-row'),false,'orphan battle job is removed');
  assert.equal(jobMap.has('missing-resolve-job'),true,'missing delayed resolver is re-created for every live DB battle');
  assert.equal(jobMap.get('missing-resolve-job').name,'resolve-battle');
  assert.equal(jobMap.get('missing-resolve-job').data.battleId,'missing-resolve-job');
  const repeated=await service.reconcilePersistedQueueAndJobs();
  assert.equal(repeated.removedRows,0,'reconciliation is idempotent after the first successful pass');
  assert.equal(battles.some(row=>row.id==='resolved-history'),true,'second reconciliation never alters resolved history');
  const toppedUp=await service.topUpQueues();
  assert.equal(toppedUp,3,'only characters whose current state is a valid Grind map receive top-up');
  assert.deepEqual(topUps.sort(),['future-only','grind','missing-job']);
  console.log('battle-queue-reconciliation: passed stale row/job cleanup, active battle preservation, Town/transition guards, map mismatch repair and missing resolver repair');
})().catch(error=>{console.error(error);process.exit(1)});
