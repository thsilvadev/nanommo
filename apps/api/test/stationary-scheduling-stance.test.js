const assert=require('node:assert/strict');
const {MapService}=require('../dist/apps/api/src/modules/map/map.service');
(async()=>{
 let locked=false;const saved=[];
 const svc=Object.create(MapService.prototype);
 Object.assign(svc,{battleService:{withCharacterQueueLock:async(_id,fn)=>{locked=true;try{return await fn();}finally{locked=false;}}},characterRepo:{findOne:async()=>{assert(locked,'stationary scheduling must serialize with stance changes');return{id:'c',status:'grinding',currentMapId:'map',lastGrindStance:'hunting',gatheringCycle:{cycleIndex:0}};},save:async row=>saved.push(row),update:async(_id,patch)=>saved.push(patch)},dataService:{getMapById:()=>({type:'grind'})},bullQueue:{add:async()=>{assert(locked);}},logger:{log:()=>{}}});
 await svc.scheduleStationaryActivity('c');
 assert.equal(saved.length,1);assert(!('lastGrindStance' in saved[0]),'scheduling cannot overwrite stance from a stale character snapshot');
 console.log('stationary-scheduling-stance passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
