/**
 * Where the arena's 3D ground props go, per region: rocks, bushes, fallen logs,
 * twigs, leaves, pebbles… Pure data (seeded, no three.js): arena-props builds
 * the instanced meshes from it.
 *
 * Props live on a strip of the travel coordinate that repeats every
 * ARENA_PROP_PERIOD_M metres (wider than any view, so the wrap is never seen).
 * Only flat props (leaves, pebbles) may lie inside the battle band; everything
 * that stands up stays behind or in front of the grid.
 */
import type { ArenaRegionId } from './arena-region';
import { ARENA_FLAT_HALF_DEPTH_M } from './arena-terrain';

export const ARENA_PROP_PERIOD_M = 180;

export type ArenaPropKind = 'rock' | 'block' | 'bush' | 'log' | 'twig' | 'leaf' | 'pebble' | 'palm';
export interface ArenaPropSpec {
  kind: ArenaPropKind;
  count: number;
  colors: string[];
  /** Size range (metres, the kind's unit size scaled uniformly). */
  size: [number, number];
  /** Depth bands (world z, metres) to scatter over. */
  bands: Array<[number, number]>;
}
export interface ArenaPropInstance { kind: ArenaPropKind; u: number; z: number; size: number; yaw: number; tilt: number; color: string; variant: number }

/** Standing props may only use these bands (behind the grid is where the relief rises). */
const BEHIND: [number, number] = [-24, -(ARENA_FLAT_HALF_DEPTH_M + 0.8)];
const FRONT: [number, number] = [ARENA_FLAT_HALF_DEPTH_M + 1.5, 26];
/** Flat props can lie anywhere, battle band included. */
const ALL: [number, number] = [-24, 22];

