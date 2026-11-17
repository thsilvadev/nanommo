import { CLIP_SECONDS, characterAnimationState, type AnimationBattleEntry } from './animation-state';

const START = Date.parse('2026-11-17T12:00:00.000Z');
const TICK = 500;
const at = (tick: number, extraMs = 0) => START + tick * TICK + extraMs;

function battle(events: unknown[], options: { endTick?: number; outcome?: 'win' | 'loss'; cancelledAtTick?: number } = {}): AnimationBattleEntry {
  const endTick = options.endTick ?? 60;
  return {
    startAt: new Date(START).toISOString(),
    endAt: new Date(at(endTick)).toISOString(),
    cancelledAt: options.cancelledAtTick === undefined ? null : new Date(at(options.cancelledAtTick)).toISOString(),
    tickDurationMs: TICK,
    outcome: options.outcome ?? 'win',
    log: { events },
  };
}
const attack = (tick: number) => ({ tick, actor: 'character', action: 'attack', target: 'monster', damage: 10, hit: true });
const skill = (tick: number, castStartedAtTick?: number) => ({
  tick, actor: 'character', action: 'use_skill', skillId: 'fireball', target: 'monster', damage: 30, hit: true,
  ...(castStartedAtTick === undefined ? {} : { castStartedAtTick }),
});
const monsterHit = (tick: number, damage = 12, hp = 80) => ({ tick, actor: 'monster', action: 'attack', target: 'character', damage, hit: damage > 0, hpRemaining: { character: hp, monster: 50 } });
const grinding = { status: 'grinding' };

