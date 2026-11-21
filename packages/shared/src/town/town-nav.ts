import type { TownObstacle, TownSceneDef, TownStairsSide } from './town-scene.types';

/** Clearance added around every obstacle footprint when rasterising. */
export const TOWN_OBSTACLE_CLEARANCE = 0.4;

const DEFAULT_RADIUS: Partial<Record<TownObstacle['kind'], number>> = {
  tree: 1,
  tall_tree: 1.2,
  lamp: 0.4,
  pillar: 0.8,
  rock: 1,
  tower: 4,
  campfire: 1.2,
  altar: 4.5,
  well: 1.4,
};

/** A balcony's stairs reach this far out from the platform edge on their side. */
export const TOWN_STAIRS_LENGTH = 2.5;
/** Stairs strip width (across the stairs). */
const STAIRS_WIDTH = 2;
const STAIRS_DIR: Record<TownStairsSide, [number, number]> = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] };

const SQRT2 = Math.SQRT2;
const MAX_FIELDS = 128;
const MAX_PATHS = 4096;

// 8 neighbours: [dx, dz, cost]
const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Footprint radius of a circular obstacle, or null when it is a `w×d` rectangle. */
export function obstacleRadius(o: TownObstacle): number | null {
  if (o.w != null && o.d != null) return null;
  return o.r ?? DEFAULT_RADIUS[o.kind] ?? 1;
}

/** cos/sin of a rotation in degrees; exact for multiples of 90° so grids match on every JS engine. */
function rotation(deg: number): [number, number] {
  const q = ((deg % 360) + 360) % 360;
  if (q === 0) return [1, 0];
  if (q === 90) return [0, 1];
  if (q === 180) return [-1, 0];
  if (q === 270) return [0, -1];
  const a = (q * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/** Point (px, pz) in the obstacle's local frame (inverse of its `rot`). */
function toLocal(o: TownObstacle, px: number, pz: number): [number, number] {
  const [cos, sin] = rotation(o.rot ?? 0);
  const dx = px - o.x;
  const dz = pz - o.z;
  return [dx * cos - dz * sin, dx * sin + dz * cos];
}

/** Local-frame point of an obstacle back to world coordinates. */
function toWorld(o: TownObstacle, lx: number, lz: number): { x: number; z: number } {
  const [cos, sin] = rotation(o.rot ?? 0);
  return { x: o.x + lx * cos + lz * sin, z: o.z - lx * sin + lz * cos };
}

/** Half extent of a balcony's platform along its stairs axis. */
function stairsEdge(o: TownObstacle): number {
  const [ux] = STAIRS_DIR[o.stairs ?? 'e'];
  return ux !== 0 ? o.w! / 2 : o.d! / 2;
}

/** True when (px, pz) lies on a balcony's platform (no clearance): NPCs may stand there. */
export function balconyContains(o: TownObstacle, px: number, pz: number): boolean {
  if (o.kind !== 'balcony' || o.w == null || o.d == null) return false;
  const [lx, lz] = toLocal(o, px, pz);
  return Math.abs(lx) <= o.w / 2 && Math.abs(lz) <= o.d / 2;
}

/** Ground point 1u past the end of a balcony's stairs (where its NPC's POI goes), already rotated. */
export function balconyStairsFoot(o: TownObstacle): { x: number; z: number } {
  const [ux, uz] = STAIRS_DIR[o.stairs ?? 'e'];
  const reach = stairsEdge(o) + TOWN_STAIRS_LENGTH + 1;
  return toWorld(o, ux * reach, uz * reach);
}

function obstacleCovers(o: TownObstacle, px: number, pz: number): boolean {
  const radius = obstacleRadius(o);
  if (radius != null) {
    const dx = px - o.x;
    const dz = pz - o.z;
    const rr = radius + TOWN_OBSTACLE_CLEARANCE;
    return dx * dx + dz * dz <= rr * rr;
  }
  const [lx, lz] = toLocal(o, px, pz);
  if (Math.abs(lx) <= o.w! / 2 + TOWN_OBSTACLE_CLEARANCE && Math.abs(lz) <= o.d! / 2 + TOWN_OBSTACLE_CLEARANCE) return true;
  if (o.kind !== 'balcony') return false;
  // The stairs strip in front of the `stairs` edge.
  const [ux, uz] = STAIRS_DIR[o.stairs ?? 'e'];
  const along = lx * ux + lz * uz;
  const across = lx * -uz + lz * ux;
  const edge = stairsEdge(o);
  return along >= edge - TOWN_OBSTACLE_CLEARANCE && along <= edge + TOWN_STAIRS_LENGTH + TOWN_OBSTACLE_CLEARANCE
    && Math.abs(across) <= STAIRS_WIDTH / 2 + TOWN_OBSTACLE_CLEARANCE;
}

/** Min-heap of cell indices keyed by a distance array. */
class CellHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size(): number { return this.items.length; }
  push(cell: number, key: number): void {
    const items = this.items;
    const keys = this.keys;
    let i = items.length;
    items.push(cell);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p]; keys[i] = keys[p];
      i = p;
    }
    items[i] = cell; keys[i] = key;
  }
  pop(): [number, number] {
    const items = this.items;
    const keys = this.keys;
    const top: [number, number] = [items[0], keys[0]];
    const lastItem = items.pop()!;
    const lastKey = keys.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        items[i] = items[c]; keys[i] = keys[c];
        i = c;
      }
      items[i] = lastItem; keys[i] = lastKey;
    }
    return top;
  }
}

