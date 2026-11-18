/**
 * Types shared by the Angular town-scene component and the three.js runtime.
 * Must not import three.js: the component is eager, the runtime is lazy.
 */
import { InjectionToken } from '@angular/core';
import type { TownRosterEntry, TownSceneDef } from '@nanommo/shared';
import { isWebglAvailable } from '../../../shared/character-viewer/character-viewer.component';

export interface TownPick { kind: 'npc' | 'character'; id: string }

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
  screenPositionOf(kind: TownPick['kind'], id: string): [number, number] | null;
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

export const TOWN_SCENE_ENV = new InjectionToken<TownSceneEnv>('TOWN_SCENE_ENV', {
  providedIn: 'root',
  factory: () => ({
    webglAvailable: isWebglAvailable,
    loadScene: async (mapId: string) => (await loadTownScenes()).find((t) => t.mapId === mapId) ?? null,
    // three.js (and the runtime) load only when a town scene is shown.
    createRuntime: async (host, init) => (await import('./town-runtime')).createTownRuntime(host, init),
    assetBase: '/assets/character/',
  }),
});
