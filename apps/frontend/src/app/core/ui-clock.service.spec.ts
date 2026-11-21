import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UI_CLOCK_INTERVAL_MS, UiClockService } from './ui-clock.service';

describe('UiClockService', () => {
  it('advances at 4 Hz from a single timer that never runs inside the Angular zone', async () => {
    const zone = TestBed.inject(NgZone);
    let ticksInZone = 0;
    const realSetInterval = window.setInterval;
    const spy = spyOn(window, 'setInterval').and.callFake(((fn: () => void, ms?: number) =>
      realSetInterval(() => { if (NgZone.isInAngularZone()) ticksInZone++; fn(); }, ms)) as typeof setInterval);
    const clock = zone.run(() => TestBed.inject(UiClockService));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(UI_CLOCK_INTERVAL_MS).toBe(250);
    const first = clock.now();
    await new Promise(r => setTimeout(r, 600));
    expect(clock.now()).toBeGreaterThan(first);
    expect(ticksInZone).toBe(0);
  });
});
