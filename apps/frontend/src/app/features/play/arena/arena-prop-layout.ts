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
/** Height of the unit giant trunk model (metres, before its instance size). */
export const ARENA_TRUNK_HEIGHT_M = 30;

/** Procedural kinds (built in arena-props) and modelled kinds (`MODEL_PROPS`, loaded from props.glb). */
export type ArenaPropKind = 'rock' | 'block' | 'bush' | 'log' | 'twig' | 'leaf' | 'pebble' | 'palm' | 'post'
  | 'fern' | 'shrub' | 'tuft' | 'flowers' | 'stump' | 'deadtree' | 'mossrock' | 'trunk' | 'bigleaf' | 'sprout' | 'column' | 'slab' | 'hill' | 'blossom' | 'crag' | 'peak' | 'snow' | 'shell' | 'starfish' | 'arch' | 'wall' | 'drum' | 'frostrock' | 'shard' | 'puddle';
/** Kinds drawn from `assets/arena/props.glb` (tools/arena-assets/build-arena-props.mjs): colours baked per vertex, tinted per instance. */
export const MODEL_PROPS: ReadonlySet<ArenaPropKind> = new Set(['fern', 'shrub', 'tuft', 'flowers', 'stump', 'deadtree', 'mossrock']);
export interface ArenaPropSpec {
  kind: ArenaPropKind;
  count: number;
  colors: string[];
  /** Size range (metres, the kind's unit size scaled uniformly). */
  size: [number, number];
  /** Depth bands (world z, metres) to scatter over. */
  bands: Array<[number, number]>;
  /** Evenly spaced along the strip (a little jitter) instead of at random: big things that must not bunch up. */
  even?: boolean;
  /** The `count` instances nearest the grid are `factor` times bigger. */
  grow?: { count: number; factor: number };
}
export interface ArenaPropInstance { kind: ArenaPropKind; u: number; z: number; size: number; yaw: number; tilt: number; color: string; variant: number }

/** Standing props may only use these bands (behind the grid is where the relief rises). */
const BEHIND: [number, number] = [-24, -(ARENA_FLAT_HALF_DEPTH_M + 0.8)];
const FRONT: [number, number] = [ARENA_FLAT_HALF_DEPTH_M + 1.5, 26];
/**
 * Regions without a painted near layer fill the ground up to the far layer (70 m) with 3D plants:
 * a thinning undergrowth past the grid's back rows, then a dense edge in front of the painted far trees.
 */
const DEEP: [number, number] = [-40, -24];
const EDGE: [number, number] = [-50, -38];
/** Flat props can lie anywhere, battle band included. */
const ALL: [number, number] = [-24, 22];

