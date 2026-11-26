/**
 * Grid ↔ world and the arena camera framing. Pure (no three.js).
 *
 * The 10×10 grid is centred on the origin: columns run along +x (team a on
 * the left), rows along +z (row 9 nearest the camera). The camera looks at the
 * frame target from the front (+z), raised and pitched down — a broadcast
 * (FIFA-like) angle, never top-down.
 */
import type { ArenaCell } from './arena.types';

/** Cells are big: a medium monster uses well under half of one, so giants can grow tall without crowding. */
export const ARENA_CELL_M = 2.4;
export const ARENA_CAMERA_PITCH_DEG = 12;
export const ARENA_CAMERA_FOV_DEG = 40;
const GRID = 10;
/** Frame at least this many cells (columns × rows): a 1v1 never zooms in too close. */
const MIN_COLS = 4, MIN_ROWS = 3;
/** One cell of air around the occupied box. */
const MARGIN = 1;
/** Height kept in frame above the far row (heads, HUD bars). */
const HEADROOM_M = 3.2;

export function cellToWorld(cell: { row: number; column: number }): { x: number; z: number } {
  return { x: (cell.column - (GRID - 1) / 2) * ARENA_CELL_M, z: (cell.row - (GRID - 1) / 2) * ARENA_CELL_M };
}

/**
 * Where the camera looks and how far it stands back so every given cell (clamped into the grid) is in view.
 * Columns are absolute: the grid's 10 columns start at `origin` (a battle's column offset).
 */
