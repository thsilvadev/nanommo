import { Injectable, signal } from '@angular/core';

export type PreloadProgress = (done: number, total: number) => void;
export type PreloadTask = (onProgress?: PreloadProgress) => Promise<void>;

/** Runs every task at once as one preload: progress is the sum of each task's latest report; a failed task counts as finished. */
export function combinePreloads(tasks: PreloadTask[]): PreloadTask {
  return async (onProgress) => {
    const latest = tasks.map(() => ({ done: 0, total: 0 }));
    const report = () => onProgress?.(latest.reduce((s, r) => s + r.done, 0), latest.reduce((s, r) => s + r.total, 0));
    await Promise.all(tasks.map((task, i) => task((done, total) => { latest[i] = { done, total }; report(); })
      .catch(() => undefined)
      .then(() => { if (latest[i].done < latest[i].total) { latest[i] = { done: latest[i].total, total: latest[i].total }; report(); } })));
  };
}
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
