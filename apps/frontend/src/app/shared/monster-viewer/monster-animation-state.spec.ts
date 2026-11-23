import { monsterAnimationState } from './monster-animation-state';

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
    expect(monsterAnimationState(battle(events), t0 + 2100).action).toEqual({ clip: 'Attack', startedAtMs: t0 + 2000, untilMs: t0 + 4000 });
    expect(monsterAnimationState(battle(events), t0 + 4100).action).toEqual({ clip: 'Cast', startedAtMs: t0 + 4000, untilMs: null });
  });
  it('dies on the killing blow and stays dead', () => {
    expect(monsterAnimationState(battle(events), t0 + 6000)).toEqual({ dead: { startedAtMs: t0 + 6000 } });
    expect(monsterAnimationState(battle(events), t0 + 60000)).toEqual({ dead: { startedAtMs: t0 + 6000 } });
  });
});
