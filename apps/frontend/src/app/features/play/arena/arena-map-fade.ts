import { arenaRegionOf } from './arena-region';

/**
 * Map change in the arena (only between regions: maps of one region share the scenery): the view fades to white, the new map's scene is swapped in at full white,
 * the white holds until that scene has loaded, then clears. Pure function of the last change and `now`.
 */
export const ARENA_MAP_FADE_IN_MS = 500;
export const ARENA_MAP_FADE_OUT_MS = 500;
/** The longest the white waits for a scene that will not load (a failed download): it clears anyway. */
export const ARENA_MAP_FADE_MAX_HOLD_MS = 10_000;

/** `readyAtMs`: when the new scene was ready — null while it loads (the white holds), absent: no wait (a swap without a fade). */
export interface ArenaMapChange { atMs: number; fromMapId: string | null; toMapId: string; readyAtMs?: number | null }

export function arenaMapFade(change: ArenaMapChange | null, nowMs: number): { white: number; mapId: string | null } {
  if (!change) return { white: 0, mapId: null };
  const t = nowMs - change.atMs;
  if (t < 0) return { white: 0, mapId: change.fromMapId };
  if (t < ARENA_MAP_FADE_IN_MS) return { white: t / ARENA_MAP_FADE_IN_MS, mapId: change.fromMapId };
  const peak = change.atMs + ARENA_MAP_FADE_IN_MS;
  const clearsAt = change.readyAtMs === null ? Infinity : Math.max(peak, change.readyAtMs ?? peak);
  if (nowMs < clearsAt) return { white: 1, mapId: change.toMapId };
  const u = nowMs - clearsAt;
  return u >= ARENA_MAP_FADE_OUT_MS ? { white: 0, mapId: change.toMapId } : { white: 1 - u / ARENA_MAP_FADE_OUT_MS, mapId: change.toMapId };
}

/**
 * The change once the new scene is ready (`sceneReady`, asked only past the peak, when the new scene is
 * the one being built) or once the white has held as long as it may; otherwise the change as it is.
 */
export function settleMapChange(change: ArenaMapChange | null, sceneReady: boolean, nowMs: number): ArenaMapChange | null {
  if (!change || change.readyAtMs !== null) return change;
  const peak = change.atMs + ARENA_MAP_FADE_IN_MS;
  if (nowMs < peak) return change;
  return sceneReady || nowMs - peak >= ARENA_MAP_FADE_MAX_HOLD_MS ? { ...change, readyAtMs: nowMs } : change;
}

/**
 * The change to record when the map becomes `toMapId` at `nowMs` (null: the first map seen, no fade;
 * a map of the region on screen: a change that is already over, so the map swaps without a fade).
 * It leaves from the map on screen and starts at the white already showing, so a second change during a
 * fade neither flashes nor shows the map in between.
 */
export function nextMapChange(previous: ArenaMapChange | null | undefined, toMapId: string, nowMs: number, firstMapId?: string | null): ArenaMapChange | null {
  if (!previous && !firstMapId) return null;
  const shown = previous ? arenaMapFade(previous, nowMs) : { white: 0, mapId: firstMapId ?? null };
  if (shown.mapId && arenaRegionOf(shown.mapId) === arenaRegionOf(toMapId)) {
    // Same scenery: swap at once; a fade already clearing after a region change keeps clearing.
    if (shown.white === 0) return { atMs: nowMs - ARENA_MAP_FADE_IN_MS - ARENA_MAP_FADE_OUT_MS, fromMapId: toMapId, toMapId };
    if (previous && shown.mapId === previous.toMapId) return { ...previous, toMapId };
  }
  return { atMs: nowMs - shown.white * ARENA_MAP_FADE_IN_MS, fromMapId: shown.mapId, toMapId, readyAtMs: null };
}
