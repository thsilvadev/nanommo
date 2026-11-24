/**
 * Types shared by the Angular town-scene component and the three.js runtime.
 * Must not import three.js: the component is eager, the runtime is lazy.
 */
import { InjectionToken } from '@angular/core';
import type { TownEventVase, TownRosterEntry, TownSceneDef } from '@nanommo/shared';
import { isWebglAvailable } from '../../../shared/character-viewer/character-viewer.component';

export interface TownPick { kind: 'npc' | 'character' | 'vase'; id: string }

/** Time from the start of the attack swing to its contact frame: the vase shatters (and sounds) then. */
export const VASE_CONTACT_MS = 280;

export interface TownSceneRuntimeInit {
  def: TownSceneDef;
  /** Server clock (ms); every client derives the same poses from it. */
  now: () => number;
  assetBase: string;
  catalogUrl?: string;
  npcNames: Record<string, string>;
  selfId: string | null;
}

export interface TownSceneRuntimeHandle {
  setCharacters(entries: TownRosterEntry[], selfId: string | null): void;
  /** Pixel coordinates relative to the scene element. */
  pick(x: number, y: number): TownPick | null;
  /** World (x, z) of the ground under a pixel, or null off the town. */
  groundPoint(x: number, y: number): [number, number] | null;
  /** Local ground marker for a click-to-move. */
  markDestination(x: number, z: number): void;
  setSelection(target: TownPick | null): void;
  /** Smashing Spree vases to show (null fades them out). A subset of the shown set hides the missing ones. */
  setVases(vases: TownEventVase[] | null): void;
  /** Break a vase: the attacker swings, the vase shatters at contact. Returns where it stood, or null if unknown/already broken. */
  breakVase(vaseId: string, byCharacterId: string, prize: boolean): [number, number] | null;
  setHoveredVase(vaseId: string | null): void;
  /** World (x, z) of the local character now (from positionAt), or null. */
  selfPosition(): [number, number] | null;
  /** Hidden scene (map view): stop the render loop; showing it again resumes it. */
  setActive(active: boolean): void;
  screenPositionOf(kind: 'npc' | 'character', id: string): [number, number] | null;
  pan(dxPx: number, dyPx: number): void;
  zoom(factor: number, atPx?: [number, number]): void;
  resize(): void;
  dispose(): void;
}

export interface TownSceneEnv {
  webglAvailable: () => boolean;
  loadScene: (mapId: string) => Promise<TownSceneDef | null>;
  createRuntime: (host: HTMLElement, init: TownSceneRuntimeInit) => Promise<TownSceneRuntimeHandle>;
  assetBase?: string;
  /** Warms three.js, the town catalogue and the character/NPC models in the background. */
  /** Downloads/prepares what towns need (loading screen); reports progress as settled tasks. */
  preload?: (onProgress?: (done: number, total: number) => void) => Promise<void>;
}

let scenes: Promise<TownSceneDef[]> | null = null;
/** Town scene catalogue mirror, fetched once (only when a town scene opens). */
export function loadTownScenes(url = '/data/town_scenes.json'): Promise<TownSceneDef[]> {
  if (!scenes) {
    const pending = fetch(url).then((response) => {
      if (!response.ok) throw new Error('Unable to load the town scenes');
      return response.json() as Promise<{ towns: TownSceneDef[] }>;
    }).then((catalog) => catalog.towns ?? []);
    scenes = pending;
    pending.catch(() => { if (scenes === pending) scenes = null; });
  }
  return scenes;
}

let preloading: Promise<void> | null = null;
/**
 * Background warm-up when the game connects, so opening a town (or switching
 * back to it) does not wait for downloads: the lazy three.js chunk, the town
 * catalogue and the shared models. Once per page; failures are ignored (the
 * scene loads them again when it opens). Across reloads, the browser's HTTP
 * cache keeps them (see vercel.json headers).
 */
export function preloadTownScene(assetBase: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  if (!preloading) {
    preloading = (async () => {
      if (!isWebglAvailable()) return;
      const [runtime] = await Promise.all([import('./town-runtime'), loadTownScenes()]);
      await runtime.warmTownAssets(assetBase, undefined, onProgress);
    })().catch(() => { preloading = null; });
  }
  return preloading;
}

export const TOWN_SCENE_ENV = new InjectionToken<TownSceneEnv>('TOWN_SCENE_ENV', {
  providedIn: 'root',
  factory: () => ({
    webglAvailable: isWebglAvailable,
    loadScene: async (mapId: string) => (await loadTownScenes()).find((t) => t.mapId === mapId) ?? null,
    // three.js (and the runtime) load only when a town scene is shown.
    createRuntime: async (host, init) => (await import('./town-runtime')).createTownRuntime(host, init),
    assetBase: '/assets/character/',
    preload: (onProgress?: (done: number, total: number) => void) => preloadTownScene('/assets/character/', onProgress),
  }),
});
