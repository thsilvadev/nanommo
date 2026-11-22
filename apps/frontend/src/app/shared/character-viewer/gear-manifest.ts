/**
 * The wearable gear built by tools/character-assets/gear (see gear/manifest.json):
 * skinned pieces per sex on our 65 joints (body joint order), rigid pieces pinned to a bone,
 * one texture atlas for all of them.
 */
import type * as THREE from 'three';
import type { Sex } from '@nanommo/shared';

/** Bump with every gear rebuild that changes manifest.json (vercel caches /assets/character/*). */
export const GEAR_ASSET_VERSION = 1;
export const GEAR_MANIFEST_ASSET = 'gear/manifest.json';

export type Region = 'head' | 'neck' | 'torso' | 'upperarms' | 'forearms' | 'hands' | 'thighs' | 'calves' | 'feet';
/** Skin hidden under a shell (bind-pose heights, metres): a vertex of that region inside the band. */
export interface HideBand { region: Region; minY: number; maxY: number }

export interface GearVisual {
  slot: 'head' | 'body' | 'cape' | 'shoes' | 'mainHand' | 'offHand';
  kind: 'skinned' | 'rigid';
  /** Body regions hidden under the piece. */
  covers?: Region[];
  hide?: Partial<Record<Sex, HideBand[]>>;
  hidesHair?: boolean;
  hidesBeard?: boolean;
  /** Rigid: the bone it is pinned to, and per sex the bone-space matrix (16 numbers, column-major). */
  bone?: string;
  transform?: Record<Sex, number[]>;
  weaponType?: string;
}

export interface GearManifest {
  version: string;
  atlas: string;
  items: Record<string, string>;
  visuals: Record<string, GearVisual>;
}

export interface LoadedGear {
  manifest: GearManifest;
  atlas: THREE.Texture;
  /** visual id -> skinned mesh, per sex (shared: clone geometry before mutating). */
  skinned: Record<Sex, Map<string, THREE.SkinnedMesh>>;
  /** visual id -> rigid piece (a mesh, bows with a 'BowString' child mesh). */
  rigid: Map<string, THREE.Object3D>;
}
