/**
 * The monster's pose as a pure function of (active battle, now), read from the same
 * pre-computed battle log as the character's (see character-animation/animation-state.ts).
 * No three.js here: unit-tested without WebGL; the viewer turns it into clip times.
 */
import { ARROW_FLIGHT_SECONDS, BOW_RELEASE_FRACTION, battleTimeline, CLIP_SECONDS, type AnimationBattleEntry, type AnimationState, type AttackStyle } from '../character-animation/animation-state';

export type MonsterClip = 'Idle' | 'Walk' | 'Attack' | 'Cast' | 'Damage' | 'Dead';

export interface MonsterAnimationState {
  /**
   * Monster attack or skill: the clip is stretched over [startedAtMs, endsAtMs]. An attack starts before
   * its hit so the middle of the clip (the blow) lands on `impactAtMs`; a cast fills the cast window and
   * ends when the skill resolves.
   */
  action?: { clip: 'Attack' | 'Cast'; startedAtMs: number; impactAtMs: number; endsAtMs: number };
  /** Last hit the monster took. */
  hit?: { startedAtMs: number };
  /** Stepping across the grid: from a `move` until the next one (or a short while after the last). */
  walking?: boolean;
  /** Killed: Dead from `startedAtMs`, holding its last frame. */
  dead?: { startedAtMs: number };
}

const STRIKES = new Set(['attack', 'use_skill']);
/** How far ahead of its hit a monster attack starts (never before the monster's previous action). */
export const MONSTER_ATTACK_LEAD_MS = 450;
/** Where the blow sits in a monster attack clip (most authored clips hit around the middle). */
export const MONSTER_IMPACT_FRACTION = 0.5;
/** A cast lingers this long after it resolves. */
const CAST_TAIL_MS = 200;
/** Moves further apart than this are separate steps (the monster stops in between). */
const MAX_STEP_GAP_TICKS = 8;
/** How long the last step of a run lasts when there is no next move to walk to. */
const LAST_STEP_TICKS = 3;

/**
 * `attackStyle: 'bow'` (a monster holding a bow, e.g. the Kwaiouá Ranger): an Attack window is a whole
 * draw-and-loose (CLIP_SECONDS.Attack long, sped up when the previous action leaves no room) that lets
 * go at BOW_RELEASE_FRACTION, ARROW_FLIGHT_SECONDS before the hit, like the character's bow shot.
 */
export function monsterAnimationState(activeBattle: AnimationBattleEntry | null, nowMs: number, attackStyle: AttackStyle = 'melee'): MonsterAnimationState {
  const battle = activeBattle ? battleTimeline(activeBattle) : null;
  if (!battle || nowMs < battle.startMs) return {};
  const { events, timeOf } = battle;
  const fatal = events.find((e) => (e.hpRemaining as { monster?: number } | undefined)?.monster !== undefined
    && Number((e.hpRemaining as { monster?: number }).monster) <= 0);
  if (fatal && nowMs >= timeOf(Number(fatal.tick))) return { dead: { startedAtMs: timeOf(Number(fatal.tick)) } };
  if (nowMs >= battle.endMs) return {};

  const state: MonsterAnimationState = {};
  const now = monsterActions(events, timeOf, battle.startMs, attackStyle).filter((a) => a.startedAtMs <= nowMs && nowMs < a.endsAtMs).pop();
  if (now) state.action = now;
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

type MonsterAction = NonNullable<MonsterAnimationState['action']>;
/** The monster's attacks and skills in time order (V2 `cast_start` … `use_skill`/`cast_fizzle`, V1 `castStartedAtTick`). */
function monsterActions(events: Array<{ tick?: number; actor?: string; action?: string; castStartedAtTick?: number }>, timeOf: (tick: number) => number, battleStartMs: number, attackStyle: AttackStyle): MonsterAction[] {
  const out: MonsterAction[] = [];
  let openCast: number | null = null;
  let previousImpact = battleStartMs;
  for (const e of events) {
    if (e.actor !== 'monster') continue;
    const tick = Number(e.tick);
    if (e.action === 'cast_start') { openCast = tick; continue; }
    const resolves = STRIKES.has(String(e.action)) || e.action === 'cast_fizzle';
    if (!resolves) continue;
    const impact = timeOf(tick);
    const castFrom = e.action === 'use_skill' && Number.isFinite(e.castStartedAtTick) && Number(e.castStartedAtTick) < tick ? Number(e.castStartedAtTick)
      : openCast !== null && openCast < tick ? openCast : null;
    openCast = null;
    if (castFrom !== null) out.push({ clip: 'Cast', startedAtMs: timeOf(castFrom), impactAtMs: impact, endsAtMs: impact + CAST_TAIL_MS });
    else if (e.action === 'attack' && attackStyle === 'bow') {
      const draw = CLIP_SECONDS.Attack * BOW_RELEASE_FRACTION;
      const room = (impact - previousImpact) / 1000 - ARROW_FLIGHT_SECONDS;
      const speed = room < draw ? draw / Math.max(room, 0.05) : 1;
      const startedAtMs = impact - (draw / speed + ARROW_FLIGHT_SECONDS) * 1000;
      out.push({ clip: 'Attack', startedAtMs, impactAtMs: impact, endsAtMs: startedAtMs + (CLIP_SECONDS.Attack / speed) * 1000 });
    } else if (e.action !== 'cast_fizzle') {
      const start = Math.max(impact - MONSTER_ATTACK_LEAD_MS, previousImpact);
      const lead = Math.max(50, impact - start);
      out.push({ clip: e.action === 'use_skill' ? 'Cast' : 'Attack', startedAtMs: impact - lead, impactAtMs: impact, endsAtMs: impact + (lead * (1 - MONSTER_IMPACT_FRACTION)) / MONSTER_IMPACT_FRACTION });
    }
    previousImpact = impact;
  }
  return out;
}

/** The same moment for a monster drawn with the character rig (Bandit): character clips, same timing rules. */
export function monsterAsCharacterState(s: MonsterAnimationState, nowMs: number): AnimationState {
  if (s.dead) return { base: 'CombatIdle', oneShot: { clip: 'Dead', startedAtMs: s.dead.startedAtMs, speed: 1 } };
  const state: AnimationState = { base: s.walking ? 'Walk' : 'CombatIdle' };
  if (s.action?.clip === 'Cast' && s.action.impactAtMs - s.action.startedAtMs > MONSTER_ATTACK_LEAD_MS) {
    state.cast = { startedAtMs: s.action.startedAtMs, endsAtMs: s.action.impactAtMs };
  } else if (s.action && nowMs < s.action.endsAtMs) {
    state.oneShot = { clip: 'Attack', startedAtMs: s.action.startedAtMs, speed: CLIP_SECONDS.Attack / Math.max(0.05, (s.action.endsAtMs - s.action.startedAtMs) / 1000) };
  }
  if (s.hit && nowMs < s.hit.startedAtMs + CLIP_SECONDS.Damage * 1000) state.hit = { clip: 'Damage', startedAtMs: s.hit.startedAtMs };
  return state;
}
