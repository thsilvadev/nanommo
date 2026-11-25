import { CENTRAL_DEPLOYMENT_ROWS } from '@nanommo/shared';
import { CLIP_SECONDS } from '../../../shared/character-animation/animation-state';
import { fromSharedBattle, fromSoloEntry } from './arena-battle';
import { projectArenaBattle } from './arena-actions';
import { ARENA_GATHER_MS, ARENA_INTRO_MS, ARENA_OUTRO_MS, ARENA_PARTY_RUN_IN_MS, ARENA_RUN_IN_FROM_COLUMN, arenaScene, walkFormation, type ArenaTimelineInput } from './arena-phase';
import type { ArenaBattle } from './arena.types';
import { SOLO_V2_ENTRY } from './fixtures/solo-v2.fixture';
import { PARTY_V2_VIEW } from './fixtures/party-v2.fixture';

const solo = (): ArenaBattle => fromSoloEntry(SOLO_V2_ENTRY, { id: 'char-self', look: null, attackStyle: 'bow' })!;
/** The same battle moved in time. */
const shift = (b: ArenaBattle, startAtMs: number): ArenaBattle => ({ ...b, id: `${b.id}@${startAtMs}`, startAtMs, endAtMs: startAtMs + (b.endAtMs - b.startAtMs) });
const SELF = [{ id: 'char-self', look: null }];
const input = (over: Partial<ArenaTimelineInput>): ArenaTimelineInput => ({
  nowMs: 0, current: null, previous: null, next: null, nextStartAtMs: null, party: SELF, selfId: 'char-self', gatherAtMs: null, ...over,
});

describe('walkFormation', () => {
  it('stands the party in the central deployment rows at the middle column', () => {
    expect(walkFormation(1)).toEqual([{ row: 5, column: 4.5 }]);
    expect(walkFormation(3).map((c) => c.row)).toEqual(CENTRAL_DEPLOYMENT_ROWS[3]);
    expect(walkFormation(5).every((c) => c.column === 4.5)).toBeTrue();
  });
});

