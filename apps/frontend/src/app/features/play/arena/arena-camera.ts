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

/** Where the camera looks and how far it stands back so every given cell (clamped into the grid) is in view. */
export function frameCells(cells: ArenaCell[], aspect: number): { targetX: number; targetZ: number; distance: number } {
  const clamp = (v: number) => Math.max(0, Math.min(GRID - 1, v));
  const cols = cells.length ? cells.map((c) => clamp(c.column)) : [0, GRID - 1];
  const rows = cells.length ? cells.map((c) => clamp(c.row)) : [0, GRID - 1];
  const span = (values: number[], min: number) => {
    let lo = Math.min(...values) - MARGIN, hi = Math.max(...values) + MARGIN;
    const grow = Math.max(0, min - 1 - (hi - lo)) / 2;
    lo -= grow; hi += grow;
    // Never more than the whole grid (plus its margin).
    lo = Math.max(lo, -MARGIN); hi = Math.min(hi, GRID - 1 + MARGIN);
    return { lo, hi };
  };
  const c = span(cols, MIN_COLS), r = span(rows, MIN_ROWS);
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
