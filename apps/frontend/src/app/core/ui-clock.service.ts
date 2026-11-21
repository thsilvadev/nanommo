import { Injectable, NgZone, OnDestroy, Signal, inject, signal } from '@angular/core';

/** Refresh rate of countdowns, progress bars and other wall-clock UI. */
export const UI_CLOCK_INTERVAL_MS = 250;

/**
 * One wall clock for the whole UI instead of a `setInterval` per component.
 *
 * The timer runs outside the Angular zone, so it never triggers a global
 * change detection by itself: only views whose templates (or computeds) read
 * `now()` are refreshed (Angular 18 schedules them from the signal change).
 * Before this, every component ticked its own 250 ms timer inside the zone and
 * each tick re-checked the entire app.
 */
@Injectable({ providedIn: 'root' })
export class UiClockService implements OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly _now = signal(Date.now());
  private readonly timer: ReturnType<typeof setInterval>;
  readonly now: Signal<number> = this._now.asReadonly();

  constructor() {
    this.timer = this.zone.runOutsideAngular(() => setInterval(() => this._now.set(Date.now()), UI_CLOCK_INTERVAL_MS));
  }

  ngOnDestroy(): void { clearInterval(this.timer); }
}
