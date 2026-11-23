import { monsterAnimationState, monsterAsCharacterState } from './monster-animation-state';

describe('monsterAnimationState', () => {
  const startAt = '2026-01-01T00:00:00.000Z';
  const t0 = Date.parse(startAt);
  const battle = (events: unknown[], outcome = 'win') => ({ startAt, endAt: '2026-01-01T00:00:10.000Z', tickDurationMs: 500, outcome, log: { events } });
  const events = [
    { tick: 2, actor: 'character', target: 'monster', action: 'attack', damage: 5, hpRemaining: { character: 30, monster: 10 } },
    { tick: 4, actor: 'monster', target: 'character', action: 'attack', damage: 3, hpRemaining: { character: 27, monster: 10 } },
    { tick: 8, actor: 'monster', target: 'character', action: 'use_skill', damage: 6, hpRemaining: { character: 21, monster: 10 } },
    { tick: 12, actor: 'character', target: 'monster', action: 'attack', damage: 10, hpRemaining: { character: 21, monster: 0 } },
  ];

  it('is idle before the battle and without one', () => {
    expect(monsterAnimationState(null, t0)).toEqual({});
    expect(monsterAnimationState(battle(events), t0 - 1)).toEqual({});
  });
  it('flinches on the character hit and attacks on its own strike, sped up to the next one', () => {
    expect(monsterAnimationState(battle(events), t0 + 1100).hit).toEqual({ startedAtMs: t0 + 1000 });
    // the swing opens 450 ms before its hit, so the middle of the clip (the blow) lands on the hit tick
    expect(monsterAnimationState(battle(events), t0 + 1600).action).toEqual({ clip: 'Attack', startedAtMs: t0 + 1550, impactAtMs: t0 + 2000, endsAtMs: t0 + 2450 });
    expect(monsterAnimationState(battle(events), t0 + 2500).action).toBeUndefined();
    expect(monsterAnimationState(battle(events), t0 + 3600).action).toEqual({ clip: 'Cast', startedAtMs: t0 + 3550, impactAtMs: t0 + 4000, endsAtMs: t0 + 4450 });
  });
  it('dies on the killing blow and stays dead', () => {
    expect(monsterAnimationState(battle(events), t0 + 6000)).toEqual({ dead: { startedAtMs: t0 + 6000 } });
    expect(monsterAnimationState(battle(events), t0 + 60000)).toEqual({ dead: { startedAtMs: t0 + 6000 } });
  });
  it('walks while it steps across the grid, and stops after its last step', () => {
    const moving = battle([
      { tick: 1, actor: 'monster', action: 'move', hpRemaining: { character: 30, monster: 10 } },
      { tick: 4, actor: 'monster', action: 'move', hpRemaining: { character: 30, monster: 10 } },
      { tick: 20, actor: 'monster', target: 'character', action: 'attack', damage: 1, hpRemaining: { character: 29, monster: 10 } },
    ]);
    expect(monsterAnimationState(moving, t0 + 400).walking).toBeUndefined();
    expect(monsterAnimationState(moving, t0 + 600).walking).toBeTrue();   // first step, walking to the second
    expect(monsterAnimationState(moving, t0 + 2400).walking).toBeTrue();  // last step lasts 3 ticks
    expect(monsterAnimationState(moving, t0 + 3600).walking).toBeUndefined();
  });
  it('maps to character clips for a monster drawn as a character', () => {
    expect(monsterAsCharacterState({ walking: true }, t0)).toEqual({ base: 'Walk' });
    expect(monsterAsCharacterState({ dead: { startedAtMs: t0 } }, t0 + 1).oneShot?.clip).toBe('Dead');
    expect(monsterAsCharacterState({ action: { clip: 'Attack', startedAtMs: t0, impactAtMs: t0 + 450, endsAtMs: t0 + 900 } }, t0 + 100).oneShot?.speed).toBeCloseTo(1.533 / 0.9, 3);
    expect(monsterAsCharacterState({ action: { clip: 'Cast', startedAtMs: t0, impactAtMs: t0 + 2000, endsAtMs: t0 + 2200 } }, t0 + 100).cast).toEqual({ startedAtMs: t0, endsAtMs: t0 + 2000 });
  });
  it('fills a V2 cast window (cast_start … use_skill) and ends when the skill resolves', () => {
    const casting = battle([
      { tick: 10, actor: 'monster', action: 'cast_start', hpRemaining: { character: 30, monster: 10 } },
      { tick: 14, actor: 'monster', target: 'character', action: 'use_skill', damage: 9, hpRemaining: { character: 21, monster: 10 } },
    ]);
    expect(monsterAnimationState(casting, t0 + 5100).action).toEqual({ clip: 'Cast', startedAtMs: t0 + 5000, impactAtMs: t0 + 7000, endsAtMs: t0 + 7200 });
    expect(monsterAnimationState(casting, t0 + 7300).action).toBeUndefined();
  });
});
