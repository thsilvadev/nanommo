/**
 * The monster's pose as a pure function of (active battle, now), read from the same
 * pre-computed battle log as the character's (see character-animation/animation-state.ts).
 * No three.js here: unit-tested without WebGL; the viewer turns it into clip times.
 */
import { battleTimeline, type AnimationBattleEntry } from '../character-animation/animation-state';

export type MonsterClip = 'Idle' | 'Attack' | 'Cast' | 'Damage' | 'Dead';

export interface MonsterAnimationState {
  /** Monster attack or skill, played once from `startedAtMs`; the viewer speeds it up to end by `untilMs` (next monster action). */
  action?: { clip: 'Attack' | 'Cast'; startedAtMs: number; untilMs: number | null };
  /** Last hit the monster took. */
  hit?: { startedAtMs: number };
  /** Killed: Dead from `startedAtMs`, holding its last frame. */
  dead?: { startedAtMs: number };
}

const STRIKES = new Set(['attack', 'use_skill']);

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
  return state;
}