describe('characterAnimationState', () => {
  describe('outside battle', () => {
    it('idles with no character', () => {
      expect(characterAnimationState({ character: null, activeBattle: null, nowMs: START })).toEqual({ base: 'Idle' });
    });

    it('idles in town', () => {
      expect(characterAnimationState({ character: { status: 'town' }, activeBattle: null, nowMs: START })).toEqual({ base: 'Idle' });
    });

    it('walks while grinding with no battle (travelling, gathering, looking for an encounter)', () => {
      expect(characterAnimationState({ character: grinding, activeBattle: null, nowMs: START })).toEqual({ base: 'Walk' });
    });

    it('walks while the next battle has not started yet', () => {
      expect(characterAnimationState({ character: grinding, activeBattle: battle([attack(4)]), nowMs: START - 1 })).toEqual({ base: 'Walk' });
    });

    it('lies dead, on the last frame, while waiting to return', () => {
      const state = characterAnimationState({ character: { status: 'dead_pending_return' }, activeBattle: null, nowMs: START });
      expect(state.oneShot?.clip).toBe('Dead');
      expect(state.oneShot!.startedAtMs).toBeLessThanOrEqual(START - CLIP_SECONDS.Dead * 1000);
    });

    it('walks again after a won battle that has not been resolved yet', () => {
      expect(characterAnimationState({ character: grinding, activeBattle: battle([attack(4)], { endTick: 10 }), nowMs: at(11) })).toEqual({ base: 'Walk' });
    });

    it('walks after fleeing (the battle ends at cancelledAt)', () => {
      expect(characterAnimationState({ character: grinding, activeBattle: battle([attack(4)], { cancelledAtTick: 8 }), nowMs: at(9) })).toEqual({ base: 'Walk' });
    });
  });

  describe('in battle', () => {
    it('holds the combat guard between actions', () => {
      expect(characterAnimationState({ character: grinding, activeBattle: battle([attack(4)]), nowMs: at(1) })).toEqual({ base: 'CombatIdle' });
    });

    it('plays Attack from the tick of a basic attack, at normal speed when the next action is 9 s later', () => {
      const state = characterAnimationState({ character: grinding, activeBattle: battle([attack(4), attack(22)]), nowMs: at(4, 100) });
      expect(state).toEqual({ base: 'CombatIdle', oneShot: { clip: 'Attack', startedAtMs: at(4), speed: 1 } });
    });

    it('speeds Attack up to fit a 1 s interval', () => {
      const state = characterAnimationState({ character: grinding, activeBattle: battle([attack(4), attack(6)]), nowMs: at(4, 100) });
      expect(state.oneShot!.speed).toBeCloseTo(CLIP_SECONDS.Attack / 1, 5);
    });

    it('does not start Attack before its tick, and drops it once the clip is over', () => {
      const entry = battle([attack(4), attack(22)]);
      expect(characterAnimationState({ character: grinding, activeBattle: entry, nowMs: at(4, -1) }).oneShot).toBeUndefined();
      expect(characterAnimationState({ character: grinding, activeBattle: entry, nowMs: at(4) + CLIP_SECONDS.Attack * 1000 + 1 }).oneShot).toBeUndefined();
    });

    it('plays Attack for an instant skill', () => {
      const state = characterAnimationState({ character: grinding, activeBattle: battle([skill(4)]), nowMs: at(4, 50) });
      expect(state.oneShot).toEqual({ clip: 'Attack', startedAtMs: at(4), speed: 1 });
      expect(state.cast).toBeUndefined();
    });

    it('opened in the middle of a cast: casting from its start to its resolution', () => {
      const state = characterAnimationState({ character: grinding, activeBattle: battle([skill(10, 6)]), nowMs: at(8, 230) });
      expect(state).toEqual({ base: 'CombatIdle', cast: { startedAtMs: at(6), endsAtMs: at(10) } });
    });

    it('casts from the very tick the cast starts', () => {
      const state = characterAnimationState({ character: grinding, activeBattle: battle([skill(10, 6)]), nowMs: at(6) });
      expect(state.cast).toEqual({ startedAtMs: at(6), endsAtMs: at(10) });
    });

    it('resolves the cast into Attack on the resolution tick', () => {
      const state = characterAnimationState({ character: grinding, activeBattle: battle([skill(10, 6), attack(28)]), nowMs: at(10, 100) });
      expect(state).toEqual({ base: 'CombatIdle', oneShot: { clip: 'Attack', startedAtMs: at(10), speed: 1 } });
    });

    it('fits the attack before the next cast starts', () => {
      // Attack at tick 4, the next skill starts casting at tick 6 (1 s later).
      const state = characterAnimationState({ character: grinding, activeBattle: battle([attack(4), skill(10, 6)]), nowMs: at(4, 100) });
      expect(state.oneShot!.speed).toBeCloseTo(CLIP_SECONDS.Attack, 5);
    });

    it('flinches on damage without cutting the cast', () => {
      const state = characterAnimationState({ character: grinding, activeBattle: battle([monsterHit(8), skill(10, 6)]), nowMs: at(8, 100) });
      expect(state.cast).toEqual({ startedAtMs: at(6), endsAtMs: at(10) });
      expect(state.hit).toEqual({ clip: 'Damage', startedAtMs: at(8) });
    });

    it('flinches on damage without cutting an Attack', () => {
      const state = characterAnimationState({ character: grinding, activeBattle: battle([attack(4), monsterHit(5), attack(22)]), nowMs: at(5, 50) });
      expect(state.oneShot).toEqual({ clip: 'Attack', startedAtMs: at(4), speed: 1 });
      expect(state.hit?.startedAtMs).toBe(at(5));
    });

    it('alternates the two damage clips by tick and drops the flinch once it is over', () => {
      const entry = battle([monsterHit(9)]);
      expect(characterAnimationState({ character: grinding, activeBattle: entry, nowMs: at(9, 10) }).hit?.clip).toBe('Damage2');
      expect(characterAnimationState({ character: grinding, activeBattle: entry, nowMs: at(9) + CLIP_SECONDS.Damage2 * 1000 + 1 }).hit).toBeUndefined();
    });

    it('does not flinch on a miss or on damage over time', () => {
      const dot = { tick: 8, actor: 'monster', action: 'status_damage', target: 'character', damage: 5, status: 'poison' };
      expect(characterAnimationState({ character: grinding, activeBattle: battle([monsterHit(8, 0)]), nowMs: at(8, 10) }).hit).toBeUndefined();
      expect(characterAnimationState({ character: grinding, activeBattle: battle([dot]), nowMs: at(8, 10) }).hit).toBeUndefined();
    });

    it('dies on the tick its HP reaches zero, and nothing else plays', () => {
      const entry = battle([skill(24, 20), monsterHit(22, 80, 0)], { endTick: 22, outcome: 'loss' });
      const state = characterAnimationState({ character: grinding, activeBattle: entry, nowMs: at(22, 300) });
      expect(state).toEqual({ base: 'CombatIdle', oneShot: { clip: 'Dead', startedAtMs: at(22), speed: 1 } });
    });

    it('stays dead after a lost battle until the server resolves it', () => {
      const entry = battle([monsterHit(22, 80, 0)], { endTick: 22, outcome: 'loss' });
      const state = characterAnimationState({ character: grinding, activeBattle: entry, nowMs: at(40) });
      expect(state.oneShot).toEqual({ clip: 'Dead', startedAtMs: at(22), speed: 1 });
    });

    it('uses the end of a lost battle when the log has no HP data', () => {
      const entry = battle([attack(4)], { endTick: 30, outcome: 'loss' });
      expect(characterAnimationState({ character: grinding, activeBattle: entry, nowMs: at(31) }).oneShot).toEqual({ clip: 'Dead', startedAtMs: at(30), speed: 1 });
    });

    it('is a pure function of time: the same instant gives the same pose whatever came before', () => {
      const entry = battle([attack(2), monsterHit(5), skill(12, 8), attack(20)]);
      const instants = [at(1), at(2, 10), at(5, 10), at(9), at(12, 1), at(20, 400)];
      const forward = instants.map((nowMs) => characterAnimationState({ character: grinding, activeBattle: entry, nowMs }));
      const backward = [...instants].reverse().map((nowMs) => characterAnimationState({ character: grinding, activeBattle: entry, nowMs })).reverse();
      expect(backward).toEqual(forward);
    });
  });
});
