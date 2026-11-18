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
  ground: { base: string; accent: string; pattern: TownGroundPattern };
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
  lastSeenAt: string;
}

export interface TownPose {
  x: number;
  z: number;
  /** Radians around Y; 0 faces +Z (atan2(dx, dz)). */
  facing: number;
  state: 'walk' | 'idle' | 'sleep';
}