/**
 * Walk grid of a town scene: 1 world unit = 1 cell, cell (cx, cz) covers
 * [cx, cx+1) × [cz, cz+1). A cell is blocked when its centre falls inside an
 * obstacle footprint inflated by TOWN_OBSTACLE_CLEARANCE, or it is out of bounds.
 *
 * Pure and deterministic: no Math.random, same answers on every client.
 */
export class TownNav {
  readonly w: number;
  readonly h: number;
  private readonly grid: Uint8Array;
  private readonly free: number;
  private readonly fields = new Map<number, Float64Array>();
  private readonly reach = new Map<number, Set<number>>();
  private readonly paths = new Map<string, [number, number][]>();

  constructor(def: TownSceneDef) {
    this.w = def.size.w;
    this.h = def.size.h;
    this.grid = new Uint8Array(this.w * this.h);
    let free = 0;
    for (let cz = 0; cz < this.h; cz++) {
      for (let cx = 0; cx < this.w; cx++) {
        const px = cx + 0.5;
        const pz = cz + 0.5;
        const isBlocked = def.obstacles.some(o => obstacleCovers(o, px, pz));
        this.grid[cz * this.w + cx] = isBlocked ? 1 : 0;
        if (!isBlocked) free++;
      }
    }
    this.free = free;
  }

  blocked(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return true;
    return this.grid[cz * this.w + cx] === 1;
  }

  freeCellCount(): number {
    return this.free;
  }

