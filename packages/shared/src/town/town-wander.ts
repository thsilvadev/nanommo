import { Mulberry32, mulberry32Seed } from '../battle-engine/prng';
import type { TownNav } from './town-nav';
import type { TownMove, TownPose, TownRosterEntry, TownSceneDef } from './town-scene.types';

/** Duration of one movement leg (walk to a destination, then wait there). */
export const TOWN_LEG_MS = 24000;
/** Walking speed in world units per second. */
export const TOWN_WALK_SPEED = 2.2;
/** Chance that a leg is a short stroll around the previous POI instead of a new POI. */
export const TOWN_STROLL_CHANCE = 0.25;
/** Radius of a short stroll, in world units. */
export const TOWN_STROLL_RADIUS = 6;
/** Click-to-move walking speed, world units per second. */
export const TOWN_MOVE_SPEED = 3;
/** After a click-to-move arrives, the character stands this long, then wanders again. */
export const TOWN_MOVE_RESUME_MS = 10000;
/** The walk must fit in this fraction of the leg; otherwise the speed scales up. */
const MAX_WALK_FRACTION = 0.8;
const POINT_DRAWS = 16;

type WanderEntry = Pick<TownRosterEntry, 'seed' | 'sleeping' | 'wakeFrom' | 'move' | 'emote'>;
interface LegDest { x: number; z: number; lookAt: [number, number] | null }

/**
 * Independent PRNG stream for (seed, salt, k). Hash-seeded so any leg costs
 * O(1) draws — `rngForIndex` forks by advancing N steps, which is O(k) and k
 * here is ~epochMs / TOWN_LEG_MS (tens of millions).
 */
function stream(seed: number, salt: string, k: number): Mulberry32 {
  return new Mulberry32(mulberry32Seed(`${seed}:${salt}:${k}`));
}

function phaseOf(seed: number): number {
  return stream(seed, 'phase', 0).next() * TOWN_LEG_MS;
}

function legIndex(seed: number, t: number): number {
  return Math.floor((t + phaseOf(seed)) / TOWN_LEG_MS);
}

function legStart(seed: number, k: number): number {
  return k * TOWN_LEG_MS - phaseOf(seed);
}

function weightedIndex(def: TownSceneDef, rng: Mulberry32, exclude: number[]): number {
  const pois = def.pointsOfInterest;
  let allowed = pois.map((_, i) => i).filter(i => !exclude.includes(i));
  if (allowed.length === 0) allowed = pois.map((_, i) => i);
  const total = allowed.reduce((sum, i) => sum + Math.max(0, pois[i].weight), 0);
  let pick = rng.next() * total;
  for (const i of allowed) {
    pick -= Math.max(0, pois[i].weight);
    if (pick < 0) return i;
  }
  return allowed[allowed.length - 1];
}

/**
 * POI chosen for leg k. Even legs pick freely; odd legs pick excluding both
 * even neighbours. Consecutive legs therefore never share a POI, and every
 * lookup is O(1) (no recursion back to the epoch).
 */
function poiIndex(def: TownSceneDef, seed: number, k: number): number {
  const evenPick = (j: number) => weightedIndex(def, stream(seed, 'poi', j), []);
  if (((k % 2) + 2) % 2 === 0) return evenPick(k);
  const prev = evenPick(k - 1);
  const next = evenPick(k + 1);
  const rng = stream(seed, 'poi', k);
  if (def.pointsOfInterest.length > 2 || prev === next) return weightedIndex(def, rng, [prev, next]);
  return weightedIndex(def, rng, [prev]);
}

function walkable(def: TownSceneDef, nav: TownNav, x: number, z: number): boolean {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (nav.blocked(cx, cz)) return false;
  return nav.reachableFrom(def.spawn.x, def.spawn.z).has(cz * nav.w + cx);
}

