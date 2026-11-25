import { projectArenaBattle } from './arena-actions';
import { arenaScene } from './arena-phase';
import type { ArenaActorDef, ArenaBattle, ArenaEvent } from './arena.types';

/** 5 vs 10, two minutes, an event every few ticks for everyone: the shape of a big party battle. */
function bigBattle(): ArenaBattle {
  const actors: ArenaActorDef[] = [];
  for (let i = 0; i < 5; i++) actors.push({ id: `c${i}`, team: 'a', kind: 'character', name: `C${i}`, start: { row: 3 + i, column: 0 }, maxHp: 1000, maxSp: 100, hp: 1000, sp: 100, monsterId: null, look: null, attackStyle: i === 0 ? 'bow' : 'melee', moveSpeed: 100 });
  for (let i = 0; i < 10; i++) actors.push({ id: `m${i}`, team: 'b', kind: 'monster', name: `M${i}`, start: { row: i, column: 9 }, maxHp: 800, maxSp: 0, hp: 800, sp: 0, monsterId: 'mon_slime', look: null, attackStyle: 'melee', moveSpeed: 60 });
  const hp: Record<string, number> = Object.fromEntries(actors.map((a) => [a.id, a.hp]));
  const pos: Record<string, { row: number; column: number }> = Object.fromEntries(actors.map((a) => [a.id, { ...a.start }]));
  const events: ArenaEvent[] = [];
  const states = () => Object.fromEntries(actors.map((a) => [a.id, { hp: hp[a.id], sp: 50, position: { ...pos[a.id] }, statusEffects: a.id === 'm3' ? [{ type: 'stun' }] : [] }]));
  for (let tick = 0; tick < 240; tick++) {
    for (const [i, a] of actors.entries()) {
      if ((tick + i) % 6 !== 0) continue;
      const foe = actors.filter((b) => b.team !== a.team)[(tick + i) % (a.team === 'a' ? 10 : 5)];
      if (a.team === 'b' && pos[a.id].column > 1 && tick % 12 === 0) {
        const from = { ...pos[a.id] }; pos[a.id] = { ...from, column: from.column - 1 };
        events.push({ tick, actorId: a.id, targetIds: [foe.id], action: 'move', payload: { type: 'move', from, to: pos[a.id], reason: 'approach' }, actorStates: states() });
      } else {
        hp[foe.id] = Math.max(1, hp[foe.id] - 3);
        events.push({ tick, actorId: a.id, targetIds: [foe.id], action: 'attack', payload: { type: 'action', damage: 3, hit: true }, actorStates: states() });
      }
    }
  }
  return { id: 'big', startAtMs: 1_000_000, endAtMs: 1_000_000 + 240 * 500, tickMs: 500, actors, events, flee: null, outcome: 'win', selfId: 'c0', mapId: 'map_caete_1' };
}

describe('arena projection cost', () => {
  it('a 5v10 battle with ~600 events projects well inside a 60 fps frame', () => {
    const battle = bigBattle();
    expect(battle.events.length).toBeGreaterThan(500);
    const party = battle.actors.filter((a) => a.team === 'a').map((a) => ({ id: a.id, look: null }));
    // Warm the caches as the real loop would, then time one minute of frames at 60 fps (3600 frames, sampled).
    arenaScene({ nowMs: battle.startAtMs, current: battle, previous: null, next: null, nextStartAtMs: null, party, selfId: 'c0', gatherAtMs: null });
    const frames = 300;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      const now = battle.startAtMs + 60_000 + f * 16;
      arenaScene({ nowMs: now, current: battle, previous: null, next: null, nextStartAtMs: null, party, selfId: 'c0', gatherAtMs: null });
    }
    const perFrame = (performance.now() - t0) / frames;
    console.log(`arena projection: ${perFrame.toFixed(3)} ms/frame for ${battle.events.length} events`);
    expect(perFrame).toBeLessThan(0.15);
    expect(projectArenaBattle(battle, battle.startAtMs + 60_000).actors.length).toBe(15);
  });
});
