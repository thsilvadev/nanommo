/**
 * The arena scene between and during battles: walk → (battle) → outro → walk
 * → intro → battle, a gather kneel, and the party-wipe fade. Pure function of
 * the battles around `now`, like the rest of the projection.
 *
 * Transitions are continuous (no black fade) and must fit the real gap between
 * battles: outro + intro = 2.1 s at most (3 s budget with the walk), compressed
 * proportionally when the gap is shorter, so a battle always starts at startAt.
 *
 * Nobody walks back between battles. Columns are absolute: each battle is laid
 * out `offset` columns to the right of the engine's grid, so that its rearmost
 * team-a cell is the column the party walks at (the most advanced fighter of the
 * battle before). Fighters behind sprint up to that column; in the intro the
 * ranged stand while the melee run ahead to their cells. The camera and the
 * scenery follow the columns (moving the camera is walking).
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
/** A fighter behind the walk column catches up this fast (columns per second, on top of the walk). */
export const ARENA_CATCH_UP_COLUMNS_PER_S = 1.8;
/** Moving ahead faster than this (columns per second) is a run, not a walk. */
const SPRINT_ABOVE_COLUMNS_PER_S = 0.9;
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
  /** Column offsets of the battles (ArenaSceneSource keeps them; see arenaBattleOffset). Default 0. */
  offsets?: { previous?: number; current?: number; next?: number };
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
  /** Absolute column of the grid's column 0 for this frame (the camera keeps the grid's 10 columns from here). */
  origin: number;
}

export function walkFormation(count: number, column = 0): ArenaCell[] {
  const rows = CENTRAL_DEPLOYMENT_ROWS[Math.max(1, Math.min(5, count))];
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({ row: rows[i] ?? rows[rows.length - 1], column }));
}

const teamA = (b: ArenaBattle) => b.actors.filter((a) => a.team === 'a');
const rearmost = (b: ArenaBattle) => Math.min(...teamA(b).map((a) => a.start.column));

/** Where each team-a fighter stood when the battle let go of the scene (engine columns; dead ones left out). */
const endColumns = new WeakMap<ArenaBattle, Map<string, number>>();
function standingAtEnd(b: ArenaBattle): Map<string, number> {
  let cached = endColumns.get(b);
  if (!cached) {
    cached = new Map();
    if (!b.flee) {
      const frame = projectArenaBattle(b, Math.max(b.startAtMs, sceneEnd(b) - 1));
      const ids = new Set(teamA(b).map((a) => a.id));
      for (const a of frame.actors) if (ids.has(a.id) && a.deadAtMs === null) cached.set(a.id, a.column);
    }
    endColumns.set(b, cached);
  }
  return cached;
}

/**
 * The column the party walks at after `previous` (laid out at `offset`): its most advanced living
 * fighter's. A flee or a wipe leaves nobody standing: the battle's rearmost deployment column.
 */
export function arenaWalkColumn(previous: ArenaBattle | null, offset: number): number {
  if (!previous) return offset;
  const standing = [...standingAtEnd(previous).values()];
  return offset + (standing.length ? Math.max(...standing) : rearmost(previous));
}

/** The offset that lays `battle` out with its rearmost team-a cell on the walk column. */
export function arenaBattleOffset(walkColumn: number, battle: ArenaBattle): number {
  return walkColumn - rearmost(battle);
}

