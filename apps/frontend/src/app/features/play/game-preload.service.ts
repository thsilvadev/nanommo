import { Injectable, signal } from '@angular/core';

export type PreloadProgress = (done: number, total: number) => void;
/** Gives up waiting after this long: the game opens and the rest keeps loading in the background. */
export const GAME_PRELOAD_TIMEOUT_MS = 20_000;

/**
 * The loading screen before the game: downloads and prepares the 3D assets every character
 * needs (bodies, animations, gear for 200 players in a town) once, so nothing waits on the
 * network later. A failure or a slow CDN never blocks the game.
 */
@Injectable({ providedIn: 'root' })
export class GamePreloadService {
  readonly ready = signal(false);
  /** 0..1 */
  readonly progress = signal(0);
  private started = false;

  start(preload: ((onProgress?: PreloadProgress) => Promise<void>) | undefined, timeoutMs = GAME_PRELOAD_TIMEOUT_MS): void {
    if (this.started) return;
    this.started = true;
    if (!preload) { this.finish(); return; }
    const timer = setTimeout(() => this.finish(), timeoutMs);
    preload((done, total) => { if (total > 0) this.progress.set(Math.min(1, done / total)); })
      .catch(() => undefined)
      .then(() => { clearTimeout(timer); this.finish(); });
  }

  private finish(): void {
    this.progress.set(1);
    this.ready.set(true);
  }
}
