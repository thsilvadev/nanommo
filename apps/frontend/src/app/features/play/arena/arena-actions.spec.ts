import { ARROW_FLIGHT_SECONDS, CLIP_SECONDS } from '../../../shared/character-animation/animation-state';
import { MONSTER_ATTACK_LEAD_MS } from '../../../shared/monster-viewer/monster-animation-state';
import { flashColor } from '../../../shared/battle-hit-feedback';
import { fromSoloEntry } from './arena-battle';
import { ARENA_FEEDBACK_MS, projectArenaBattle } from './arena-actions';
import type { ArenaBattle, ArenaEvent } from './arena.types';
import { SOLO_V2_ENTRY } from './fixtures/solo-v2.fixture';

const solo = (): ArenaBattle => fromSoloEntry(SOLO_V2_ENTRY, { id: 'char-self', look: null, attackStyle: 'bow' })!;
const BEE = 'monster:mon_mutantbee:0';
const at = (b: ArenaBattle, tick: number) => b.startAtMs + tick * b.tickMs;
const actor = (b: ArenaBattle, id: string, now: number) => projectArenaBattle(b, now).actors.find((a) => a.id === id)!;

type Ev = Partial<ArenaEvent> & { tick: number; actorId: string; action: string };
/** a (team a, melee character) vs b (team b, melee monster) side by side, with hand-written events. */
function tiny(events: Ev[], opts: { aStyle?: 'melee' | 'bow'; ally?: boolean } = {}): ArenaBattle {
  const unit = (id: string, team: 'a' | 'b', kind: 'character' | 'monster', column: number, row = 5) => ({
    id, team, kind, name: id, start: { row, column }, maxHp: 100, maxSp: 10, hp: 100, sp: 10,
    monsterId: kind === 'monster' ? 'mon_slime' : null, look: null, attackStyle: id === 'a' ? opts.aStyle ?? 'melee' : 'melee' as const, moveSpeed: 100,
  });
  return {
    id: 't', startAtMs: 100_000, endAtMs: 130_000, tickMs: 500, flee: null, outcome: null, selfId: 'a', mapId: 'map_green_grounds_0',
    actors: [unit('a', 'a', 'character', 4), unit('b', 'b', 'monster', 5), ...(opts.ally ? [unit('c', 'a', 'character', 4, 4)] : [])],
    events: events.map((e) => ({ targetIds: [], payload: {}, ...e })) as ArenaEvent[],
  };
}
const hp = (id: string, value: number) => ({ [id]: { hp: value, sp: 10 } });