const stone = ['#8a8f87', '#7a7f78', '#9a9a8e', '#6f746c'];
const PROPS: Record<ArenaRegionId, ArenaPropSpec[]> = {
  green_grounds: [
    // An open meadow under a clear sky: rolling hills on the horizon, round trees, a little grass and a few flowers.
    { kind: 'hill', count: 9, colors: ['#7fae5a', '#74a252', '#88b664'], size: [22, 34], bands: [[-82, -60]], even: true },
    { kind: 'shrub', count: 22, colors: ['#5f9a44', '#6aa84c', '#558e3c'], size: [4, 7], bands: [[-50, -30]] },
    { kind: 'shrub', count: 22, colors: ['#6aa84c', '#5f9a44', '#78b458'], size: [2.6, 4.4], bands: [[-27, -17], DEEP] },
    { kind: 'shrub', count: 30, colors: ['#6aa84a', '#5f9a3f', '#78b458'], size: [0.6, 1.3], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'tuft', count: 70, colors: ['#8ac05a', '#7ab04c', '#94c864'], size: [1.2, 2.4], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'flowers', count: 24, colors: ['#ffffff', '#f6f6f6'], size: [0.9, 1.4], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'rock', count: 34, colors: stone, size: [0.35, 1.1], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'mossrock', count: 8, colors: ['#b0b8a0', '#a0a890'], size: [0.8, 1.4], bands: [BEHIND, DEEP] },
    // The battle floor: a few sprouts and little flowers, pebbles.
    { kind: 'sprout', count: 160, colors: ['#6aaa44', '#7aba4c', '#5f9a3a', '#88c058'], size: [0.9, 1.6], bands: [ALL] },
    { kind: 'blossom', count: 130, colors: ['#ffffff', '#fff27a', '#ffb6d0', '#c8b4ff', '#9fd0ff', '#ffffff'], size: [0.8, 1.4], bands: [ALL] },
    { kind: 'pebble', count: 140, colors: ['#9a9a8e', '#7a7f78', '#b0ab98'], size: [0.06, 0.16], bands: [ALL] },
  ],
  menace_hills: [
    // Dry rocky hills at sunset: crags and bare hills fading into the dust, gnarled dead trees; no grass, no bushes.
    { kind: 'hill', count: 10, colors: ['#a0704a', '#8c6040', '#b07c52'], size: [20, 32], bands: [[-82, -58]], even: true },
    { kind: 'crag', count: 14, colors: ['#8c6a4c', '#7a5c40', '#9a7656'], size: [2.6, 5], bands: [[-52, -30]], even: true },
    { kind: 'crag', count: 12, colors: ['#8c6a4c', '#7a5c40', '#9a7656'], size: [0.9, 1.7], bands: [BEHIND, DEEP] },
    { kind: 'rock', count: 60, colors: ['#8c7c62', '#7a6a50', '#9a8a6c', '#6e6250'], size: [0.4, 1.6], bands: [BEHIND, BEHIND, BEHIND, BEHIND, FRONT] },
    { kind: 'deadtree', count: 26, colors: ['#a08c78', '#8a7a6a'], size: [0.5, 0.85], bands: [BEHIND, BEHIND, DEEP] },
    { kind: 'stump', count: 8, colors: ['#9a8a7a', '#8a7a6a'], size: [0.7, 1.1], bands: [BEHIND, DEEP] },
    // The battle floor: pebbles, dead twigs and dry leaves.
    { kind: 'pebble', count: 300, colors: ['#9a8a6c', '#7a6a50', '#b09460'], size: [0.06, 0.2], bands: [ALL] },
    { kind: 'twig', count: 90, colors: ['#7a6a4a', '#5f5040'], size: [0.5, 1.1], bands: [ALL] },
    { kind: 'leaf', count: 220, colors: ['#8a6a3a', '#a07a40', '#6a5030'], size: [0.16, 0.3], bands: [ALL] },
  ],
  kwaioua_forest: [
    // Fallen trunks of every girth (the log scales as a whole: thin branches to old trunks).
    // Giant standing trunks with buttress roots (sapopemas) right behind the grid; their canopy (shrubs) far overhead.
    { kind: 'trunk', count: 9, colors: ['#6b5a48', '#5d4c3c', '#76644f'], size: [1.15, 1.7], bands: [[-22, -16]], even: true },
    // The modelled bush round the grid: low clumps, and big ones (2–3.5 m) standing in for small trees.
    { kind: 'shrub', count: 170, colors: ['#5a7a4c', '#4c6a40', '#66865a'], size: [0.7, 1.5], bands: [BEHIND, BEHIND, BEHIND, BEHIND, FRONT, DEEP], grow: { count: 40, factor: 2 } },
    { kind: 'shrub', count: 90, colors: ['#5a7a4c', '#4c6a40', '#66865a', '#455f3a'], size: [1.9, 3.3], bands: [BEHIND, BEHIND, DEEP], grow: { count: 24, factor: 2 } },
    { kind: 'rock', count: 22, colors: ['#5f6b52', '#55604a', '#6b7660'], size: [0.35, 1.0], bands: [BEHIND, FRONT] },
    { kind: 'bush', count: 64, colors: ['#1f3a17', '#25401a', '#2e4a20', '#173214'], size: [0.7, 1.7], bands: [BEHIND, BEHIND, BEHIND, FRONT] },
    // Modelled undergrowth (no painted near layer here): ferns everywhere behind, a dense shrub edge far back.
    { kind: 'fern', count: 150, colors: ['#6f8f5f', '#5f7f50', '#7f9f6a', '#56744a'], size: [1.6, 2.8], bands: [BEHIND, BEHIND, BEHIND, DEEP, FRONT] },
    // Past ~45 m the night fog hides almost everything: only a thin edge there.
    { kind: 'shrub', count: 40, colors: ['#5a7a4c', '#4c6a40', '#66865a', '#455f3a'], size: [1.8, 3.4], bands: [EDGE, DEEP] },
    { kind: 'tuft', count: 220, colors: ['#6f8f5a', '#5f7f4c'], size: [1.6, 3], bands: [BEHIND, BEHIND, BEHIND, DEEP, FRONT] },
    { kind: 'stump', count: 10, colors: ['#9a8a7a', '#8a7a6a'], size: [0.8, 1.3], bands: [BEHIND, DEEP, FRONT] },
    { kind: 'mossrock', count: 18, colors: ['#9aa090', '#8a9080'], size: [0.8, 1.6], bands: [BEHIND, DEEP, DEEP, FRONT] },
    { kind: 'twig', count: 70, colors: ['#5a4128', '#6b4e30', '#4a3520'], size: [0.5, 1.1], bands: [ALL] },
    { kind: 'leaf', count: 560, colors: ['#3d5f2c', '#4f7a34', '#6b5a2e', '#8a6a2a', '#a07a30', '#5f7a2a', '#2f4f22'], size: [0.18, 0.34], bands: [ALL] },
    { kind: 'pebble', count: 120, colors: ['#6b7660', '#5f6b52', '#7d7a6a'], size: [0.05, 0.14], bands: [ALL] },
    // Ankle-low sprouts on the battle floor, dark under the night.
    { kind: 'sprout', count: 700, colors: ['#3f6a3a', '#4a7a42', '#355a32', '#527a48'], size: [0.9, 1.7], bands: [ALL] },
  ],
  wastelands: [
    // A cold waste: snowy peaks in the mist, dark basalt shards and snow-capped boulders, dead trees, black pools.
    { kind: 'peak', count: 14, colors: ['#e8eaee', '#dcdfe4'], size: [9, 14], bands: [[-88, -74]], even: true },
    { kind: 'shard', count: 14, colors: ['#e0e4ec', '#d0d4dc', '#eceef4'], size: [2.4, 4.6], bands: [[-55, -32]], even: true },
    { kind: 'shard', count: 16, colors: ['#e0e4ec', '#d0d4dc', '#eceef4'], size: [0.7, 1.5], bands: [BEHIND, DEEP] },
    { kind: 'frostrock', count: 64, colors: ['#e8eaf0', '#d8dce4', '#f0f2f6', '#dcdfe6'], size: [0.4, 1.5], bands: [BEHIND, BEHIND, BEHIND, BEHIND, FRONT] },
    { kind: 'deadtree', count: 18, colors: ['#b0aaa0', '#9a948a'], size: [0.45, 0.8], bands: [BEHIND, DEEP] },
    { kind: 'stump', count: 8, colors: ['#a8a29a', '#98928a'], size: [0.7, 1.1], bands: [BEHIND, DEEP] },
    // The battle floor: old snow, black pools, grey pebbles, dead twigs.
    { kind: 'snow', count: 170, colors: ['#c8ced6', '#bcc4cc', '#d2d8de'], size: [0.6, 1.5], bands: [ALL] },
    { kind: 'puddle', count: 55, colors: ['#0c0d12', '#101218', '#08090c'], size: [1.6, 3.4], bands: [ALL] },
    { kind: 'pebble', count: 320, colors: ['#5a5e68', '#4e525c', '#7a7e88', '#8a8e98'], size: [0.06, 0.2], bands: [ALL] },
    { kind: 'twig', count: 60, colors: ['#7a6a4a', '#5f5040'], size: [0.5, 1.0], bands: [ALL] },
  ],
  caete: [
    // A misty day rainforest: giant mossy trunks right behind the grid, more of them fading into the mist.
    { kind: 'trunk', count: 7, colors: ['#7f8468', '#727a5e', '#8a8c70'], size: [1.2, 1.6], bands: [[-22, -16]], even: true },
    { kind: 'trunk', count: 14, colors: ['#7f8468', '#727a5e', '#8a8c70'], size: [1.05, 1.7], bands: [[-40, -27]], even: true },
    // Big tropical leaves (banana / heliconia): low ones in front, man-high ones behind, the nearest grown.
    { kind: 'bigleaf', count: 190, colors: ['#4a7a3e', '#3f6e36', '#56864a', '#3a6432'], size: [0.6, 1.3], bands: [BEHIND, BEHIND, BEHIND, BEHIND, BEHIND, FRONT] },
    { kind: 'bigleaf', count: 60, colors: ['#4a7a3e', '#3f6e36', '#56864a', '#3a6432'], size: [1.4, 2.4], bands: [BEHIND, DEEP, DEEP], grow: { count: 16, factor: 1.5 } },
    // A thick undergrowth behind the grid: low bush clumps, ferns and grass. Little in front (below the frame) and none deep (the mist hides it).
    { kind: 'shrub', count: 150, colors: ['#6a8a5c', '#5f8052', '#74946a'], size: [0.6, 1.4], bands: [BEHIND, BEHIND, BEHIND, BEHIND, BEHIND, FRONT], grow: { count: 24, factor: 1.8 } },
    { kind: 'shrub', count: 14, colors: ['#5f8052', '#55744a', '#6a8a5c'], size: [2, 3.2], bands: [DEEP] },
    { kind: 'fern', count: 200, colors: ['#5f8f4f', '#4f7f42', '#6f9f5a'], size: [1.3, 2.6], bands: [BEHIND, BEHIND, BEHIND, BEHIND, BEHIND, FRONT] },
    { kind: 'tuft', count: 180, colors: ['#5f8a4c', '#527a42'], size: [1.2, 2.4], bands: [BEHIND, BEHIND, BEHIND, BEHIND, BEHIND, FRONT] },
    // Ankle-low sprouts carpet the whole floor, battle band included.
    { kind: 'sprout', count: 1800, colors: ['#4f7f3a', '#5f8f44', '#3f6f30', '#6a8a3a'], size: [0.9, 1.8], bands: [ALL] },
    { kind: 'log', count: 10, colors: ['#5a4a32', '#4a3d28'], size: [0.8, 1.6], bands: [BEHIND, FRONT] },
    { kind: 'rock', count: 14, colors: ['#5f6b52', '#6b7660'], size: [0.35, 0.9], bands: [BEHIND, FRONT] },
    { kind: 'mossrock', count: 14, colors: ['#a0a890', '#8f9a80'], size: [0.8, 1.5], bands: [BEHIND, DEEP, FRONT] },
    { kind: 'stump', count: 8, colors: ['#9a8a6a', '#8a7a5e'], size: [0.8, 1.3], bands: [BEHIND, DEEP] },
    { kind: 'twig', count: 50, colors: ['#5a4128', '#4a3520'], size: [0.5, 1.1], bands: [ALL] },
    { kind: 'leaf', count: 420, colors: ['#3a5a2c', '#4f7a34', '#5d4a2e', '#6b5a2e', '#2f4f26'], size: [0.18, 0.34], bands: [ALL] },
  ],
  forest_ruins: [
    // An old ruin under a starry night: arches, broken walls and columns, fallen drums and blocks, a few trees.
    { kind: 'column', count: 20, colors: ['#9a9682', '#8f8b78', '#a6a28c'], size: [0.7, 1.35], bands: [[-23, -15]], even: true },
    { kind: 'column', count: 14, colors: ['#9a9682', '#8f8b78'], size: [1.2, 2], bands: [[-44, -28]], even: true },
    { kind: 'arch', count: 7, colors: ['#9a9682', '#a6a28c'], size: [0.9, 1.2], bands: [[-25, -18]], even: true },
    { kind: 'arch', count: 6, colors: ['#9a9682', '#8f8b78'], size: [1.2, 1.7], bands: [[-46, -30]], even: true },
    { kind: 'wall', count: 18, colors: ['#8f8b78', '#9a9682', '#85826f'], size: [0.8, 1.4], bands: [BEHIND, BEHIND, DEEP] },
    { kind: 'drum', count: 22, colors: ['#9a9682', '#8f8b78', '#a6a28c'], size: [0.8, 1.3], bands: [BEHIND, BEHIND, FRONT, DEEP] },
    { kind: 'block', count: 50, colors: ['#8f8b78', '#85826f', '#9a9682'], size: [0.5, 1.3], bands: [BEHIND, BEHIND, DEEP, FRONT] },
    { kind: 'shrub', count: 18, colors: ['#3f5a4a', '#344e40', '#4a6656'], size: [3, 5.5], bands: [[-30, -17], DEEP, DEEP] },
    { kind: 'shrub', count: 30, colors: ['#4a6a56', '#3f5a4a'], size: [0.6, 1.3], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'fern', count: 40, colors: ['#4a6a56', '#3f5a4a'], size: [1.2, 2.2], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'tuft', count: 60, colors: ['#5a7a6a', '#4a6a5a'], size: [1.2, 2.2], bands: [BEHIND, BEHIND, FRONT] },
    { kind: 'mossrock', count: 16, colors: ['#a0a890', '#909880'], size: [0.8, 1.5], bands: [BEHIND, DEEP, FRONT] },
    { kind: 'rock', count: 14, colors: ['#8f8b78', '#7f7c6a'], size: [0.35, 0.9], bands: [BEHIND, FRONT] },
    // The battle floor: worn paving slabs, a few sprouts, fallen leaves, pebbles.
    { kind: 'slab', count: 200, colors: ['#8f8b78', '#85826f', '#7a7866'], size: [0.5, 1.1], bands: [ALL] },
    { kind: 'sprout', count: 120, colors: ['#4a6a56', '#5a7a66', '#3f5a4a'], size: [0.8, 1.5], bands: [ALL] },
    { kind: 'leaf', count: 240, colors: ['#6a6a40', '#8a7a40', '#5a5030', '#4a5a34'], size: [0.18, 0.32], bands: [ALL] },
    { kind: 'pebble', count: 160, colors: ['#9a9682', '#85826f'], size: [0.06, 0.16], bands: [ALL] },
  ],
  ipora_beach: [
    // A tropical beach: only coconut palms behind the grid, then sand down to the 3D sea.
    { kind: 'palm', count: 22, colors: ['#ffffff', '#f2f2e6', '#e8eedc'], size: [0.8, 1.2], bands: [[-25, -15]], even: true },
    { kind: 'log', count: 8, colors: ['#c9b89a', '#b8a585'], size: [0.5, 1.1], bands: [BEHIND, FRONT, [-30, -26]] },
    { kind: 'rock', count: 30, colors: ['#b9a98a', '#a8977a', '#c9b99a'], size: [0.3, 1.1], bands: [BEHIND, BEHIND, FRONT, [-32, -26]] },
    // The battle floor: shells, starfish, pebbles, driftwood bits.
    { kind: 'shell', count: 300, colors: ['#fff4ea', '#ffc8b4', '#f6e0c0', '#ffffff', '#e8c8e0'], size: [1.6, 2.8], bands: [ALL] },
    { kind: 'starfish', count: 90, colors: ['#ff8a50', '#ff6a5a', '#ffae5a', '#e8705a'], size: [0.8, 1.4], bands: [ALL] },
    { kind: 'pebble', count: 360, colors: ['#d9c3a0', '#c8b08a', '#b8a080', '#ffffff'], size: [0.07, 0.18], bands: [ALL] },
    { kind: 'twig', count: 40, colors: ['#c9b89a', '#b8a585'], size: [0.5, 1.0], bands: [ALL] },
  ],
  gods_bridge: [
    // Across the river at sunset: purple hills melting into the haze.
    { kind: 'hill', count: 9, colors: ['#4a2f57', '#553560', '#402a4e'], size: [26, 40], bands: [[-125, -100]], even: true },
    // The deck: leaves blown in, grit between the flagstones (no plants on the stone).
    { kind: 'leaf', count: 520, colors: ['#c0703a', '#a85a30', '#d08a40', '#8a4a2a', '#b0603a'], size: [0.18, 0.32], bands: [[-14, 22]] },
    { kind: 'pebble', count: 260, colors: ['#c2b294', '#a8987a', '#d0c0a0'], size: [0.05, 0.14], bands: [[-14, 22]] },
  ],
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
  // God's Bridge: the parapet's posts, evenly spaced along the deck's back edge.
  if (region === 'gods_bridge') for (let i = 0; i < ARENA_PROP_PERIOD_M / 2.5; i++) out.push({ kind: 'post', u: i * 2.5, z: -14.6, size: 1, yaw: 0, tilt: 0, color: '#c2b294', variant: 0 });
  for (const spec of arenaPropSpecs(region)) {
    const first = out.length;
    for (let i = 0; i < spec.count; i++) {
      const band = spec.bands[Math.floor(r() * spec.bands.length)];
      const u = spec.even ? ((i + 0.5 + (r() - 0.5) * 0.45) / spec.count) * ARENA_PROP_PERIOD_M + (spec.size[0] * 37) % 9 : r() * ARENA_PROP_PERIOD_M;
      out.push({
        kind: spec.kind, u, z: band[0] + r() * (band[1] - band[0]),
        size: spec.size[0] + r() * (spec.size[1] - spec.size[0]), yaw: r() * Math.PI * 2, tilt: (r() - 0.5) * 0.3,
        color: spec.colors[Math.floor(r() * spec.colors.length)], variant: Math.floor(r() * 4),
      });
    }
    if (spec.grow) {
      const mine = out.slice(first).sort((a, b) => Math.abs(a.z) - Math.abs(b.z));
      for (const p of mine.slice(0, spec.grow.count)) p.size *= spec.grow.factor;
    }
  }
  // Giant trunks reach out of every view (no canopy is drawn): each leans slightly its own way.
  for (const trunk of out) if (trunk.kind === 'trunk') trunk.tilt = (r() - 0.5) * 0.16;
  return out;
}

/** Local x (metres from the scenery centre) of a prop when `travelled` metres have been walked. */
export function propLocalX(u: number, travelled: number): number {
  const p = ARENA_PROP_PERIOD_M;
  return ((((u - travelled) % p) + p) % p) - p / 2;
}

/** Kinds low enough for the battle band (flat, or below the ankle). */
export const FLAT_PROPS: ReadonlySet<ArenaPropKind> = new Set(['leaf', 'pebble', 'twig', 'sprout', 'slab', 'blossom', 'snow', 'shell', 'starfish', 'puddle']);
