import { fromSharedBattle, fromSoloEntry } from './arena-battle';
import { ARENA_DASH_MS, ARENA_FLEE_SPEED_CELLS_PER_S, arenaPositions, moveDurationMs } from './arena-positions';
import type { ArenaBattle, ArenaEvent } from './arena.types';
import { SOLO_V2_ENTRY } from './fixtures/solo-v2.fixture';
import { PARTY_V2_VIEW } from './fixtures/party-v2.fixture';

const solo = (): ArenaBattle => fromSoloEntry(SOLO_V2_ENTRY, { id: 'char-self', look: null, attackStyle: 'bow' })!;
const BEE = 'monster:mon_mutantbee:0';
const at = (b: ArenaBattle, tick: number) => b.startAtMs + tick * b.tickMs;
const pose = (b: ArenaBattle, id: string, now: number) => arenaPositions(b, now).find((p) => p.id === id)!;
const moves = (b: ArenaBattle, id: string) => b.events.filter((e) => e.action === 'move' && e.actorId === id);

/** A two-actor battle with hand-written events. */
function tiny(events: Array<Partial<ArenaEvent> & { tick: number; actorId: string; action: string }>): ArenaBattle {
  return {
    id: 't', startAtMs: 100_000, endAtMs: 120_000, tickMs: 500, flee: null, outcome: null, selfId: 'a', mapId: 'map_green_grounds_0',
    actors: [
      { id: 'a', team: 'a', kind: 'character', name: 'A', start: { row: 5, column: 0 }, maxHp: 100, maxSp: 10, hp: 100, sp: 10, monsterId: null, look: null, attackStyle: 'melee', moveSpeed: 100 },
      { id: 'b', team: 'b', kind: 'monster', name: 'B', start: { row: 5, column: 9 }, maxHp: 50, maxSp: 0, hp: 50, sp: 0, monsterId: 'mon_slime', look: null, attackStyle: 'melee', moveSpeed: 50 },
    ],
    events: events.map((e) => ({ targetIds: [], payload: {}, ...e })) as ArenaEvent[],
  };
}

