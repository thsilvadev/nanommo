import type { CharacterAppearance } from '../appearance';

export type ObstacleKind =
  | 'tree' | 'tall_tree' | 'fountain' | 'house' | 'hut' | 'tent' | 'pillar' | 'pyramid_wall' | 'lamp' | 'rock';

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
}

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
    spot: { x: number; z: number; color: string; intensity: number; angleDeg: number; height: number } | null;
  };
  fog: { color: string; near: number; far: number };
  obstacles: TownObstacle[];
  npcSpots: Record<string, { x: number; z: number; facing: number }>;
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