const stone = ['#8a8f87', '#7a7f78', '#9a9a8e', '#6f746c'];
const PROPS: Record<ArenaRegionId, ArenaPropSpec[]> = {
  green_grounds: [
    { kind: 'rock', count: 34, colors: stone, size: [0.35, 1.1], bands: [BEHIND, FRONT] },
    { kind: 'bush', count: 46, colors: ['#4f8a34', '#5f9a3f', '#3f7a2c', '#6aa84a'], size: [0.6, 1.4], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'pebble', count: 140, colors: ['#9a9a8e', '#7a7f78', '#b0ab98'], size: [0.06, 0.16], bands: [ALL] },
  ],
  menace_hills: [
    { kind: 'rock', count: 52, colors: ['#8c7c62', '#7a6a50', '#9a8a6c', '#6e6250'], size: [0.4, 1.6], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'bush', count: 30, colors: ['#7d7a3e', '#8a8a4a', '#6a6a34'], size: [0.5, 1.1], bands: [BEHIND, FRONT] },
    { kind: 'pebble', count: 160, colors: ['#9a8a6c', '#7a6a50', '#b09460'], size: [0.06, 0.18], bands: [ALL] },
  ],
  kwaioua_forest: [
    // Fallen trunks of every girth (the log scales as a whole: thin branches to old trunks).
    { kind: 'log', count: 26, colors: ['#5a4128', '#4a3520', '#6b4e30', '#3d2c1a'], size: [0.5, 2.4], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'rock', count: 22, colors: ['#5f6b52', '#55604a', '#6b7660'], size: [0.35, 1.0], bands: [BEHIND, FRONT] },
    { kind: 'bush', count: 50, colors: ['#1f3a17', '#25401a', '#2e4a20', '#173214'], size: [0.7, 1.7], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'twig', count: 70, colors: ['#5a4128', '#6b4e30', '#4a3520'], size: [0.5, 1.1], bands: [ALL] },
    { kind: 'leaf', count: 560, colors: ['#3d5f2c', '#4f7a34', '#6b5a2e', '#8a6a2a', '#a07a30', '#5f7a2a', '#2f4f22'], size: [0.18, 0.34], bands: [ALL] },
    { kind: 'pebble', count: 120, colors: ['#6b7660', '#5f6b52', '#7d7a6a'], size: [0.05, 0.14], bands: [ALL] },
  ],
  wastelands: [
    { kind: 'rock', count: 48, colors: ['#8a8170', '#6f685a', '#a59d8a', '#5f594d'], size: [0.4, 1.5], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'bush', count: 14, colors: ['#7a6a4a', '#6a5a3a'], size: [0.4, 0.8], bands: [BEHIND, FRONT] },
    { kind: 'twig', count: 30, colors: ['#7a6a4a', '#5f5040'], size: [0.5, 1.0], bands: [ALL] },
    { kind: 'pebble', count: 170, colors: ['#a59d8a', '#6f685a', '#8a8170'], size: [0.06, 0.18], bands: [ALL] },
  ],
  caete: [
    { kind: 'log', count: 14, colors: ['#4a3a24', '#3d2f1d'], size: [0.6, 1.4], bands: [BEHIND, FRONT] },
    { kind: 'rock', count: 24, colors: ['#4f5a44', '#5d6650'], size: [0.35, 1.0], bands: [BEHIND, FRONT] },
    { kind: 'bush', count: 46, colors: ['#2f4f26', '#3a5a2c', '#24401d'], size: [0.7, 1.5], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'leaf', count: 260, colors: ['#2f4f26', '#5d4a2e', '#3a5a2c'], size: [0.14, 0.24], bands: [ALL] },
  ],
  forest_ruins: [
    { kind: 'block', count: 26, colors: ['#9a9a8c', '#7d7d70', '#8a8a7c'], size: [0.5, 1.3], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'rock', count: 20, colors: stone, size: [0.35, 0.9], bands: [BEHIND, FRONT] },
    { kind: 'bush', count: 36, colors: ['#4d7f34', '#5d8a3f', '#3f6f2c'], size: [0.6, 1.3], bands: [BEHIND, FRONT] },
    { kind: 'pebble', count: 120, colors: ['#9a9a8c', '#8a8a7c'], size: [0.06, 0.16], bands: [ALL] },
  ],
  ipora_beach: [
    { kind: 'rock', count: 14, colors: ['#b9a98a', '#a8977a', '#c9b99a'], size: [0.3, 0.9], bands: [BEHIND, FRONT] },
    { kind: 'pebble', count: 150, colors: ['#f3e6bf', '#e6d2a0', '#d9c3a0', '#ffffff'], size: [0.04, 0.1], bands: [ALL] },
  ],
  gods_bridge: [],
};

export function arenaPropSpecs(region: ArenaRegionId): ArenaPropSpec[] {
  return PROPS[region] ?? [];
}

/** Mulberry32 (same family as the battle engine's PRNG; only for scenery). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** Every prop of a region, seeded by the region (the same layout every visit). */
export function arenaPropLayout(region: ArenaRegionId): ArenaPropInstance[] {
  const r = rng(hash(`arena-props:${region}`));
  const out: ArenaPropInstance[] = [];
  for (const spec of arenaPropSpecs(region)) {
    for (let i = 0; i < spec.count; i++) {
      const band = spec.bands[Math.floor(r() * spec.bands.length)];
      out.push({
        kind: spec.kind, u: r() * ARENA_PROP_PERIOD_M, z: band[0] + r() * (band[1] - band[0]),
        size: spec.size[0] + r() * (spec.size[1] - spec.size[0]), yaw: r() * Math.PI * 2, tilt: (r() - 0.5) * 0.3,
        color: spec.colors[Math.floor(r() * spec.colors.length)], variant: Math.floor(r() * 4),
      });
    }
  }
  return out;
}

/** Local x (metres from the scenery centre) of a prop when `travelled` metres have been walked. */
export function propLocalX(u: number, travelled: number): number {
  const p = ARENA_PROP_PERIOD_M;
  return ((((u - travelled) % p) + p) % p) - p / 2;
}

export const FLAT_PROPS: ReadonlySet<ArenaPropKind> = new Set(['leaf', 'pebble', 'twig']);