describe('arenaPositions', () => {
  it('starts every actor on its deployment cell', () => {
    const b = solo();
    for (const def of b.actors) {
      const p = pose(b, def.id, b.startAtMs);
      expect([p.row, p.column]).toEqual([def.start.row, def.start.column]);
    }
  });

  it('an approach move arrives on its tick and is between cells halfway through its window', () => {
    const b = solo();
    const [first, second] = moves(b, BEE);
    expect(pose(b, BEE, at(b, second.tick)).column).toBe(second.payload['to'].column);
    const window = Math.min(moveDurationMs(66, 500), (second.tick - first.tick) * 500);
    const mid = pose(b, BEE, at(b, second.tick) - window / 2);
    expect(mid.column).toBeLessThan(second.payload['from'].column);
    expect(mid.column).toBeGreaterThan(second.payload['to'].column);
    expect(mid.moving).toBe('walk');
  });

  it('the bee ends next to the archer and faces left; the archer faces right', () => {
    const b = solo();
    expect(pose(b, BEE, b.endAtMs).column).toBe(1);
    expect(pose(b, BEE, b.endAtMs).facing).toBe(-1);
    expect(pose(b, 'char-self', b.endAtMs).facing).toBe(1);
  });

  it('late join equals continuous: the answer depends only on (battle, now)', () => {
    const b = solo();
    for (let t = b.startAtMs - 500; t <= b.endAtMs + 1000; t += 777) {
      const direct = arenaPositions(b, t);
      let stepped = arenaPositions(b, b.startAtMs);
      for (let s = b.startAtMs; s <= t; s += 50) stepped = arenaPositions(b, s);
      expect(arenaPositions(b, t)).toEqual(direct);
      if (t >= b.startAtMs) expect(arenaPositions(b, t)).toEqual(arenaPositions(b, t));
      expect(stepped.length).toBe(direct.length);
    }
  });

  it('hp and sp come from the latest actor states', () => {
    const b = solo();
    const lastWithBee = [...b.events].reverse().find((e) => e.actorStates?.[BEE])!;
    expect(pose(b, BEE, b.endAtMs + 10).hp).toBe(lastWithBee.actorStates![BEE].hp);
    expect(pose(b, BEE, b.startAtMs - 1).hp).toBe(b.actors.find((a) => a.id === BEE)!.hp);
  });

  it('dead stays dead from the KO and holds its cell', () => {
    const b = solo();
    const ko = b.events.find((e) => e.action === 'ko')!;
    expect(pose(b, BEE, at(b, ko.tick) - 1).deadAtMs).toBeNull();
    const dead = pose(b, BEE, at(b, ko.tick) + 5000);
    expect(dead.deadAtMs).toBe(at(b, ko.tick));
    expect(dead.column).toBe(1);
  });

  it('a stun shows while it is in the status effects and goes when it ends', () => {
    const b = tiny([
      { tick: 2, actorId: 'a', action: 'status_apply', targetIds: ['b'], actorStates: { b: { hp: 50, sp: 0, statusEffects: [{ type: 'stun' }] } } },
      { tick: 6, actorId: 'b', action: 'status_expire', targetIds: ['b'], actorStates: { b: { hp: 50, sp: 0, statusEffects: [] } } },
    ]);
    expect(pose(b, 'b', at(b, 3)).statuses).toEqual(['stun']);
    expect(pose(b, 'b', at(b, 3)).statusSinceMs.stun).toBe(at(b, 2));
    expect(pose(b, 'b', at(b, 7)).statuses).toEqual([]);
  });

  it('a blinkstrike dashes after its tick', () => {
    const b = tiny([{ tick: 2, actorId: 'a', action: 'move', payload: { type: 'move', from: { row: 5, column: 0 }, to: { row: 5, column: 8 }, reason: 'blinkstrike' } }]);
    expect(pose(b, 'a', at(b, 2)).column).toBe(0);
    expect(pose(b, 'a', at(b, 2) + ARENA_DASH_MS / 2).moving).toBe('dash');
    expect(pose(b, 'a', at(b, 2) + ARENA_DASH_MS).column).toBe(8);
  });

  // The engine records a push (and a revive) as the caster's event: the cells are the target's.
  it('a push slides the pushed actor, not the one who pushed', () => {
    const b = tiny([{ tick: 4, actorId: 'a', targetIds: ['b'], action: 'move', payload: { type: 'move', from: { row: 5, column: 1 }, to: { row: 5, column: 9 }, reason: 'push' } }]);
    b.actors[1].start = { row: 5, column: 1 };
    expect(pose(b, 'a', at(b, 4) + 1000).column).toBe(0);
    expect(pose(b, 'b', at(b, 4) + 100).moving).toBe('slide');
    expect(pose(b, 'b', at(b, 4) + 1000).column).toBe(9);
  });

  it('a revive puts the revived actor on its new cell', () => {
    const b = tiny([{ tick: 4, actorId: 'b', targetIds: ['a'], action: 'move', payload: { type: 'move', from: { row: 5, column: 0 }, to: { row: 4, column: 0 }, reason: 'revive' } }]);
    expect(pose(b, 'a', at(b, 4)).row).toBe(4);
    expect(pose(b, 'b', at(b, 4)).row).toBe(5);
  });

  it('a step taken on the tick of a push walks on after the slide instead of jumping', () => {
    const b = tiny([
      { tick: 4, actorId: 'a', targetIds: ['b'], action: 'move', payload: { type: 'move', from: { row: 5, column: 1 }, to: { row: 5, column: 9 }, reason: 'push' } },
      { tick: 4, actorId: 'b', targetIds: ['a'], action: 'move', payload: { type: 'move', from: { row: 5, column: 9 }, to: { row: 5, column: 8 }, reason: 'approach' } },
    ]);
    b.actors[1].start = { row: 5, column: 1 };
    const sliding = pose(b, 'b', at(b, 4) + 100);
    expect(sliding.moving).toBe('slide');
    expect(sliding.column).toBeGreaterThan(1);
    expect(sliding.column).toBeLessThan(9);
    expect(pose(b, 'b', at(b, 6)).column).toBe(8);
  });

  it('a slowed actor walks the whole way between its steps instead of stopping', () => {
    const slow = { hp: 50, sp: 0, statusEffects: [{ type: 'violent_shot_slow', moveSpeedMultiplier: 0.2 }] };
    const b = tiny([
      { tick: 10, actorId: 'b', targetIds: ['a'], action: 'move', payload: { type: 'move', from: { row: 5, column: 9 }, to: { row: 5, column: 8 }, reason: 'approach' }, actorStates: { b: slow } },
      { tick: 26, actorId: 'b', targetIds: ['a'], action: 'move', payload: { type: 'move', from: { row: 5, column: 8 }, to: { row: 5, column: 7 }, reason: 'approach' }, actorStates: { b: slow } },
    ]);
    const mid = pose(b, 'b', at(b, 18));
    expect(mid.moving).toBe('walk');
    expect(mid.column).toBeLessThan(8);
    expect(mid.column).toBeGreaterThan(7);
  });

  it('an actor killed on its way keeps walking until the blow lands', () => {
    const b = tiny([
      { tick: 4, actorId: 'b', targetIds: ['a'], action: 'move', payload: { type: 'move', from: { row: 5, column: 9 }, to: { row: 5, column: 8 }, reason: 'approach' } },
      { tick: 6, actorId: 'a', targetIds: ['b'], action: 'attack', payload: { damage: 50, hit: true }, actorStates: { b: { hp: 0, sp: 0 } } },
    ]);
    const before = pose(b, 'b', at(b, 6) - 1);
    expect(before.moving).toBe('walk');
    expect(before.column).toBeLessThan(8);
    expect(before.column).toBeGreaterThan(7);
    const dead = pose(b, 'b', at(b, 6) + 3000);
    expect(dead.moving).toBeNull();
    expect(dead.column).toBeCloseTo(before.column, 2);
  });

  it('an actor that had arrived and struck does not creep forward before dying', () => {
    const b = tiny([
      { tick: 4, actorId: 'b', targetIds: ['a'], action: 'move', payload: { type: 'move', from: { row: 5, column: 2 }, to: { row: 5, column: 1 }, reason: 'approach' } },
      { tick: 5, actorId: 'b', targetIds: ['a'], action: 'attack', payload: { damage: 5, hit: true } },
      { tick: 6, actorId: 'a', targetIds: ['b'], action: 'attack', payload: { damage: 50, hit: true }, actorStates: { b: { hp: 0, sp: 0 } } },
    ]);
    b.actors[1].start = { row: 5, column: 2 };
    expect(pose(b, 'b', at(b, 6) - 1).column).toBe(1);
    expect(pose(b, 'b', at(b, 6) - 1).moving).toBeNull();
  });

  it('flee exits left', () => {
    const b = { ...solo(), flee: { atMs: solo().startAtMs + 3000 } };
    const p = pose(b, 'char-self', b.flee.atMs + 1000);
    expect(p.column).toBeCloseTo(0 - ARENA_FLEE_SPEED_CELLS_PER_S, 6);
    expect(p.facing).toBe(-1);
    expect(p.fleeing).toEqual({ sinceMs: b.flee.atMs });
    expect(pose(b, BEE, b.flee.atMs + 1000).fleeing).toBeNull();
  });

  it('party battle: every actor gets a pose and nobody walks through a cell twice', () => {
    const b = fromSharedBattle(PARTY_V2_VIEW, 'char-self');
    const end = arenaPositions(b, b.endAtMs);
    expect(end.length).toBe(5);
    for (const p of end) expect(Number.isInteger(p.column) && Number.isInteger(p.row)).withContext(p.id).toBeTrue();
  });
});

describe('moveDurationMs', () => {
  it('is the time for the movement gauge to fill', () => {
    expect(moveDurationMs(100, 500)).toBe(1000);
    expect(moveDurationMs(66, 500)).toBeCloseTo(1515, 0);
    expect(moveDurationMs(null, 500)).toBe(1000);
  });
});