/** Uniform point in a disc (square rejection: no trig, so identical on every engine). */
function pointNear(def: TownSceneDef, nav: TownNav, rng: Mulberry32, cx: number, cz: number, radius: number): [number, number] | null {
  for (let i = 0; i < POINT_DRAWS; i++) {
    const dx = (rng.next() * 2 - 1) * radius;
    const dz = (rng.next() * 2 - 1) * radius;
    if (dx * dx + dz * dz > radius * radius) continue;
    if (walkable(def, nav, cx + dx, cz + dz)) return [cx + dx, cz + dz];
  }
  return null;
}

/** The POI-based point of leg k (where leg k goes when it is not a stroll). */
function poiPoint(def: TownSceneDef, nav: TownNav, seed: number, k: number): LegDest {
  const poi = def.pointsOfInterest[poiIndex(def, seed, k)];
  const p = pointNear(def, nav, stream(seed, 'offset', k), poi.x, poi.z, poi.radius) ?? [poi.x, poi.z];
  return { x: p[0], z: p[1], lookAt: poi.lookAt ?? null };
}

function legDest(def: TownSceneDef, nav: TownNav, seed: number, k: number): LegDest {
  const rng = stream(seed, 'leg', k);
  if (rng.next() < TOWN_STROLL_CHANCE) {
    const base = poiPoint(def, nav, seed, k - 1);
    const p = pointNear(def, nav, rng, base.x, base.z, TOWN_STROLL_RADIUS);
    return p ? { x: p[0], z: p[1], lookAt: null } : { ...base, lookAt: null };
  }
  return poiPoint(def, nav, seed, k);
}

function facingTowards(fromX: number, fromZ: number, toX: number, toZ: number): number {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}

function pathLength(path: [number, number][]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return length;
}

/** Walking pose `travelled` units along `path` (null once past its end). */
function alongPath(path: [number, number][], travelled: number): TownPose | null {
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const seg = Math.hypot(bx - ax, bz - az);
    if (travelled <= seg && seg > 0) {
      const f = travelled / seg;
      return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, facing: facingTowards(ax, az, bx, bz), state: 'walk' };
    }
    travelled -= seg;
  }
  return null;
}

/** Facing at the end of a path: towards `lookAt` when given, else along the last segment. */
function arrivalFacing(path: [number, number][], toX: number, toZ: number, lookAt: [number, number] | null | undefined): number {
  if (lookAt) return facingTowards(toX, toZ, lookAt[0], lookAt[1]);
  if (path.length >= 2) {
    const [ax, az] = path[path.length - 2];
    return facingTowards(ax, az, toX, toZ);
  }
  return 0;
}

function walkLeg(
  nav: TownNav,
  from: { x: number; z: number },
  to: LegDest,
  walkStart: number,
  legEnd: number,
  t: number,
): TownPose {
  const path = nav.path(from.x, from.z, to.x, to.z);
  const length = pathLength(path);
  const available = ((legEnd - walkStart) * MAX_WALK_FRACTION) / 1000;
  const speed = Math.max(TOWN_WALK_SPEED, available > 0 ? length / available : TOWN_WALK_SPEED);
  const travelled = (Math.max(0, t - walkStart) / 1000) * speed;
  if (travelled < length) {
    const pose = alongPath(path, travelled);
    if (pose) return pose;
  }
  return { x: to.x, z: to.z, facing: arrivalFacing(path, to.x, to.z, to.lookAt), state: 'idle' };
}

/** Plain wandering: in leg k, walk from dest(k-1) to dest(k), then wait. */
function wanderPose(def: TownSceneDef, nav: TownNav, seed: number, tMs: number): TownPose {
  const k = legIndex(seed, tMs);
  const start = legStart(seed, k);
  return walkLeg(nav, legDest(def, nav, seed, k - 1), legDest(def, nav, seed, k), start, start + TOWN_LEG_MS, tMs);
}

/**
 * Wandering that starts walking right away from `from` at `at` (after a
 * click-to-move). The first walk heads to the current leg's destination, or,
 * when less than half of that leg is left, to the next leg's (a longer first
 * leg instead of a wait); from then on the legs are the plain ones.
 */
