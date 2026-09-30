import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoginMusicService {
  private audio: HTMLAudioElement | null = null;
  private gestureBound = false;
  private fading = false;
  private readonly storageKey = 'nanommo:login-music-volume';
  readonly volume = signal(this.readVolume());
  readonly playing = signal(false);
  readonly muted = signal(false);

  private readVolume(): number {
    const stored = Number(localStorage.getItem(this.storageKey));
    return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 0.38;
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio('/assets/ragnarok-login.mp3');
      this.audio.loop = true;
      this.audio.preload = 'auto';
      this.audio.volume = this.volume();
      this.audio.addEventListener('play', () => this.playing.set(true));
      this.audio.addEventListener('pause', () => this.playing.set(false));
      this.audio.addEventListener('ended', () => this.playing.set(false));
    }
    return this.audio;
  }

  start(): void {
    if (this.fading) return;
    const audio = this.ensureAudio();
    audio.loop = true;
    audio.volume = this.muted() ? 0 : this.volume();
    if (!audio.paused) return;

    void audio.play().catch(() => this.bindGestureRetry());
  }

  private bindGestureRetry(): void {
    if (this.gestureBound) return;
    this.gestureBound = true;
    const retry = () => {
      this.gestureBound = false;
      this.start();
    };
    document.addEventListener('pointerdown', retry, { once: true, capture: true });
    document.addEventListener('keydown', retry, { once: true, capture: true });
  }

  setVolume(value: number): void {
    const next = Math.min(1, Math.max(0, Number(value)));
    this.volume.set(next);
    localStorage.setItem(this.storageKey, String(next));
    this.muted.set(next === 0);
    if (this.audio) this.audio.volume = next;
  }

  toggleMute(): void {
    if (this.muted()) {
      const restored = this.volume() > 0 ? this.volume() : 0.38;
      this.muted.set(false);
      if (this.audio) this.audio.volume = restored;
      if (this.audio?.paused) this.start();
    } else {
      this.muted.set(true);
      if (this.audio) this.audio.volume = 0;
    }
  }

  async fadeOut(durationMs = 2000): Promise<void> {
    const audio = this.audio;
    if (!audio || audio.paused) {
      this.playing.set(false);
      return;
    }
    this.fading = true;
    const initial = audio.volume;
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const progress = Math.min(1, (now - started) / durationMs);
        audio.volume = initial * (1 - progress);
        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = this.muted() ? 0 : this.volume();
          this.playing.set(false);
          this.fading = false;
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }
}
