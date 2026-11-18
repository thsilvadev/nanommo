import { Mulberry32, mulberry32Seed } from '../battle-engine/prng';
import type { TownNav } from './town-nav';
import type { TownPose, TownRosterEntry, TownSceneDef } from './town-scene.types';

/** Duration of one movement leg (walk to a destination, then wait there). */
export const TOWN_LEG_MS = 24000;
/** Walking speed in world units per second. */
export const TOWN_WALK_SPEED = 2.2;
/** Chance that a leg is a short stroll around the previous POI instead of a new POI. */
export const TOWN_STROLL_CHANCE = 0.25;
/** Radius of a short stroll, in world units. */
export const TOWN_STROLL_RADIUS = 6;
/** The walk must fit in this fraction of the leg; otherwise the speed scales up. */
const MAX_WALK_FRACTION = 0.8;
const POINT_DRAWS = 16;

type WanderEntry = Pick<TownRosterEntry, 'seed' | 'sleeping' | 'wakeFrom'>;
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

function walkLeg(
  nav: TownNav,
  from: { x: number; z: number },
  to: LegDest,
  walkStart: number,
  legEnd: number,
  t: number,
): TownPose {
  const path = nav.path(from.x, from.z, to.x, to.z);
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  const available = ((legEnd - walkStart) * MAX_WALK_FRACTION) / 1000;
  const speed = Math.max(TOWN_WALK_SPEED, available > 0 ? length / available : TOWN_WALK_SPEED);
  let travelled = (Math.max(0, t - walkStart) / 1000) * speed;

  if (travelled < length) {
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
  }

  let facing = 0;
  if (to.lookAt) facing = facingTowards(to.x, to.z, to.lookAt[0], to.lookAt[1]);
  else if (path.length >= 2) {
    const [ax, az] = path[path.length - 2];
    facing = facingTowards(ax, az, to.x, to.z);
  }
  return { x: to.x, z: to.z, facing, state: 'idle' };
}

/**
 * Deterministic town position of a character at server time `tMs`.
 *
 * Time is split into legs of TOWN_LEG_MS aligned to a global epoch with a
 * per-seed phase. In leg k the character walks from dest(k-1) to dest(k)
 * and waits there. dest(k) depends only on (seed, k), so every client
 * computes the same pose without simulating from the epoch.
 */
export function positionAt(def: TownSceneDef, nav: TownNav, entry: WanderEntry, tMs: number): TownPose {
  const { seed, sleeping, wakeFrom } = entry;
  if (sleeping) {
    const pose = positionAt(def, nav, { seed, wakeFrom, sleeping: null }, sleeping.at);
    return { ...pose, state: 'sleep' };
  }

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

  return walkLeg(nav, legDest(def, nav, seed, k - 1), legDest(def, nav, seed, k), start, end, tMs);
}