describe('arenaScene', () => {
  const previous = solo();
  const E = previous.endAtMs;

  it('3 s gap: outro 900 ms, walk 900 ms, intro 1200 ms', () => {
    const next = shift(solo(), E + 3000);
    const phase = (dt: number) => arenaScene(input({ nowMs: E + dt, previous, next, nextStartAtMs: next.startAtMs })).phase;
    expect(phase(100)).toBe('outro');
    expect(phase(ARENA_OUTRO_MS + 1)).toBe('walk');
    expect(phase(3000 - ARENA_INTRO_MS + 1)).toBe('intro');
    expect(phase(3000)).toBe('walk'); // no current battle passed: the caller hands the battle in as `current` from startAt
  });

  it('scroll: still in battle, ramps up in the outro, full while walking, ramps down in the intro', () => {
    const next = shift(solo(), E + 3000);
    const scroll = (dt: number) => arenaScene(input({ nowMs: E + dt, previous, next, nextStartAtMs: next.startAtMs })).scroll;
    expect(scroll(0)).toBeCloseTo(0, 6);
    expect(scroll(ARENA_OUTRO_MS / 2)).toBeCloseTo(0.5, 2);
    expect(scroll(1500)).toBe(1);
    expect(scroll(3000 - ARENA_INTRO_MS / 2)).toBeCloseTo(0.5, 2);
    expect(arenaScene(input({ nowMs: next.startAtMs + 10, current: next })).scroll).toBe(0);
  });

  it('compresses into a 1.5 s gap and still starts on time', () => {
    const next = shift(solo(), E + 1500);
    const k = 1500 / (ARENA_OUTRO_MS + ARENA_INTRO_MS);
    const phase = (dt: number) => arenaScene(input({ nowMs: E + dt, previous, next, nextStartAtMs: next.startAtMs })).phase;
    expect(phase(ARENA_OUTRO_MS * k - 5)).toBe('outro');
    expect(phase(ARENA_OUTRO_MS * k + 5)).toBe('intro');
    const atStart = arenaScene(input({ nowMs: next.startAtMs, previous, next, current: next, nextStartAtMs: next.startAtMs }));
    expect(atStart.phase).toBe('battle');
    for (const def of next.actors) {
      const a = atStart.frame.actors.find((x) => x.id === def.id)!;
      expect([a.row, a.column]).withContext(def.id).toEqual([def.start.row, def.start.column]);
    }
  });

  it('foes enter from the right and land exactly at startAt', () => {
    const next = shift(solo(), E + 3000);
    const foe = next.actors.find((a) => a.team === 'b')!;
    const self = next.actors.find((a) => a.team === 'a')!;
    const at = (dt: number) => arenaScene(input({ nowMs: next.startAtMs + dt, previous, next, nextStartAtMs: next.startAtMs })).frame.actors;
    const early = at(-ARENA_INTRO_MS + 10).find((a) => a.id === foe.id)!;
    expect(early.column).toBeGreaterThan(9);
    const last = at(-1);
    expect(last.find((a) => a.id === foe.id)!.column).toBeCloseTo(foe.start.column, 1);
    expect(last.find((a) => a.id === self.id)!.column).toBeCloseTo(self.start.column, 1);
    expect(last.find((a) => a.id === self.id)!.anim.base).toBe('Walk');
  });

  it('walking: the party walks in formation, no HUD', () => {
    const scene = arenaScene(input({ nowMs: 5_000_000 }));
    expect(scene.phase).toBe('walk');
    expect(scene.hud).toBeFalse();
    expect(scene.frame.actors.map((a) => [a.id, a.column, a.row, a.anim.base])).toEqual([['char-self', 4.5, 5, 'Walk']]);
  });

  it('gather kneels and pauses the scroll', () => {
    const scene = arenaScene(input({ nowMs: 5_000_000, gatherAtMs: 5_000_000 - 500 }));
    expect(scene.frame.actors[0].anim.oneShot?.clip).toBe('Gather');
    expect(scene.scroll).toBe(0);
    expect(arenaScene(input({ nowMs: 5_000_000, gatherAtMs: 5_000_000 - ARENA_GATHER_MS - 1 })).scroll).toBe(1);
  });

  it('a late party battle: foes run in, then match the projection', () => {
    const view = fromSharedBattle(PARTY_V2_VIEW, 'char-self');
    const battle = { ...view, receivedAtMs: view.startAtMs + 800 };
    const party = [{ id: 'char-self', look: null }, { id: 'char-ally', look: null }];
    const scene = (now: number) => arenaScene(input({ nowMs: now, current: battle, party }));
    const foe = 'monster:mon_direwolf:0';
    const truth = (now: number) => projectArenaBattle(battle, now).actors.find((a) => a.id === foe)!.column;
    const mid = scene(battle.receivedAtMs + ARENA_PARTY_RUN_IN_MS / 2).frame.actors.find((a) => a.id === foe)!.column;
    expect(mid).toBeLessThan(ARENA_RUN_IN_FROM_COLUMN);
    expect(mid).toBeGreaterThan(truth(battle.receivedAtMs + ARENA_PARTY_RUN_IN_MS / 2));
    const now = battle.receivedAtMs + ARENA_PARTY_RUN_IN_MS;
    expect(scene(now).frame.actors.find((a) => a.id === foe)!.column).toBeCloseTo(truth(now), 6);
    expect(scene(now).hud).toBeTrue();
  });

  it('a wipe fades to black after the last fall', () => {
    const b = solo();
    const self = b.actors.find((a) => a.team === 'a')!.id;
    const deathTick = 10;
    const wiped: ArenaBattle = { ...b, events: [...b.events.filter((e) => e.tick < deathTick), { tick: deathTick, actorId: 'x', targetIds: [self], action: 'attack', payload: { damage: 999 }, actorStates: { [self]: { hp: 0, sp: 0 } } }] };
    const death = b.startAtMs + deathTick * b.tickMs;
    const fadeStart = death + CLIP_SECONDS.Dead * 1000;
    const at = (now: number) => arenaScene(input({ nowMs: now, current: wiped }));
    expect(at(fadeStart - 10).phase).toBe('battle');
    expect(at(fadeStart + 500).phase).toBe('wipe');
    expect(at(fadeStart + 500).fade).toBeCloseTo(0.5, 2);
    expect(at(fadeStart + 2000).fade).toBe(1);
  });
});
