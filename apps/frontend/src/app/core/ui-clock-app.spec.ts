import { ApplicationRef, Component, inject, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { UiClockService } from './ui-clock.service';

@Component({ selector: 'nm-clock-probe', standalone: true, template: `<span class="now">{{ clock.now() }}</span>` })
class ClockProbeComponent { readonly clock = inject(UiClockService); }

/**
 * Same change detection setup as app.config.ts: the clock ticks outside the
 * zone, yet views reading it must refresh (Angular schedules them from the
 * signal), and nothing else may re-check the app in the meantime.
 */
describe('UiClockService in a zone-based app', () => {
  it('refreshes views that read it about 4 times a second, and only then', async () => {
    const host = document.createElement('nm-clock-probe');
    document.body.appendChild(host);
    const app = await bootstrapApplication(ClockProbeComponent, { providers: [provideZoneChangeDetection({ eventCoalescing: true })] });
    try {
      const appRef = app.injector.get(ApplicationRef);
      let ticks = 0;
      const originalTick = appRef.tick.bind(appRef);
      appRef.tick = () => { ticks++; originalTick(); };
      const span = host.querySelector('.now')!;
      const seen = new Set<string>();
      const sample = setInterval(() => seen.add(span.textContent ?? ''), 50);
      await new Promise(r => setTimeout(r, 2000));
      clearInterval(sample);
      expect(seen.size).toBeGreaterThanOrEqual(6);
      // ~8 clock ticks in 2 s, plus the sampling timer above (in the zone, 40 checks).
      expect(ticks).toBeLessThan(60);
    } finally {
      app.destroy();
      host.remove();
    }
  });
});
