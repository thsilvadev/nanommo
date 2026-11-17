import { SharedBattleView, sharedActorResources, sharedCurrentTarget, visibleSharedEvents, teleportProgress, isSharedBattleCurrent } from './party-projection';

describe('public shared battle projection', () => {
  const battle: SharedBattleView = {
    id: 'battle', revision: 1, startAt: '2026-11-17T12:00:00.000Z', endAt: '2026-11-17T12:00:10.000Z', state: 'started',
    snapshot: { tickDurationMs: 500, actors: [
      { id: 'hero', kind: 'character', team: 'a', snapshot: { hp: 90, sp: 40, maxHp: 100, maxSp: 50 } },
      { id: 'wolf-1', kind: 'monster', team: 'b', snapshot: { hp: 70, sp: 20, maxHp: 70, maxSp: 20 } },
      { id: 'wolf-2', kind: 'monster', team: 'b', snapshot: { hp: 70, sp: 20, maxHp: 70, maxSp: 20 } },
    ] },
    log: { events: [
      { tick: 1, actorId: 'hero', targetIds: ['wolf-1'], action: 'attack', payload: { damage: 10, hpRemaining: { hero: 90, 'wolf-1': 60 } } },
      { tick: 1, actorId: 'wolf-2', targetIds: ['hero'], action: 'attack', payload: { damage: 20, hpRemaining: { hero: 70 } } },
      { tick: 3, actorId: 'hero', targetIds: ['wolf-2'], action: 'attack', payload: { damage: 10, spRemaining: { hero: 35 } } },
    ] },
  };
  const start = Date.parse(battle.startAt);
  it('keeps simultaneous actor events in server order and hides future events', () => {
    expect(visibleSharedEvents(battle, start + 500).map(event => event.actorId)).toEqual(['hero', 'wolf-2']);
    expect(visibleSharedEvents(battle, start - 1)).toEqual([]);
  });
  it('projects only server-confirmed resources at the visible tick', () => {
    expect(sharedActorResources(battle, 'hero', start + 500)).toEqual({ hp: 70, sp: 40 });
    expect(sharedActorResources(battle, 'hero', start + 1500)).toEqual({ hp: 70, sp: 35 });
  });
  it('updates the individual current target only when that actor acts', () => {
    expect(sharedCurrentTarget(battle, 'hero', start + 500)).toBe('wolf-1');
    expect(sharedCurrentTarget(battle, 'hero', start + 1500)).toBe('wolf-2');
  });
  it('uses authoritative actor states for resources and target changes', () => {
    const authoritative: SharedBattleView={...battle,log:{events:[{tick:2,actorId:'hero',targetIds:['wolf-2'],action:'target_changed',actorStates:{hero:{hp:45,sp:12,targetId:'wolf-2'}},payload:{type:'target'}}]}};
    expect(sharedActorResources(authoritative,'hero',start+1000)).toEqual({hp:45,sp:12});
    expect(sharedCurrentTarget(authoritative,'hero',start+1000)).toBe('wolf-2');
  });
  it('preserves accumulated teleport progress while paused and resumes from the accrual timestamp', () => {
    const teleport={elapsedMs:3500,lastAccruedAt:battle.startAt,paused:true};
    expect(teleportProgress(teleport,start+5000)).toBe(35);
    expect(teleportProgress({...teleport,paused:false},start+2000)).toBe(55);
    expect(teleportProgress({...teleport,paused:false,lastAccruedAt:start},start+2000)).toBe(55);
  });
  it('does not keep a finished shared battle over a newer solo encounter', () => {
    expect(isSharedBattleCurrent({...battle,state:'resolved'},start+1000)).toBeFalse();
    expect(isSharedBattleCurrent(battle,start+10000)).toBeFalse();
    expect(isSharedBattleCurrent(battle,start+1000)).toBeTrue();
  });
});