export function frameCells(cells: ArenaCell[], aspect: number, origin = 0): { targetX: number; targetZ: number; distance: number } {
  const clampTo = (lo: number) => (v: number) => Math.max(lo, Math.min(lo + GRID - 1, v));
  const cols = cells.length ? cells.map((c) => clampTo(origin)(c.column)) : [origin, origin + GRID - 1];
  const rows = cells.length ? cells.map((c) => clampTo(0)(c.row)) : [0, GRID - 1];
  const span = (values: number[], min: number, base: number) => {
    let lo = Math.min(...values) - MARGIN, hi = Math.max(...values) + MARGIN;
    const grow = Math.max(0, min - 1 - (hi - lo)) / 2;
    lo -= grow; hi += grow;
    // Never more than the whole grid (plus its margin).
    lo = Math.max(lo, base - MARGIN); hi = Math.min(hi, base + GRID - 1 + MARGIN);
    return { lo, hi };
  };
  const c = span(cols, MIN_COLS, origin), r = span(rows, MIN_ROWS, 0);
  const width = (c.hi - c.lo + 1) * ARENA_CELL_M;
  const depth = (r.hi - r.lo + 1) * ARENA_CELL_M;
  const centre = cellToWorld({ column: (c.lo + c.hi) / 2, row: (r.lo + r.hi) / 2 });
  const vfov = (ARENA_CAMERA_FOV_DEG * Math.PI) / 180;
  const pitch = (ARENA_CAMERA_PITCH_DEG * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const byWidth = width / 2 / Math.tan(hfov / 2);
  const byDepth = (depth * Math.sin(pitch) + HEADROOM_M * Math.cos(pitch)) / 2 / Math.tan(vfov / 2);
  return { targetX: centre.x, targetZ: centre.z, distance: Math.max(byWidth, byDepth) };
}

/** The player's orbit (click and drag): at most this far round from the front, the painted scenery behind the grid still fills the view. */
export const ARENA_ORBIT_MAX_YAW_DEG = 70;
/** Pitch the player may drag to: from almost level to well above. */
export const ARENA_ORBIT_PITCH_RANGE_DEG: readonly [number, number] = [5, 60];

export function clampOrbit(yawDeg: number, pitchDeg: number): { yawDeg: number; pitchDeg: number } {
  return {
    yawDeg: Math.max(-ARENA_ORBIT_MAX_YAW_DEG, Math.min(ARENA_ORBIT_MAX_YAW_DEG, yawDeg)),
    pitchDeg: Math.max(ARENA_ORBIT_PITCH_RANGE_DEG[0], Math.min(ARENA_ORBIT_PITCH_RANGE_DEG[1], pitchDeg)),
  };
}

/**
 * The camera `d` metres from the look point (x, 0.9 m, z), turned `yawDeg` round it (0: from the front,
 * +z; positive: towards +x) and raised `pitchDeg` above it.
 */
export function orbitCamera(at: { x: number; z: number; d: number }, yawDeg: number, pitchDeg: number): { position: { x: number; y: number; z: number }; lookAt: { x: number; y: number; z: number } } {
  const yaw = (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
  const flat = at.d * Math.cos(pitch);
  return {
    position: { x: at.x + flat * Math.sin(yaw), y: at.d * Math.sin(pitch) + 0.9, z: at.z + flat * Math.cos(yaw) },
    lookAt: { x: at.x, y: 0.9, z: at.z },
  };
}

/** Camera distance of the closest zoom (zoom 1): a close shot of one fighter. */
export const ARENA_FOCUS_DISTANCE_M = 7;

/**
 * The player's zoom (0: the automatic frame; 1: a close shot) towards the focused fighter's world position.
 * Zooming never pulls the camera back.
 */
export function zoomedFrame(want: { targetX: number; targetZ: number; distance: number }, focus: { x: number; z: number } | null, zoom: number): { targetX: number; targetZ: number; distance: number } {
  const z = Math.max(0, Math.min(1, zoom));
  if (!focus || z === 0) return want;
  const lerp = (a: number, b: number) => a + (b - a) * z;
  return { targetX: lerp(want.targetX, focus.x), targetZ: lerp(want.targetZ, focus.z), distance: lerp(want.distance, Math.min(want.distance, ARENA_FOCUS_DISTANCE_M)) };
}

/** Focus keys by the character they type (works on any layout); the numpad by its code (its digits type like the row's). */
const FOCUS_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', '[', ']', '\\'];

/** Which living fighter a key focuses (0-based: 1…9, 0, -, =, [, ], \\ then Numpad1…5 = 0…19), null when none. */
export function arenaFocusSlot(event: { key: string; code: string }): number | null {
  const pad = /^Numpad([1-5])$/.exec(event.code);
  if (pad) return 14 + Number(pad[1]);
  if (event.code.startsWith('Numpad')) return null;
  const i = FOCUS_KEYS.indexOf(event.key);
  return i < 0 ? null : i;
}

/** The fighters the focus keys go through: the living ones, the party side first, each side in frame order. */
export function arenaFocusOrder(actors: ReadonlyArray<{ id: string; team: 'a' | 'b'; deadAtMs: number | null; fleeing: unknown }>): string[] {
  const living = actors.filter((a) => a.deadAtMs === null && !a.fleeing);
  return [...living.filter((a) => a.team === 'a'), ...living.filter((a) => a.team === 'b')].map((a) => a.id);
}

/** Real size, except a model wider than ~one cell shrinks to fit (height follows: giants still stand tall). */
export function monsterScale(nativeWidthM: number, _nativeHeightM: number): number {
  const max = 1.1 * ARENA_CELL_M;
  return nativeWidthM > max ? max / nativeWidthM : 1;
}

/**
 * Monsters whose walk and idle are flight (bee, mosquito: their clips hover) fly at this height in
 * the arena; the blob shadow stays on the ground. The wraith floats by its own build lift; the
 * field bat's model has no flight clips, so it walks.
 */
const FLYERS_M: Record<string, number> = { mutantbee: 1.2, giantmosquito: 1.2 };
/** A killed flyer drops to the ground over this long (accelerating, like a fall). */
export const ARENA_FLYER_FALL_MS = 600;

export function arenaHoverM(monsterId: string | null, deadAtMs: number | null, nowMs: number): number {
  const height = monsterId ? FLYERS_M[monsterId.replace(/^mon_/, '')] ?? 0 : 0;
  if (!height || deadAtMs === null || nowMs <= deadAtMs) return height;
  const f = Math.min(1, (nowMs - deadAtMs) / ARENA_FLYER_FALL_MS);
  return height * (1 - f * f);
}