describe('projectArenaBattle', () => {
  it('a melee swing starts on its hit tick', () => {
    const b = tiny([{ tick: 4, actorId: 'a', action: 'attack', targetIds: ['b'], payload: { type: 'action', damage: 12, hit: true } }]);
    const a = actor(b, 'a', at(b, 4) + 300);
    expect(a.anim.oneShot?.clip).toBe('Attack');
    expect(a.anim.oneShot?.startedAtMs).toBe(at(b, 4));
  });

  it('a bow arrow lands on the hit', () => {
    const b = solo();
    const shot = b.events.filter((e) => e.actorId === 'char-self' && e.action === 'attack')[3];
    const hitAt = at(b, shot.tick);
    const a = actor(b, 'char-self', hitAt - 100);
    expect(a.projectile).toEqual({ fromId: 'char-self', toId: BEE, launchAtMs: hitAt - ARROW_FLIGHT_SECONDS * 1000, hitAtMs: hitAt });
    expect(actor(b, 'char-self', hitAt + 1).projectile).toBeNull();
  });

  it('a monster swing leads its hit', () => {
    const b = solo();
    const bite = b.events.find((e) => e.actorId === BEE && e.action === 'attack')!;
    const bee = actor(b, BEE, at(b, bite.tick) - 100);
    expect(bee.anim.oneShot?.clip).toBe('Attack');
    expect(bee.anim.oneShot!.startedAtMs).toBe(at(b, bite.tick) - MONSTER_ATTACK_LEAD_MS);
  });

  it('a cast bar spans the cast start to its resolve', () => {
    const b = tiny([
      { tick: 2, actorId: 'a', action: 'cast_start', targetIds: ['b'], payload: { type: 'cast', skillId: 'fire_ball', resolvesAtTick: 6 } },
      { tick: 6, actorId: 'a', action: 'use_skill', targetIds: ['b'], payload: { type: 'action', skillId: 'fire_ball', damage: 30, hit: true } },
    ]);
    const a = actor(b, 'a', at(b, 4));
    expect(a.cast).toEqual({ startedAtMs: at(b, 2), endsAtMs: at(b, 6), skillId: 'fire_ball' });
    expect(a.anim.cast).toEqual({ startedAtMs: at(b, 2), endsAtMs: at(b, 6) });
    expect(actor(b, 'a', at(b, 6) + 1).cast).toBeNull();
  });

  it('floating numbers: own side flashes white, the foe red, a crit is critical, a miss says Miss, a heal is green text', () => {
    const b = tiny([
      { tick: 2, actorId: 'b', action: 'attack', targetIds: ['a'], payload: { type: 'action', damage: 7, hit: true }, actorStates: hp('a', 93) },
      { tick: 3, actorId: 'a', action: 'attack', targetIds: ['b'], payload: { type: 'action', damage: 21, hit: true, crit: true }, actorStates: hp('b', 79) },
      { tick: 3, actorId: 'b', action: 'attack', targetIds: ['a'], payload: { type: 'action', damage: 0, hit: false } },
      { tick: 4, actorId: 'a', action: 'use_item', targetIds: ['a'], payload: { type: 'action', healAmount: 40 } },
    ]);
    const fb = projectArenaBattle(b, at(b, 4) + 10).feedback;
    expect(fb.map((f) => [f.targetId, f.text, f.style, f.flash])).toEqual([
      ['a', '7', 'character-damage', 'white'],
      ['b', '21', 'critical', 'red'],
      ['a', 'Miss', 'miss', null],
      ['a', '+40', 'heal', null],
    ]);
  });

  it('damage over time flashes by status: poison green, burn orange, bleed dark red', () => {
    const tick = (t: number, statusId: string, target: string) => ({ tick: t, actorId: target, action: 'status_tick', targetIds: [target], payload: { type: 'status', statusId, damage: 3 } });
    const b = tiny([tick(2, 'poison', 'b'), tick(2, 'burn', 'a'), tick(2, 'bleed', 'b')]);
    const fb = projectArenaBattle(b, at(b, 2) + 10).feedback;
    expect(fb.map((f) => [f.targetId, f.style, f.flash])).toEqual([['b', 'poison', 'green'], ['a', 'dot', 'orange'], ['b', 'bleed', 'darkred']]);
  });

  it('feedback expires after 1100 ms', () => {
    const b = tiny([{ tick: 2, actorId: 'a', action: 'attack', targetIds: ['b'], payload: { type: 'action', damage: 5, hit: true } }]);
    expect(projectArenaBattle(b, at(b, 2) + ARENA_FEEDBACK_MS - 1).feedback.length).toBe(1);
    expect(projectArenaBattle(b, at(b, 2) + ARENA_FEEDBACK_MS).feedback.length).toBe(0);
  });

  it('a hit taken plays a flinch', () => {
    const b = tiny([{ tick: 2, actorId: 'b', action: 'attack', targetIds: ['a'], payload: { type: 'action', damage: 5, hit: true } }]);
    expect(actor(b, 'a', at(b, 2) + 100).anim.hit?.startedAtMs).toBe(at(b, 2));
    expect(actor(b, 'a', at(b, 2) + CLIP_SECONDS.Damage2 * 1000 + 1).anim.hit).toBeUndefined();
  });

  it('a stunned actor holds the Stun pose frozen at the stun start', () => {
    const b = tiny([{ tick: 2, actorId: 'a', action: 'status_apply', targetIds: ['b'], payload: { type: 'status', statusId: 'stun' }, actorStates: { b: { hp: 100, sp: 10, statusEffects: [{ type: 'stun' }] } } }]);
    const foe = actor(b, 'b', at(b, 5));
    expect(foe.anim.oneShot).toEqual({ clip: 'Stun', startedAtMs: at(b, 2), speed: 1 });
    expect(foe.anim.freezeAtMs).toBe(at(b, 2));
  });

  it('a frozen actor keeps its pose: freezeAtMs at the freeze start', () => {
    const b = tiny([{ tick: 3, actorId: 'a', action: 'status_apply', targetIds: ['b'], payload: { type: 'status', statusId: 'freeze' }, actorStates: { b: { hp: 100, sp: 10, statusEffects: [{ type: 'freeze' }] } } }]);
    expect(actor(b, 'b', at(b, 6)).anim.freezeAtMs).toBe(at(b, 3));
    expect(actor(b, 'b', at(b, 6)).anim.oneShot).toBeUndefined();
  });

  it('the dead play Dead from their death and the battle reports a wipe when all of team a is down', () => {
    const b = tiny([
      { tick: 2, actorId: 'b', action: 'attack', targetIds: ['a'], payload: { type: 'action', damage: 100, hit: true }, actorStates: { ...hp('a', 0), ...hp('c', 50) } },
      { tick: 4, actorId: 'b', action: 'attack', targetIds: ['c'], payload: { type: 'action', damage: 50, hit: true }, actorStates: { ...hp('a', 0), ...hp('c', 0) } },
    ], { ally: true });
    expect(actor(b, 'a', at(b, 3)).anim.oneShot).toEqual({ clip: 'Dead', startedAtMs: at(b, 2), speed: 1 });
    expect(projectArenaBattle(b, at(b, 3)).wiped).toBeFalse();
    expect(projectArenaBattle(b, at(b, 4)).wiped).toBeTrue();
  });

  it('walking and fleeing pick the base loop', () => {
    const b = solo();
    const step = b.events.filter((e) => e.actorId === BEE && e.action === 'move')[2];
    expect(actor(b, BEE, at(b, step.tick) - 200).anim.base).toBe('Walk');
    const fled = { ...b, flee: { atMs: b.startAtMs + 2000 } };
    expect(actor(fled, 'char-self', fled.flee.atMs + 300).anim.base).toBe('Sprint');
    expect(projectArenaBattle(fled, fled.flee.atMs + 1).ended).toBeTrue();
    expect(projectArenaBattle(b, b.endAtMs - 1).ended).toBeFalse();
  });
});

describe('flashColor', () => {
  it('maps team and status to a colour', () => {
    expect(flashColor({ action: 'attack' }, true)).toBe('white');
    expect(flashColor({ action: 'attack' }, false)).toBe('red');
    expect(flashColor({ action: 'status_tick', status: 'poison' }, true)).toBe('green');
    expect(flashColor({ action: 'status_tick', status: 'burn' }, false)).toBe('orange');
    expect(flashColor({ action: 'status_tick', status: 'bleed' }, false)).toBe('darkred');
  });
});
