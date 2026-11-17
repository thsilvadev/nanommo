import type { AppearanceCatalog, CharacterAppearance, HandWeaponType, Sex } from '@nanommo/shared';
import type { AnimationState } from '../character-animation/animation-state';

/** A fixed pose, or a function evaluated by the rig on every frame with the current time. */
export type AnimationSource = AnimationState | ((nowMs: number) => AnimationState);

/**
 * Types shared by the Angular component and the three.js rig. This file must
 * not import three.js: the component imports it eagerly, while the rig (and
 * three.js with it) is loaded on demand.
 */

/** full: whole body in a fixed 2.24 m frame (creator); portrait: whole body facing the screen (Character Summary); bust: head and shoulders. */
export type ViewerFraming = 'full' | 'portrait' | 'bust';

export interface ViewerConfig {
  sex: Sex;
  heightCm: number;
  appearance: CharacterAppearance;
  /** Item shown in each physical hand (already resolved from dominant hand + main/off hand). */
  hands: { right: HandWeaponType | null; left: HandWeaponType | null };
  /** Decides which side is turned towards the camera, so the main-hand item shows in profile. */
  dominantHand: 'right' | 'left';
  interactive: boolean;
  framing: ViewerFraming;
}

/** Read-only view of the rig, used by the component's consumers and tests. */
export interface CharacterRigHandle {
  bone(name: string): { readonly children: ReadonlyArray<{ readonly name: string }> };
  clipNames(): string[];
  /** The clip with the largest effective weight. */
  playingClip(): string | null;
  clipWeight(name: string): number;
  /** Current time of a clip, in seconds. */
  clipTime(name: string): number;
  /**
   * What to play. A function is evaluated on every rendered frame with `clock()`
   * (default Date.now), so the pose follows the clock, not the caller's timers.
   * Changes crossfade; the first frame of a body shows the pose directly.
   */
  setAnimation(source: AnimationSource, clock?: () => number): void;
  /** Renders a frame now (tests and the screenshot harness). */
  renderNow(): void;
  /** Position of a bone in the body's own space (metres, facing +Z), after the last frame. */
  bonePosition(name: string): [number, number, number];
  /** How far the bow string is drawn on the last frame (0 = at rest, 1 = full draw). */
  bowDrawn(): number;
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