/** Shifts a projected frame to absolute columns. */
function shiftFrame(frame: ArenaFrame, offset: number): ArenaFrame {
  if (!offset) return frame;
  return { ...frame, actors: frame.actors.map((a) => ({ ...a, column: a.column + offset })) };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const ease = (f: number) => f * f * (3 - 2 * f);
/** Someone walking between two columns faces the way they go (no moonwalking); `rest` when not moving across. */
const facingTo = (from: number, to: number, rest: 1 | -1): 1 | -1 => (Math.abs(to - from) < 0.05 ? rest : to > from ? 1 : -1);

interface Walk {
  /** The column the party walks at. */
  column: number;
  /** Fighters of the battle before, still catching up: absolute column at `sinceMs`. */
  behind: Map<string, number>;
  sinceMs: number;
}

/** Where a team-a member stands between battles at `nowMs` (behind ones sprint up to the walk column). */
function walkColumnOf(walk: Walk, id: string, nowMs: number): number {
  const from = walk.behind.get(id);
  if (from === undefined) return walk.column;
  return Math.min(walk.column, from + (ARENA_CATCH_UP_COLUMNS_PER_S * Math.max(0, nowMs - walk.sinceMs)) / 1000);
}
const catchingUp = (walk: Walk, id: string, nowMs: number) => walkColumnOf(walk, id, nowMs) < walk.column - 1e-6;

function walkOf(input: ArenaTimelineInput): Walk {
  const { previous } = input;
  const offset = input.offsets?.previous ?? 0;
  const column = arenaWalkColumn(previous, offset);
  const behind = new Map<string, number>();
  if (previous) for (const [id, c] of standingAtEnd(previous)) if (c + offset < column) behind.set(id, c + offset);
  return { column, behind, sinceMs: previous ? sceneEnd(previous) : 0 };
}

export function arenaScene(input: ArenaTimelineInput): ArenaSceneFrame {
  const { nowMs, current, previous } = input;

  if (current && nowMs >= current.startAtMs && nowMs < sceneEnd(current)) return battleScene(input, current, input.offsets?.current ?? 0);
  const walk = walkOf(input);

  const nextStart = input.next?.startAtMs ?? input.nextStartAtMs;
  const k = previous && nextStart !== null ? Math.min(1, Math.max(0, nextStart - sceneEnd(previous)) / (ARENA_OUTRO_MS + ARENA_INTRO_MS)) : 1;
  const outroMs = ARENA_OUTRO_MS * k, introMs = ARENA_INTRO_MS * k;

  if (previous && nowMs >= sceneEnd(previous) && nowMs < sceneEnd(previous) + outroMs) {
    const offset = input.offsets?.previous ?? 0;
    const frame = shiftFrame(projectArenaBattle(previous, nowMs), offset);
    if (frame.wiped) return wipeScene(previous, nowMs, frame, offset);
    return outroScene(input, walk, previous, frame, (nowMs - sceneEnd(previous)) / outroMs, offset);
  }
  if (nextStart !== null && nowMs >= nextStart - introMs && nowMs < nextStart) {
    return introScene(input, walk, input.next, introMs > 0 ? (nowMs - (nextStart - introMs)) / introMs : 1, introMs);
  }
  return walkScene(input, walk);
}

/** When a battle stops owning the scene: its end, or the fleeing party gone off-screen. */
export function arenaSceneEnd(b: ArenaBattle): number { return sceneEnd(b); }
function sceneEnd(b: ArenaBattle): number {
  return b.flee ? Math.min(b.endAtMs, b.flee.atMs + FLEE_EXIT_MS) : b.endAtMs;
}

function walkers(input: ArenaTimelineInput, walk: Walk, scroll: number): ArenaActorFrame[] {
  const cells = walkFormation(input.party.length, walk.column);
  return input.party.map((member, i) => {
    const gathering = member.id === input.selfId && input.gatherAtMs !== null && input.nowMs >= input.gatherAtMs && input.nowMs < input.gatherAtMs + ARENA_GATHER_MS;
    const running = catchingUp(walk, member.id, input.nowMs);
    return {
      id: member.id, column: walkColumnOf(walk, member.id, input.nowMs), row: cells[i].row, facing: 1, moving: running || scroll > 0 ? 'walk' : null,
      hp: 0, sp: 0, statuses: [], statusSinceMs: {}, deadAtMs: null, fleeing: null, cast: null, projectile: null,
      anim: gathering ? { base: 'Walk', oneShot: { clip: 'Gather', startedAtMs: input.gatherAtMs!, speed: ARENA_GATHER_SPEED } } : { base: running ? 'Sprint' : scroll > 0 ? 'Walk' : 'Idle' },
    };
  });
}

function walkScene(input: ArenaTimelineInput, walk: Walk): ArenaSceneFrame {
  const gathering = input.gatherAtMs !== null && input.nowMs >= input.gatherAtMs && input.nowMs < input.gatherAtMs + ARENA_GATHER_MS;
  const scroll = gathering ? 0 : 1;
  const actors = walkers(input, walk, 1);
  return { phase: 'walk', scroll, frame: { actors, feedback: [], wiped: false, ended: false }, fade: 0, hud: false, battleId: null, origin: walk.column };
}

function battleScene(input: ArenaTimelineInput, battle: ArenaBattle, offset: number): ArenaSceneFrame {
  const frame = shiftFrame(projectArenaBattle(battle, input.nowMs), offset);
  if (frame.wiped) {
    const wipe = wipeScene(battle, input.nowMs, frame, offset);
    if (wipe.fade > 0) return wipe;
  }
  // A party battle seen late (it is created when due): everyone runs from where the walk left them to
  // their projected place over ARENA_PARTY_RUN_IN_MS, then follows the projection exactly.
  const received = battle.receivedAtMs;
  if (received !== undefined && received > battle.startAtMs && input.nowMs < received + ARENA_PARTY_RUN_IN_MS) {
    const f = ease(clamp01((input.nowMs - received) / ARENA_PARTY_RUN_IN_MS));
    const formation = new Map(input.party.map((m, i) => [m.id, walkFormation(input.party.length, offset + rearmost(battle))[i]]));
    frame.actors = frame.actors.map((a) => {
      const def = battle.actors.find((d) => d.id === a.id)!;
      const from = def.team === 'a' ? formation.get(a.id) ?? { row: def.start.row, column: def.start.column + offset } : { row: def.start.row, column: ARENA_RUN_IN_FROM_COLUMN + offset };
      return f < 1 ? { ...a, column: lerp(from.column, a.column, f), row: lerp(from.row, a.row, f), facing: facingTo(from.column, a.column, a.facing), anim: { ...a.anim, base: 'Sprint' } } : a;
    });
  }
  return { phase: 'battle', scroll: 0, frame, fade: 0, hud: true, battleId: battle.id, origin: offset };
}

function wipeScene(battle: ArenaBattle, nowMs: number, frame: ArenaFrame, offset: number): ArenaSceneFrame {
  const lastFall = Math.max(...frame.actors.filter((a) => battle.actors.find((d) => d.id === a.id)!.team === 'a').map((a) => a.deadAtMs ?? 0));
  const fade = clamp01((nowMs - (lastFall + CLIP_SECONDS.Dead * 1000)) / WIPE_FADE_MS);
  return { phase: fade > 0 ? 'wipe' : 'battle', scroll: 0, frame, fade, hud: fade === 0, battleId: battle.id, origin: offset };
}

/** After a battle: foes sink out, the ground starts scrolling, fighters behind sprint up to the walk column. */
function outroScene(input: ArenaTimelineInput, walk: Walk, battle: ArenaBattle, frame: ArenaFrame, progress: number, offset: number): ArenaSceneFrame {
  const f = clamp01(progress);
  const cells = walkFormation(input.party.length, walk.column);
  frame.actors = frame.actors.map((a) => {
    const def = battle.actors.find((d) => d.id === a.id)!;
    const slot = input.party.findIndex((m) => m.id === a.id);
    if (def.team === 'a' && slot >= 0 && a.deadAtMs === null) {
      const running = catchingUp(walk, a.id, input.nowMs);
      return { ...a, column: walkColumnOf(walk, a.id, input.nowMs), row: lerp(a.row, cells[slot].row, ease(f)), facing: 1, moving: 'walk', cast: null, projectile: null, anim: { base: running ? 'Sprint' : 'Walk' } };
    }
    return { ...a, exit: f, cast: null, projectile: null };
  });
  frame.feedback = [];
  return { phase: 'outro', scroll: f, frame, fade: 0, hud: false, battleId: battle.id, origin: offset };
}

/**
 * Before a battle: the ground slows down, the next foes run in and everyone lands on their cell at
 * startAt. Team a only moves ahead: the ranged stand on the walk column, the melee run to their cells.
 */
function introScene(input: ArenaTimelineInput, walk: Walk, next: ArenaBattle | null, progress: number, introMs: number): ArenaSceneFrame {
  const f = clamp01(progress);
  const scroll = 1 - f;
  if (!next) {
    const actors = walkers(input, walk, scroll);
    return { phase: 'intro', scroll, frame: { actors, feedback: [], wiped: false, ended: false }, fade: 0, hud: false, battleId: null, origin: walk.column };
  }
  const offset = input.offsets?.next ?? 0;
  const g = ease(f);
  // Speed of the eased move at this point (columns per second, per column of distance).
  const pace = introMs > 0 ? (6 * f * (1 - f)) / (introMs / 1000) : 0;
  const rows = walkFormation(input.party.length, walk.column);
  const actors: ArenaActorFrame[] = next.actors.map((def) => {
    const slot = input.party.findIndex((m) => m.id === def.id);
    const to = { row: def.start.row, column: def.start.column + offset };
    let column: number, row: number, base: 'Idle' | 'Walk' | 'Sprint', facing: 1 | -1;
    if (def.team === 'a') {
      const from = walkColumnOf(walk, def.id, input.nowMs);
      const fromRow = rows[slot]?.row ?? to.row;
      column = lerp(from, to.column, g); row = lerp(fromRow, to.row, g);
      const running = catchingUp(walk, def.id, input.nowMs) || (to.column - from) * pace > SPRINT_ABOVE_COLUMNS_PER_S;
      base = running ? 'Sprint' : scroll > 0.15 ? 'Walk' : 'Idle';
      facing = facingTo(from, to.column, 1);
    } else {
      const fromColumn = ARENA_RUN_IN_FROM_COLUMN + offset;
      column = lerp(fromColumn, to.column, g); row = to.row;
      base = 'Sprint';
      facing = facingTo(fromColumn, to.column, -1);
    }
    return {
      id: def.id, column, row, facing, moving: base === 'Idle' ? null : 'walk', hp: def.hp, sp: def.sp, statuses: [], statusSinceMs: {},
      deadAtMs: null, fleeing: null, cast: null, projectile: null, anim: { base },
    };
  });
  return { phase: 'intro', scroll, frame: { actors, feedback: [], wiped: false, ended: false }, fade: 0, hud: false, battleId: next.id, origin: offset };
}
