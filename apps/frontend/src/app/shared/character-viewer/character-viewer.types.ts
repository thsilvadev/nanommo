import type { AppearanceCatalog, CharacterAppearance, HandWeaponType, Sex } from '@nanommo/shared';

/**
 * Types shared by the Angular component and the three.js rig. This file must
 * not import three.js: the component imports it eagerly, while the rig (and
 * three.js with it) is loaded on demand.
 */

export type ViewerFraming = 'full' | 'bust';

export interface ViewerConfig {
  sex: Sex;
  heightCm: number;
  appearance: CharacterAppearance;
  /** Item shown in each physical hand (already resolved from dominant hand + main/off hand). */
  hands: { right: HandWeaponType | null; left: HandWeaponType | null };
  interactive: boolean;
  framing: ViewerFraming;
}

/** Read-only view of the rig, used by the component's consumers and tests. */
export interface CharacterRigHandle {
  bone(name: string): { readonly children: ReadonlyArray<{ readonly name: string }> };
  clipNames(): string[];
  playingClip(): string | null;
  modelScale(): number;
  isDisposed(): boolean;
  isRendering(): boolean;
}

export interface CharacterRigOptions {
  assetBase: string;
  catalog: () => Promise<AppearanceCatalog>;
  /** Loads a glTF/GLB; returns three's GLTF result. Typed loosely to keep three.js out of this file. */
  load: (url: string) => Promise<unknown>;
  onContextLost: () => void;
}