  /** Set of cell indices (cz*w+cx) reachable from the cell holding (x, z). */
  reachableFrom(x: number, z: number): Set<number> {
    const start = this.cellIndex(x, z);
    const cached = this.reach.get(start);
    if (cached) return cached;
    const seen = new Set<number>();
    if (start >= 0 && this.grid[start] === 0) {
      const queue = [start];
      seen.add(start);
      for (let qi = 0; qi < queue.length; qi++) {
        const cell = queue[qi];
        const cx = cell % this.w;
        const cz = (cell - cx) / this.w;
        for (const [dx, dz] of NEIGHBOURS) {
          if (!this.canStep(cx, cz, dx, dz)) continue;
          const next = (cz + dz) * this.w + (cx + dx);
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
    }
    this.reach.set(start, seen);
    return seen;
  }

  /**
   * The point itself when its cell is free and reachable from (fromX, fromZ),
   * else the centre of the reachable cell closest to it (null when nothing is
   * reachable). Click-to-move destinations go through this.
   */
  nearestReachable(x: number, z: number, fromX: number, fromZ: number): [number, number] | null {
    const reach = this.reachableFrom(fromX, fromZ);
    const own = this.cellIndex(x, z);
    if (own >= 0 && reach.has(own)) return [x, z];
    let best: number | null = null;
    let bestD = Infinity;
    for (const cell of reach) {
      const cx = cell % this.w;
      const cz = (cell - cx) / this.w;
      const d = (cx + 0.5 - x) ** 2 + (cz + 0.5 - z) ** 2;
      if (d < bestD || (d === bestD && best !== null && cell < best)) { bestD = d; best = cell; }
    }
    if (best === null) return null;
    const bx = best % this.w;
    return [bx + 0.5, (best - bx) / this.w + 0.5];
  }

  /**
   * Smoothed walkable polyline from (fromX, fromZ) to (toX, toZ), including both
   * endpoints. Falls back to the straight segment when no grid path exists.
   */
  path(fromX: number, fromZ: number, toX: number, toZ: number): [number, number][] {
    const key = `${fromX},${fromZ}>${toX},${toZ}`;
    const cached = this.paths.get(key);
    if (cached) return cached;
    const result = this.computePath(fromX, fromZ, toX, toZ);
    if (this.paths.size >= MAX_PATHS) this.paths.clear();
    this.paths.set(key, result);
    return result;
  }

  /** True when every cell the segment touches is free (exact grid traversal). */
  lineClear(ax: number, az: number, bx: number, bz: number): boolean {
    let cx = Math.floor(ax);
    let cz = Math.floor(az);
    const ex = Math.floor(bx);
    const ez = Math.floor(bz);
    const dx = bx - ax;
    const dz = bz - az;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? 1 / Math.abs(dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? 1 / Math.abs(dz) : Infinity;
    let tMaxX = stepX > 0 ? (cx + 1 - ax) * tDeltaX : stepX < 0 ? (ax - cx) * tDeltaX : Infinity;
    let tMaxZ = stepZ > 0 ? (cz + 1 - az) * tDeltaZ : stepZ < 0 ? (az - cz) * tDeltaZ : Infinity;
    const limit = Math.abs(ex - cx) + Math.abs(ez - cz) + 2;
    for (let i = 0; i <= limit; i++) {
      if (this.blocked(cx, cz)) return false;
      if (cx === ex && cz === ez) return true;
      if (Math.abs(tMaxX - tMaxZ) < 1e-9) {
        // Passing exactly through a corner: both side cells must be free.
        if (this.blocked(cx + stepX, cz) || this.blocked(cx, cz + stepZ)) return false;
        cx += stepX; cz += stepZ;
        tMaxX += tDeltaX; tMaxZ += tDeltaZ;
      } else if (tMaxX < tMaxZ) {
        cx += stepX; tMaxX += tDeltaX;
      } else {
        cz += stepZ; tMaxZ += tDeltaZ;
      }
    }
    return !this.blocked(ex, ez);
  }

  private cellIndex(x: number, z: number): number {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return -1;
    return cz * this.w + cx;
  }

  /** 8-way step that never cuts a blocked corner. */
  private canStep(cx: number, cz: number, dx: number, dz: number): boolean {
    if (this.blocked(cx + dx, cz + dz)) return false;
    if (dx !== 0 && dz !== 0 && (this.blocked(cx + dx, cz) || this.blocked(cx, cz + dz))) return false;
    return true;
  }

  /** Distance-to-target field (Dijkstra, 8-way, diagonal cost √2), cached per target cell. */
  private field(target: number): Float64Array {
    const cached = this.fields.get(target);
    if (cached) return cached;
    const dist = new Float64Array(this.w * this.h).fill(Infinity);
    if (this.grid[target] === 0) {
      dist[target] = 0;
      const heap = new CellHeap();
      heap.push(target, 0);
      while (heap.size > 0) {
        const [cell, d] = heap.pop();
        if (d > dist[cell]) continue;
        const cx = cell % this.w;
        const cz = (cell - cx) / this.w;
        for (const [dx, dz, cost] of NEIGHBOURS) {
          // Steps are symmetric, so the field also describes walking towards the target.
          if (!this.canStep(cx, cz, dx, dz)) continue;
          const next = (cz + dz) * this.w + (cx + dx);
          const nd = d + cost;
          if (nd < dist[next]) {
            dist[next] = nd;
            heap.push(next, nd);
          }
        }
      }
    }
    if (this.fields.size >= MAX_FIELDS) {
      const oldest = this.fields.keys().next().value as number;
      this.fields.delete(oldest);
    }
    this.fields.set(target, dist);
    return dist;
  }

  private computePath(fromX: number, fromZ: number, toX: number, toZ: number): [number, number][] {
    const start = this.cellIndex(fromX, fromZ);
    const target = this.cellIndex(toX, toZ);
    if (start < 0 || target < 0) return [[fromX, fromZ], [toX, toZ]];
    if (start === target) return [[fromX, fromZ], [toX, toZ]];
    const dist = this.field(target);
    if (!Number.isFinite(dist[start])) return [[fromX, fromZ], [toX, toZ]];

    // Descend the field from the start cell to the target cell.
    const raw: [number, number][] = [[fromX, fromZ]];
    let cell = start;
    let guard = this.w * this.h;
    while (cell !== target && guard-- > 0) {
      const cx = cell % this.w;
      const cz = (cell - cx) / this.w;
      let best = -1;
      let bestD = dist[cell];
      for (const [dx, dz, cost] of NEIGHBOURS) {
        if (!this.canStep(cx, cz, dx, dz)) continue;
        const next = (cz + dz) * this.w + (cx + dx);
        const nd = dist[next] + cost * 1e-9; // deterministic tie-break towards straight steps
        if (nd < bestD) { bestD = nd; best = next; }
      }
      if (best < 0) break;
      cell = best;
      const nx = cell % this.w;
      raw.push([nx + 0.5, (cell - nx) / this.w + 0.5]);
    }
    raw.push([toX, toZ]);

    // String-pulling: keep only the points needed to stay in line of sight.
    const out: [number, number][] = [raw[0]];
    let anchor = 0;
    while (anchor < raw.length - 1) {
      let next = anchor + 1;
      for (let j = raw.length - 1; j > anchor + 1; j--) {
        if (this.lineClear(raw[anchor][0], raw[anchor][1], raw[j][0], raw[j][1])) { next = j; break; }
      }
      out.push(raw[next]);
      anchor = next;
    }
    return out;
  }
}
