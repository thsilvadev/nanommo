/**
 * The arena scene between and during battles: walk → (battle) → outro → walk
 * → intro → battle, a gather kneel, and the party-wipe fade. Pure function of
 * the battles around `now`, like the rest of the projection.
 *
 * Transitions are continuous (no black fade) and must fit the real gap between
 * battles: outro + intro = 2.1 s at most (3 s budget with the walk), compressed
 * proportionally when the gap is shorter, so a battle always starts at startAt.
 */
import { CENTRAL_DEPLOYMENT_ROWS } from '@nanommo/shared';
import { CLIP_SECONDS } from '../../../shared/character-animation/animation-state';
import { projectArenaBattle, type ArenaActorFrame, type ArenaFrame } from './arena-actions';
import type { ArenaBattle, ArenaCell, ArenaCharacterLook } from './arena.types';

export const ARENA_OUTRO_MS = 900;
export const ARENA_INTRO_MS = 1200;
export const ARENA_TRANSITION_BUDGET_MS = 3000;
export const ARENA_PARTY_RUN_IN_MS = 500;
/** Gather plays the 5.2 s kneel at double speed: a quick crouch-and-pick between steps. */
export const ARENA_GATHER_SPEED = 2;
export const ARENA_GATHER_MS = (CLIP_SECONDS.Gather / ARENA_GATHER_SPEED) * 1000;
/** Foes walk in from off-screen right (the grid is columns 0–9). */
export const ARENA_RUN_IN_FROM_COLUMN = 11.5;
const WALK_COLUMN = 4.5;
const WIPE_FADE_MS = 1000;
/** After a flee the runners leave the screen before the walk resumes. */
const FLEE_EXIT_MS = 1500;

export interface ArenaTimelineInput {
  nowMs: number;
  /** The battle running at `now` (startAt ≤ now < endAt), if any. */
  current: ArenaBattle | null;
  /** The last battle that ended before `now`. */
  previous: ArenaBattle | null;
  /** The next battle, when already known (solo queue). */
  next: ArenaBattle | null;
  /** When the next battle starts (solo: next.startAtMs; party: the encounter clock), if known. */
  nextStartAtMs: number | null;
  /** Team a walking between battles, in formation order (self first). */
  party: Array<{ id: string; look: ArenaCharacterLook | null }>;
  selfId: string;
  /** When the viewing character last completed a gather. */
  gatherAtMs: number | null;
}

export type ArenaPhaseKind = 'walk' | 'outro' | 'intro' | 'battle' | 'wipe';
export interface ArenaSceneFrame {
  phase: ArenaPhaseKind;
  /** Ground/background scroll speed, 0..1 of the walk speed. */
  scroll: number;
  frame: ArenaFrame;
  /** 0..1 black overlay (party wipe only). */
  fade: number;
  /** HP/SP/cast bars shown (battle only). */
  hud: boolean;
  /** The battle the frame belongs to (current, previous or next), null while just walking. */
  battleId: string | null;
}

export function walkFormation(count: number): ArenaCell[] {
  const rows = CENTRAL_DEPLOYMENT_ROWS[Math.max(1, Math.min(5, count))];
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({ row: rows[i] ?? rows[rows.length - 1], column: WALK_COLUMN }));
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const ease = (f: number) => f * f * (3 - 2 * f);

export function arenaScene(input: ArenaTimelineInput): ArenaSceneFrame {
  const { nowMs, current, previous } = input;

  if (current && nowMs >= current.startAtMs && nowMs < sceneEnd(current)) return battleScene(input, current);

  const nextStart = input.next?.startAtMs ?? input.nextStartAtMs;
  const k = previous && nextStart !== null ? Math.min(1, Math.max(0, nextStart - sceneEnd(previous)) / (ARENA_OUTRO_MS + ARENA_INTRO_MS)) : 1;
  const outroMs = ARENA_OUTRO_MS * k, introMs = ARENA_INTRO_MS * k;

  if (previous && nowMs >= sceneEnd(previous) && nowMs < sceneEnd(previous) + outroMs) {
    const wiped = projectArenaBattle(previous, nowMs);
    if (wiped.wiped) return wipeScene(previous, nowMs, wiped);
    return outroScene(input, previous, (nowMs - sceneEnd(previous)) / outroMs);
  }
  if (nextStart !== null && nowMs >= nextStart - introMs && nowMs < nextStart) {
    return introScene(input, input.next, introMs > 0 ? (nowMs - (nextStart - introMs)) / introMs : 1);
  }
  return walkScene(input);
}

/** When a battle stops owning the scene: its end, or the fleeing party gone off-screen. */
export function arenaSceneEnd(b: ArenaBattle): number { return sceneEnd(b); }
function sceneEnd(b: ArenaBattle): number {
  return b.flee ? Math.min(b.endAtMs, b.flee.atMs + FLEE_EXIT_MS) : b.endAtMs;
}

function walkers(input: ArenaTimelineInput, scroll: number): ArenaActorFrame[] {
  const cells = walkFormation(input.party.length);
  return input.party.map((member, i) => {
    const gathering = member.id === input.selfId && input.gatherAtMs !== null && input.nowMs >= input.gatherAtMs && input.nowMs < input.gatherAtMs + ARENA_GATHER_MS;
    return {
      id: member.id, column: cells[i].column, row: cells[i].row, facing: 1, moving: scroll > 0 ? 'walk' : null,
      hp: 0, sp: 0, statuses: [], statusSinceMs: {}, deadAtMs: null, fleeing: null, cast: null, projectile: null,
      anim: gathering ? { base: 'Walk', oneShot: { clip: 'Gather', startedAtMs: input.gatherAtMs!, speed: ARENA_GATHER_SPEED } } : { base: scroll > 0 ? 'Walk' : 'Idle' },
    };
  });
}

