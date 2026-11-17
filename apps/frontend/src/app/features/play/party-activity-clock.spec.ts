import { MapBoard } from './components';

describe('world activity display during shared combat',()=>{
  it('pauses travel and excludes authoritative shared battle time from gathering progress',()=>{
    const start=Date.parse('2026-11-17T12:00:00Z');
    const board:any=Object.create(MapBoard.prototype);
    Object.assign(board,{party:{battle:()=>({id:'shared',state:'started',startAt:new Date(start+2000).toISOString(),endAt:new Date(start+7000).toISOString()})},battle:{active:()=>null,queue:()=>[],recentBattleIntervals:()=>[]}});
    expect(board.activeBattleAt(start+4000)).toBeTrue();
    expect(board.activeBattleAt(start+1000)).toBeFalse();
    expect(board.nonBattleElapsedSeconds(start,start+10000)).toBe(5);
  });
  it('uses persisted party-route progress during pause and after resuming',()=>{
    const board:any=Object.create(MapBoard.prototype);let now=12000;
    const route:any={kind:'route',segmentStartedAt:0,segmentDueAt:20000,remainingMs:12000,paused:true};
    Object.assign(board,{activityNow:()=>now,party:{party:()=>({routeActivity:route}),battle:()=>null},battle:{active:()=>null,queue:()=>[],recentBattleIntervals:()=>[]},character:{character:()=>({travelIntent:{partyId:'p',lastDurationSeconds:20,segmentProgress:0,lastAccruedAt:new Date(0).toISOString()}})}});
    expect(board.activityProgress()).toBe(40);
    route.paused=false;route.segmentDueAt=24000;now=16000;
    expect(board.activityProgress()).toBe(60);
  });
});
