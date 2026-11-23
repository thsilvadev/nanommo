import type { CharacterAppearance, Sex } from '../appearance';

export const TOWN_OBSTACLE_KINDS = [
  'tree', 'tall_tree', 'fountain', 'house', 'hut', 'tent', 'pillar', 'pyramid_wall', 'lamp', 'rock', 'fence',
  'balcony', 'tower', 'campfire', 'altar', 'well',
] as const;
export type ObstacleKind = typeof TOWN_OBSTACLE_KINDS[number];

export interface TownObstacle {
  kind: ObstacleKind;
  x: number;
  z: number;
  /** Circle footprint radius. */
  r?: number;
  /** Rectangle footprint (used when both `w` and `d` are present). */
  w?: number;
  d?: number;
  /** Rectangle rotation in degrees around Y. */
  rot?: number;
  height?: number;
  /**
   * `balcony` only: side of the stairs in the obstacle's local frame (before
   * `rot`): 'e' = +x, 'w' = -x, 's' = +z, 'n' = -z.
   */
  stairs?: TownStairsSide;
}

export type TownStairsSide = 'n' | 's' | 'e' | 'w';

export interface TownPoi {
  id: string;
  x: number;
  z: number;
  radius: number;
  weight: number;
  lookAt?: [number, number];
}

export type TownGroundPattern = 'cobblestone' | 'dirt' | 'grass' | 'stone';
export type TownLightingPreset = 'day' | 'night' | 'dusk' | 'sunshaft';

export interface TownSceneDef {
  mapId: string;
  size: { w: number; h: number };
  ground: {
    base: string;
    accent: string;
    pattern: TownGroundPattern;
    /** Patches of grass blended over the base ground (Sierra: green over clay). */
    mix?: { color: string; accent: string; coverage: number };
  };
  lighting: {
    preset: TownLightingPreset;
    ambient: string;
    ambientIntensity: number;
    sun: { color: string; intensity: number; dir: [number, number, number] } | null;
    points: { x: number; z: number; color: string; intensity: number; range: number }[];
    /** Overhead spot light; `angleDeg` is the half-angle of the cone (three.js SpotLight.angle). */
    spot: { x: number; z: number; color: string; intensity: number; angleDeg: number; height: number } | null;
  };
  fog: { color: string; near: number; far: number };
  obstacles: TownObstacle[];
  /**
   * `facing` in degrees around Y; 0 faces +Z (same convention as TownPose.facing).
   * `y` > 0 puts the NPC up on a `balcony` (the walk grid stays 2D: nobody
   * climbs; the NPC's POI sits by the stairs foot).
   */
  npcSpots: Record<string, { x: number; z: number; facing: number; y?: number }>;
  pointsOfInterest: TownPoi[];
  spawn: { x: number; z: number };
}

export interface TownSleep { at: number /* epoch ms */ }
export interface TownWakeFrom { x: number; z: number; at: number /* epoch ms */ }
/**
 * Click-to-move: walk from (fromX, fromZ) to (toX, toZ) starting at `at`,
 * stand there TOWN_MOVE_RESUME_MS, then wander again from that point.
 * `lookAt`: what to face on arrival (the NPC that was clicked).
 */
export interface TownMove { fromX: number; fromZ: number; toX: number; toZ: number; at: number /* epoch ms */; lookAt?: [number, number] | null }
export const TOWN_EMOTES = ['dance', 'sit'] as const;
export type TownEmoteKind = typeof TOWN_EMOTES[number];
/** `/dance`, `/sit`: held where the character was at `at`, with no time limit. */
export interface TownEmote { kind: TownEmoteKind; at: number /* epoch ms */ }

/** Equipment slots shown on the 3D character (accessories are not). */
export const VISIBLE_EQUIPMENT_SLOTS = ['head', 'body', 'cape', 'shoes', 'mainHand', 'offHand'] as const;
export type VisibleEquipmentSlot = typeof VISIBLE_EQUIPMENT_SLOTS[number];
/** Item id per visible slot (absent = empty slot). */
export type VisibleEquipment = Partial<Record<VisibleEquipmentSlot, string>>;
/** Refinement level per visible slot (absent = +0). */
export type VisibleRefinement = Partial<Record<VisibleEquipmentSlot, number>>;
/** Shimmer drawn over a refined 3D piece: 0 none, 1 silver (+10, +11), 2 gold (+12). */
export type RefineGlint = 0 | 1 | 2;
export function refineGlint(level: number | null | undefined): RefineGlint {
  const n = Number(level) || 0;
  return n >= 12 ? 2 : n >= 10 ? 1 : 0;
}

export interface TownRosterEntry {
  characterId: string;
  name: string;
  level: number;
  appearance: CharacterAppearance | null;
  /** Body to render (null until the character went through the creator). */
  sex: Sex | null;
  heightCm: number | null;
  seed: number;
  online: boolean;
  sleeping: TownSleep | null;
  wakeFrom: TownWakeFrom | null;
  /** Last click-to-move (absent on older servers / lazy entries). */
  move?: TownMove | null;
  emote?: TownEmote | null;
  /** Server time the character entered this town (spawn effect); absent when unknown. */
  joinedAt?: number | null;
  /** Grows on every change of this entry's town state: a client keeps the highest one it saw. */
  rev?: number;
  lastSeenAt: string;
  /** Hand gear shown on the selected-player card (item ids; the client maps them to weapon types). */
  dominantHand?: 'right' | 'left';
  mainHandItemId?: string | null;
  offHandItemId?: string | null;
  /** Every visible slot's item (the 3D model wears them); absent on older servers. */
  equipment?: VisibleEquipment;
  /** Refinement of the visible slots (only refined ones); absent on older servers. */
  refinement?: VisibleRefinement;
}

export interface TownPose {
  x: number;
  z: number;
  /** Radians around Y; 0 faces +Z (atan2(dx, dz)). */
  facing: number;
  state: 'walk' | 'idle' | 'sleep' | TownEmoteKind;
}
