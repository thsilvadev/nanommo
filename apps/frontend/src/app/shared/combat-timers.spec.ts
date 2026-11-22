import { projectCombatTimers, persistentCombatTimers, soloCombatTimers } from './combat-timers';

describe('combat timer projection', () => {
  const start = Date.parse('2026-11-22T12:00:00Z');
  const base = () => ({startAt:new Date(start).toISOString(),tickDurationMs:500,actorId:'hero',snapshot:{cooldowns:{'item:potion':10},cooldownDurations:{'item:potion':20}},events:[] as any[]});
  it('projects carried cooldowns using elapsed time and hides them at zero', () => {
    const rows=projectCombatTimers(base(),start+1000);
    expect(rows[0].id).toBe('potion');expect(rows[0].remainingSeconds).toBe(3.5);expect(rows[0].fraction).toBe(.35);
    expect(projectCombatTimers(base(),start+4500)).toEqual([]);
  });
  it('accounts for the executor decrement at tick zero only for opening cooldowns', () => {
    const input={...base(),snapshot:{cooldowns:{'item:potion':1}}};
    expect(projectCombatTimers(input,start)).toEqual([]);
    input.events=[{tick:0,actorId:'hero',action:'use_item',payload:{cooldown:{key:'item:potion',durationTicks:20}}}];
    expect(projectCombatTimers(input,start)[0].remainingSeconds).toBe(10);
  });
  it('ignores future events, cast starts, fizzles and other actors', () => {
    const input={...base(),snapshot:{},events:[
      {tick:1,actorId:'hero',action:'cast_start',payload:{skillId:'bolt'}},
      {tick:2,actorId:'hero',action:'cast_fizzle',payload:{skillId:'bolt'}},
      {tick:3,actorId:'other',action:'use_skill',payload:{cooldown:{key:'skill:other',durationTicks:20}}},
      {tick:4,actorId:'hero',action:'use_skill',payload:{cooldown:{key:'skill:bolt',durationTicks:9}}},
    ]};
    expect(projectCombatTimers(input,start+1500)).toEqual([]);
    const timer=projectCombatTimers(input,start+2250)[0];
    expect(timer.id).toBe('bolt');expect(timer.fraction).toBeCloseTo(4.25/4.5);expect(timer.remainingSeconds).toBe(4.25);
    expect(projectCombatTimers(input,start+6500)).toEqual([]);
  });
  it('uses server duration instead of rank-one catalogue duration and excludes zero cooldown', () => {
    const input={...base(),snapshot:{skillDefs:{bolt:{cooldownTicks:100},instant:{cooldownTicks:0}}},events:[
      {tick:0,actorId:'hero',action:'use_skill',payload:{skillId:'bolt',cooldown:{key:'skill:bolt',durationTicks:9}}},
      {tick:0,actorId:'hero',action:'use_skill',payload:{skillId:'instant'}},
    ]};
    expect(projectCombatTimers(input,start+1000).map(row=>row.id)).toEqual(['bolt']);
    expect(projectCombatTimers(input,start+4500)).toEqual([]);
  });
  it('shows status duration in seconds, groups stacks and preserves permanent effects', () => {
    const input={...base(),snapshot:{statusEffects:[{type:'poison',expiresAtTick:10},{type:'poison',expiresAtTick:6},{type:'rage'}]}};
    const statuses=projectCombatTimers(input,start+1000).filter(row=>row.kind==='status');
    expect(statuses.find(row=>row.id==='poison')?.remainingSeconds).toBe(4);
    expect(statuses.find(row=>row.id==='poison')?.stacks).toBe(2);
    expect(statuses.find(row=>row.id==='rage')?.remainingSeconds).toBe(Infinity);
    expect(projectCombatTimers(input,start+5000).some(row=>row.id==='poison')).toBeFalse();
  });
  it('replaces statuses from visible authoritative actor states, including removal', () => {
    const input={...base(),snapshot:{statusEffects:[{type:'poison',expiresAtTick:20}]},events:[
      {tick:2,actorId:'other',action:'status_expire',actorStates:{hero:{statusEffects:[]}}},
    ]};
    expect(projectCombatTimers(input,start+500).some(row=>row.id==='poison')).toBeTrue();
    expect(projectCombatTimers(input,start+1000).some(row=>row.id==='poison')).toBeFalse();
  });
  it('continues absolute deadlines outside battle across reloads', () => {
    const source={consumableCooldowns:{'item:potion':new Date(start+10000).toISOString()},statusEffects:[{type:'fontoura',expiresAt:new Date(start+30000).toISOString()}]};
    const rows=persistentCombatTimers(source,start+5000);
    expect(rows.find(row=>row.id==='potion')?.fraction).toBe(.5);
    expect(rows.find(row=>row.id==='fontoura')?.remainingSeconds).toBe(25);
    expect(persistentCombatTimers(source,start+30000)).toEqual([]);
  });
  it('projects legacy status events and cooldowns without exposing a future use', () => {
    const entry={startAt:new Date(start).toISOString(),endAt:new Date(start+30000).toISOString(),tickDurationMs:500,log:{header:{characterSnapshot:{skillDefs:{bolt:{cooldownTicks:8}}}},events:[
      {tick:1,actor:'character',action:'use_skill',skillId:'bolt'},
      {tick:2,target:'character',action:'status_apply',status:'poison',statusEffects:[{type:'poison',expiresAtTick:8}]},
    ]}};
    expect(soloCombatTimers(entry,'character',start)).toEqual([]);
    const rows=soloCombatTimers(entry,'character',start+1000);
    expect(rows.find(row=>row.id==='poison')?.remainingSeconds).toBe(3);
    expect(rows.find(row=>row.id==='bolt')?.remainingSeconds).toBe(4);
  });
  it('uses effective skill duration for persisted cooldowns after a battle', () => {
    const source={consumableCooldowns:{'skill:bolt':new Date(start+3000).toISOString()},cooldownDurations:{'skill:bolt':9}};
    const timer=persistentCombatTimers(source,start+1000)[0];
    expect(timer.id).toBe('bolt');expect(timer.fraction).toBeCloseTo(2/4.5);
  });
  it('does not render precomputed battle effects before battle starts', () => {
    expect(projectCombatTimers(base(),start-1)).toEqual([]);
  });
});