function resumeWander(def: TownSceneDef, nav: TownNav, seed: number, from: { x: number; z: number }, at: number, tMs: number): TownPose {
  const k0 = legIndex(seed, at);
  const first = legStart(seed, k0) + TOWN_LEG_MS - at >= TOWN_LEG_MS / 2 ? k0 : k0 + 1;
  const firstEnd = legStart(seed, first) + TOWN_LEG_MS;
  if (tMs < firstEnd) return walkLeg(nav, from, legDest(def, nav, seed, first), at, firstEnd, tMs);
  return wanderPose(def, nav, seed, tMs);
}

/** When a click-to-move reaches its destination (epoch ms). */
export function townMoveArrival(nav: TownNav, move: TownMove): number {
  const path = nav.path(move.fromX, move.fromZ, move.toX, move.toZ);
  return move.at + (pathLength(path) / TOWN_MOVE_SPEED) * 1000;
}

function movePose(def: TownSceneDef, nav: TownNav, seed: number, move: TownMove, tMs: number): TownPose {
  const path = nav.path(move.fromX, move.fromZ, move.toX, move.toZ);
  if (tMs <= move.at) {
    // A client clock slightly behind the server: hold the start instead of replaying older history.
    const facing = path.length >= 2 ? facingTowards(path[0][0], path[0][1], path[1][0], path[1][1]) : 0;
    return { x: move.fromX, z: move.fromZ, facing, state: 'idle' };
  }
  const travelled = ((tMs - move.at) / 1000) * TOWN_MOVE_SPEED;
  const length = pathLength(path);
  if (travelled < length) {
    const pose = alongPath(path, travelled);
    if (pose) return pose;
  }
  const resumeAt = move.at + (length / TOWN_MOVE_SPEED) * 1000 + TOWN_MOVE_RESUME_MS;
  if (tMs < resumeAt) return { x: move.toX, z: move.toZ, facing: arrivalFacing(path, move.toX, move.toZ, move.lookAt), state: 'idle' };
  return resumeWander(def, nav, seed, { x: move.toX, z: move.toZ }, resumeAt, tMs);
}

/**
 * Deterministic town position of a character at server time `tMs`.
 *
 * Time is split into legs of TOWN_LEG_MS aligned to a global epoch with a
 * per-seed phase. In leg k the character walks from dest(k-1) to dest(k)
 * and waits there. dest(k) depends only on (seed, k), so every client
 * computes the same pose without simulating from the epoch.
 *
 * Player input only adds small records the server stores and broadcasts once:
 * a click-to-move (`move`, which then hands back to wandering by itself), an
 * emote or `/sleep` (the pose held from their `at`). Nothing runs on the server
 * between them, online or offline.
 */
export function positionAt(def: TownSceneDef, nav: TownNav, entry: WanderEntry, tMs: number): TownPose {
  const { seed, sleeping, wakeFrom } = entry;
  if (sleeping) {
    const pose = positionAt(def, nav, { ...entry, sleeping: null, emote: null }, sleeping.at);
    return { ...pose, state: 'sleep' };
  }
  if (entry.emote) {
    const pose = positionAt(def, nav, { ...entry, emote: null }, entry.emote.at);
    return { ...pose, state: entry.emote.kind };
  }
  if (entry.move) return movePose(def, nav, seed, entry.move, tMs);

  const k = legIndex(seed, tMs);
  const start = legStart(seed, k);
  const end = start + TOWN_LEG_MS;

  if (wakeFrom && wakeFrom.at <= tMs) {
    const kw = legIndex(seed, wakeFrom.at);
    // Too little of the wake leg left to walk at normal speed: wait in place
    // and start from the wake point on the next leg instead.
    const wakeLeg = legStart(seed, kw) + TOWN_LEG_MS - wakeFrom.at >= TOWN_LEG_MS / 2 ? kw : kw + 1;
    if (k < wakeLeg) return { x: wakeFrom.x, z: wakeFrom.z, facing: 0, state: 'idle' };
    if (k === wakeLeg) {
      const walkStart = wakeLeg === kw ? wakeFrom.at : start;
      return walkLeg(nav, wakeFrom, legDest(def, nav, seed, k), walkStart, end, tMs);
    }
  }

  return wanderPose(def, nav, seed, tMs);
}
