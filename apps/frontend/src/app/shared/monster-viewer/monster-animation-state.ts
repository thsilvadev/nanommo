/**
 * The monster's pose as a pure function of (active battle, now), read from the same
 * pre-computed battle log as the character's (see character-animation/animation-state.ts).
 * No three.js here: unit-tested without WebGL; the viewer turns it into clip times.
 */
import { battleTimeline, CLIP_SECONDS, type AnimationBattleEntry, type AnimationState } from '../character-animation/animation-state';

export type MonsterClip = 'Idle' | 'Walk' | 'Attack' | 'Cast' | 'Damage' | 'Dead';

export interface MonsterAnimationState {
  /** Monster attack or skill, played once from `startedAtMs`; the viewer speeds it up to end by `untilMs` (next monster action). */
  action?: { clip: 'Attack' | 'Cast'; startedAtMs: number; untilMs: number | null };
  /** Last hit the monster took. */
  hit?: { startedAtMs: number };
  /** Stepping across the grid: from a `move` until the next one (or a short while after the last). */
  walking?: boolean;
  /** Killed: Dead from `startedAtMs`, holding its last frame. */
  dead?: { startedAtMs: number };
}

const STRIKES = new Set(['attack', 'use_skill']);
/** Moves further apart than this are separate steps (the monster stops in between). */
const MAX_STEP_GAP_TICKS = 8;
/** How long the last step of a run lasts when there is no next move to walk to. */
const LAST_STEP_TICKS = 3;

export function monsterAnimationState(activeBattle: AnimationBattleEntry | null, nowMs: number): MonsterAnimationState {
  const battle = activeBattle ? battleTimeline(activeBattle) : null;
  if (!battle || nowMs < battle.startMs) return {};
  const { events, timeOf } = battle;
  const fatal = events.find((e) => (e.hpRemaining as { monster?: number } | undefined)?.monster !== undefined
    && Number((e.hpRemaining as { monster?: number }).monster) <= 0);
  if (fatal && nowMs >= timeOf(Number(fatal.tick))) return { dead: { startedAtMs: timeOf(Number(fatal.tick)) } };
  if (nowMs >= battle.endMs) return {};

  const state: MonsterAnimationState = {};
  const strikes = events.filter((e) => e.actor === 'monster' && STRIKES.has(String(e.action)));
  const last = strikes.filter((e) => timeOf(Number(e.tick)) <= nowMs).pop();
  if (last) {
    const next = strikes.find((e) => Number(e.tick) > Number(last.tick));
    state.action = { clip: last.action === 'use_skill' ? 'Cast' : 'Attack', startedAtMs: timeOf(Number(last.tick)), untilMs: next ? timeOf(Number(next.tick)) : null };
  }
  const hit = events
    .filter((e) => e.actor === 'character' && e.target === 'monster' && Number(e.damage ?? 0) > 0 && timeOf(Number(e.tick)) <= nowMs)
    .pop();
  if (hit) state.hit = { startedAtMs: timeOf(Number(hit.tick)) };
  const tickMs = timeOf(1) - timeOf(0);
  const moves = events.filter((e) => e.actor === 'monster' && e.action === 'move').map((e) => Number(e.tick));
  state.walking = moves.some((tick, i) => {
    const next = moves[i + 1];
    const endTick = next !== undefined && next - tick <= MAX_STEP_GAP_TICKS ? next : tick + LAST_STEP_TICKS;
    return timeOf(tick) <= nowMs && nowMs < timeOf(endTick);
  }) || undefined;
  if (!state.walking) delete state.walking;
  return state;
}

/** The same moment for a monster drawn with the character rig (Bandit): character clips, same timing rules. */
export function monsterAsCharacterState(s: MonsterAnimationState, nowMs: number): AnimationState {
  if (s.dead) return { base: 'CombatIdle', oneShot: { clip: 'Dead', startedAtMs: s.dead.startedAtMs, speed: 1 } };
  const state: AnimationState = { base: s.walking ? 'Walk' : 'CombatIdle' };
  if (s.action) {
    const speed = s.action.untilMs ? Math.max(1, CLIP_SECONDS.Attack / Math.max(0.05, (s.action.untilMs - s.action.startedAtMs) / 1000)) : 1;
    if (nowMs < s.action.startedAtMs + (CLIP_SECONDS.Attack / speed) * 1000) state.oneShot = { clip: 'Attack', startedAtMs: s.action.startedAtMs, speed };
  }
  if (s.hit && nowMs < s.hit.startedAtMs + CLIP_SECONDS.Damage * 1000) state.hit = { clip: 'Damage', startedAtMs: s.hit.startedAtMs };
  return state;
}
