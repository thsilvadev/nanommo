import { Injectable, InjectionToken, effect, inject, signal, untracked } from '@angular/core';
import type { CharacterAppearance, Sex } from '@nanommo/shared';
import { CharacterStore } from '../../../core/game.store';
import { isWebglAvailable } from '../../../shared/character-viewer/appearance-catalog';
import type { PreloadProgress } from '../game-preload.service';
import { renderFace, type FaceLook, type FaceRenderEnv } from './character-face-render';

export type { FaceLook, FaceRenderEnv } from './character-face-render';

const STORAGE_KEY = 'nanommo.face';

export const CHARACTER_FACE_RENDER = new InjectionToken<FaceRenderEnv>('CHARACTER_FACE_RENDER', {
  providedIn: 'root',
  factory: () => ({ webglAvailable: isWebglAvailable, render: renderFace }),
});

/**
 * The player's own 3D face (bare head, no helmet) as a picture for the arena toggle: rendered once on
 * the loading screen and kept in the browser by look, so a reload reuses it and only a new look renders.
 */
@Injectable({ providedIn: 'root' })
export class CharacterFaceService {
  private readonly env = inject(CHARACTER_FACE_RENDER);
  private readonly character = inject(CharacterStore);
  private readonly face = signal<string | null>(null);
  readonly url = this.face.asReadonly();
  private renderedKey: string | null = null;
  private rendering: Promise<void> | null = null;

  constructor() {
    // A new look after loading (the creator, a barber): render it once.
    effect(() => {
      const look = this.look();
      if (look && this.keyOf(look) !== this.renderedKey) untracked(() => void this.ensure(look));
    });
  }

  /** Loading-screen task: waits (up to `waitMs`) for the character's look, then fetches or renders the face. */
  async preload(onProgress?: PreloadProgress, waitMs = 15_000): Promise<void> {
    onProgress?.(0, 1);
    if (this.env.webglAvailable()) {
      const look = await this.waitForLook(waitMs);
      if (look) await this.ensure(look).catch(() => undefined);
    }
    onProgress?.(1, 1);
  }

  private ensure(look: FaceLook): Promise<void> {
    const key = this.keyOf(look);
    if (key === this.renderedKey) return Promise.resolve();
    if (this.rendering) return this.rendering.then(() => this.ensure(look));
    this.renderedKey = key;
    const stored = this.read();
    if (stored?.key === key && stored.url) { this.face.set(stored.url); return Promise.resolve(); }
    if (!this.env.webglAvailable()) return Promise.resolve();
    this.rendering = this.env.render(look)
      .then((url) => { this.face.set(url); this.write({ key, url }); })
      // A failed look is not retried this session: each try builds a WebGL context (a hitch per Character update).
      .catch(() => undefined)
      .finally(() => { this.rendering = null; });
    return this.rendering;
  }

  private look(): FaceLook | null {
    const c = this.character.character() as { sex?: Sex; heightCm?: number; appearance?: CharacterAppearance | null; dominantHand?: string } | null;
    if (!c?.appearance || !c.sex) return null;
    return { sex: c.sex, heightCm: c.heightCm ?? (c.sex === 'female' ? 168 : 178), appearance: c.appearance, dominantHand: c.dominantHand === 'left' ? 'left' : 'right' };
  }

  private async waitForLook(waitMs: number): Promise<FaceLook | null> {
    const until = Date.now() + waitMs;
    for (;;) {
      const look = untracked(() => this.look());
      if (look || Date.now() >= until) return look;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private keyOf(look: FaceLook): string {
    return JSON.stringify({ v: 1, sex: look.sex, heightCm: look.heightCm, appearance: look.appearance });
  }

  private read(): { key: string; url: string } | null {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'); } catch { return null; }
  }

  private write(value: { key: string; url: string }): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* storage blocked or full: this session keeps it */ }
  }
}