function walkScene(input: ArenaTimelineInput): ArenaSceneFrame {
  const gathering = input.gatherAtMs !== null && input.nowMs >= input.gatherAtMs && input.nowMs < input.gatherAtMs + ARENA_GATHER_MS;
  const scroll = gathering ? 0 : 1;
  const actors = walkers(input, 1);
  return { phase: 'walk', scroll, frame: { actors, feedback: [], wiped: false, ended: false }, fade: 0, hud: false, battleId: null };
}

function battleScene(input: ArenaTimelineInput, battle: ArenaBattle): ArenaSceneFrame {
  const frame = projectArenaBattle(battle, input.nowMs);
  if (frame.wiped) {
    const wipe = wipeScene(battle, input.nowMs, frame);
    if (wipe.fade > 0) return wipe;
  }
  // A party battle seen late (it is created when due): everyone runs from where the walk left them to
  // their projected place over ARENA_PARTY_RUN_IN_MS, then follows the projection exactly.
  const received = battle.receivedAtMs;
  if (received !== undefined && received > battle.startAtMs && input.nowMs < received + ARENA_PARTY_RUN_IN_MS) {
    const f = ease(clamp01((input.nowMs - received) / ARENA_PARTY_RUN_IN_MS));
    const formation = new Map(input.party.map((m, i) => [m.id, walkFormation(input.party.length)[i]]));
    frame.actors = frame.actors.map((a) => {
      const def = battle.actors.find((d) => d.id === a.id)!;
      const from = def.team === 'a' ? formation.get(a.id) ?? def.start : { row: def.start.row, column: ARENA_RUN_IN_FROM_COLUMN };
      return { ...a, column: lerp(from.column, a.column, f), row: lerp(from.row, a.row, f), anim: f < 1 ? { ...a.anim, base: 'Sprint' } : a.anim };
    });
  }
  return { phase: 'battle', scroll: 0, frame, fade: 0, hud: true, battleId: battle.id };
}

function wipeScene(battle: ArenaBattle, nowMs: number, frame: ArenaFrame): ArenaSceneFrame {
  const lastFall = Math.max(...frame.actors.filter((a) => battle.actors.find((d) => d.id === a.id)!.team === 'a').map((a) => a.deadAtMs ?? 0));
  const fade = clamp01((nowMs - (lastFall + CLIP_SECONDS.Dead * 1000)) / WIPE_FADE_MS);
  return { phase: fade > 0 ? 'wipe' : 'battle', scroll: 0, frame, fade, hud: fade === 0, battleId: battle.id };
}

/** After a battle: foes sink out, the party walks back into formation, the ground starts scrolling. */
function outroScene(input: ArenaTimelineInput, battle: ArenaBattle, progress: number): ArenaSceneFrame {
  const f = clamp01(progress);
  const frame = projectArenaBattle(battle, input.nowMs);
  const cells = walkFormation(input.party.length);
  frame.actors = frame.actors.map((a) => {
    const def = battle.actors.find((d) => d.id === a.id)!;
    const slot = input.party.findIndex((m) => m.id === a.id);
    if (def.team === 'a' && slot >= 0 && a.deadAtMs === null) {
      const to = cells[slot];
      return { ...a, column: lerp(a.column, to.column, ease(f)), row: lerp(a.row, to.row, ease(f)), facing: 1, moving: 'walk', cast: null, projectile: null, anim: { base: 'Walk' } };
    }
    return { ...a, exit: f, cast: null, projectile: null };
  });
  frame.feedback = [];
  return { phase: 'outro', scroll: f, frame, fade: 0, hud: false, battleId: battle.id };
}

/** Before a battle: the ground slows down, the next foes walk in and everyone lands on their cell at startAt. */
function introScene(input: ArenaTimelineInput, next: ArenaBattle | null, progress: number): ArenaSceneFrame {
  const f = clamp01(progress);
  const scroll = 1 - f;
  if (!next) {
    const actors = walkers(input, scroll);
    return { phase: 'intro', scroll, frame: { actors, feedback: [], wiped: false, ended: false }, fade: 0, hud: false, battleId: null };
  }
  const formation = walkFormation(input.party.length);
  const actors: ArenaActorFrame[] = next.actors.map((def) => {
    const slot = input.party.findIndex((m) => m.id === def.id);
    const from = def.team === 'a' ? formation[slot] ?? def.start : { row: def.start.row, column: ARENA_RUN_IN_FROM_COLUMN };
    const g = ease(f);
    return {
      id: def.id, column: lerp(from.column, def.start.column, g), row: lerp(from.row, def.start.row, g),
      facing: def.team === 'a' ? 1 : -1, moving: 'walk', hp: def.hp, sp: def.sp, statuses: [], statusSinceMs: {},
      deadAtMs: null, fleeing: null, cast: null, projectile: null, anim: { base: 'Walk' },
    };
  });
  return { phase: 'intro', scroll, frame: { actors, feedback: [], wiped: false, ended: false }, fade: 0, hud: false, battleId: next.id };
}
