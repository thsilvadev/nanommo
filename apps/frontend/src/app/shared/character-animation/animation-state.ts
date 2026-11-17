/**
 * The character's pose as a pure function of (character, active battle, now).
 *
 * Nothing here accumulates state from events: opening the screen in the middle
 * of a battle or of a cast, reconnecting, or two views (portrait and, later,
 * the arena) asking at the same instant all get the same answer. The battle
 * log is pre-computed, so the function may also look ahead (the interval to
 * the next action, a cast that resolves later).
 *
 * No three.js here: this file is part of the initial bundle and is unit-tested
 * without WebGL. The rig turns an AnimationState into clip weights and times.
 */

export type BaseClip = 'Idle' | 'Walk' | 'CombatIdle';
export type OneShotClip = 'Attack' | 'Dead';
export type HitClip = 'Damage' | 'Damage2';

export interface AnimationState {
  /** Looping background clip. */
  base: BaseClip;
  /** Full-body clip played once from `startedAtMs`, `speed` times faster than authored. Dead holds its last frame. */
  oneShot?: { clip: OneShotClip; startedAtMs: number; speed: number };
  /** Casting: hands join (CastStart) and hold (CastLoop) from start to end. */
  cast?: { startedAtMs: number; endsAtMs: number };
  /** Short flinch blended over whatever plays; it never cuts an Attack or a cast. */
  hit?: { clip: HitClip; startedAtMs: number };
}

/** Authored length of each clip, in seconds (see tools/character-assets; measured from animations.glb). */
export const CLIP_SECONDS = {
  Attack: 1.533,
  CastStart: 0.533,
  Damage: 0.333,
  Damage2: 0.433,
  Dead: 2.4,
} as const;

/** The parts of a battle queue entry the pose depends on. */
export interface AnimationBattleEntry {
  startAt: string;
  endAt: string;
  cancelledAt?: string | null;
  tickDurationMs?: number | null;
  outcome?: 'win' | 'loss' | string;
  log?: unknown;
}

export interface AnimationInput {
  character: { status?: string | null } | null;
  activeBattle: AnimationBattleEntry | null;
  nowMs: number;
}

interface LogEvent {
  tick?: number;
  actor?: string;
  action?: string;
  target?: string;
  damage?: number;
  castStartedAtTick?: number;
  hpRemaining?: { character?: number };
}

export function characterAnimationState({ character, activeBattle, nowMs }: AnimationInput): AnimationState {
  const status = character?.status ?? null;
  if (status === 'dead_pending_return') return deadSince(nowMs - CLIP_SECONDS.Dead * 1000);

  const battle = activeBattle ? battleTimeline(activeBattle) : null;
  if (!battle || status !== 'grinding') return { base: status === 'grinding' ? 'Walk' : 'Idle' };
  if (nowMs < battle.startMs) return { base: 'Walk' };

  const { events, timeOf } = battle;
  const deathAtMs = battle.lost ? battle.deathAtMs : null;
  if (deathAtMs !== null && nowMs >= deathAtMs) return { base: 'CombatIdle', oneShot: { clip: 'Dead', startedAtMs: deathAtMs, speed: 1 } };
  if (nowMs >= battle.endMs) return { base: 'Walk' };

  const state: AnimationState = { base: 'CombatIdle' };
  const actions = events
    .filter((e) => e.actor === 'character' && (e.action === 'attack' || e.action === 'use_skill'))
    .map((e) => {
      const castStart = Number.isFinite(e.castStartedAtTick) && Number(e.castStartedAtTick) < Number(e.tick) ? Number(e.castStartedAtTick) : null;
      return { startsAtMs: timeOf(castStart ?? Number(e.tick)), strikesAtMs: timeOf(Number(e.tick)), casts: castStart !== null };
    })
    .sort((a, b) => a.strikesAtMs - b.strikesAtMs);

  const casting = actions.find((a) => a.casts && a.startsAtMs <= nowMs && nowMs < a.strikesAtMs);
  if (casting) {
    state.cast = { startedAtMs: casting.startsAtMs, endsAtMs: casting.strikesAtMs };
  } else {
    const strike = actions.filter((a) => a.strikesAtMs <= nowMs).pop();
    if (strike) {
      const next = actions.find((a) => a.startsAtMs > strike.strikesAtMs);
      const interval = next ? (next.startsAtMs - strike.strikesAtMs) / 1000 : Infinity;
      const speed = interval < CLIP_SECONDS.Attack ? CLIP_SECONDS.Attack / interval : 1;
      if (nowMs < strike.strikesAtMs + (CLIP_SECONDS.Attack / speed) * 1000) {
        state.oneShot = { clip: 'Attack', startedAtMs: strike.strikesAtMs, speed };
      }
    }
  }

  const hit = events
    .filter((e) => e.target === 'character' && e.actor !== 'character' && e.action !== 'status_damage' && Number(e.damage ?? 0) > 0 && timeOf(Number(e.tick)) <= nowMs)
    .pop();
  if (hit) {
    const clip: HitClip = Number(hit.tick) % 2 === 0 ? 'Damage' : 'Damage2';
    const startedAtMs = timeOf(Number(hit.tick));
    if (nowMs < startedAtMs + CLIP_SECONDS[clip] * 1000) state.hit = { clip, startedAtMs };
  }
  return state;
}

function deadSince(startedAtMs: number): AnimationState {
  return { base: 'Idle', oneShot: { clip: 'Dead', startedAtMs, speed: 1 } };
}

/** Battle clock and events of a queue entry; null when its timing is unusable. */
function battleTimeline(entry: AnimationBattleEntry) {
  const tickMs = Number(entry.tickDurationMs ?? (entry.log as any)?.header?.tickDurationMs);
  const startMs = Date.parse(entry.startAt);
  const endAtMs = Date.parse(entry.endAt);
  const cancelledMs = entry.cancelledAt ? Date.parse(entry.cancelledAt) : NaN;
  if (!(tickMs > 0) || !Number.isFinite(startMs) || !Number.isFinite(endAtMs)) return null;
  const endMs = Number.isFinite(cancelledMs) ? Math.min(endAtMs, cancelledMs) : endAtMs;
  const raw = (entry.log as { events?: unknown } | null | undefined)?.events;
  const events = (Array.isArray(raw) ? raw : [])
    .filter((e): e is LogEvent => !!e && typeof e === 'object' && Number.isFinite(Number((e as LogEvent).tick)))
    .slice()
    .sort((a, b) => Number(a.tick) - Number(b.tick));
  const timeOf = (tick: number) => startMs + tick * tickMs;
  const lost = entry.outcome === 'loss' && !Number.isFinite(cancelledMs);
  const fatal = events.find((e) => e.hpRemaining?.character !== undefined && Number(e.hpRemaining.character) <= 0);
  const deathAtMs = fatal ? timeOf(Number(fatal.tick)) : endMs;
  return { startMs, endMs, events, timeOf, lost, deathAtMs };
}
