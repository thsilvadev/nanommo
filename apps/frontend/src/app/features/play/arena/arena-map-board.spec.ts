import { signal } from '@angular/core';
import { MapBoard } from '../components';
import { ARENA_VIEW_FADE_MS } from './arena-view-mode';

describe('MapBoard arena view', () => {
  function board(webgl = true) {
    const b: any = Object.create(MapBoard.prototype);
    b.arenaChoice = signal<'map' | 'arena' | null>(null);
    b.viewFade = signal(false);
    b.arenaPlace = null;
    b.webgl = webgl;
    return b;
  }
  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  it('switching to the arena fades to black for 1 s, swaps, then fades back', () => {
    const b = board();
    b.setArenaMode('arena');
    expect(b.viewFade()).toBeTrue();
    expect(b.arenaChoice()).toBeNull();
    jasmine.clock().tick(ARENA_VIEW_FADE_MS);
    expect(b.arenaChoice()).toBe('arena');
    jasmine.clock().tick(1);
    expect(b.viewFade()).toBeFalse();
  });

  it('a second click during the fade is ignored', () => {
    const b = board();
    b.setArenaMode('arena');
    b.setArenaMode('map');
    jasmine.clock().tick(ARENA_VIEW_FADE_MS + 1);
    expect(b.arenaChoice()).toBe('arena');
  });

  it('arriving at the destination grind map fades into the arena', () => {
    const b = board();
    b.trackArenaPlace({ inTown: false, traveling: true, isGrind: true });
    b.trackArenaPlace({ inTown: false, traveling: true, isGrind: true });
    expect(b.viewFade()).toBeFalse();
    b.trackArenaPlace({ inTown: false, traveling: false, isGrind: true });
    expect(b.viewFade()).toBeTrue();
    jasmine.clock().tick(ARENA_VIEW_FADE_MS + 1);
    expect(b.arenaChoice()).toBe('arena');
  });

  it('without WebGL arriving never fades', () => {
    const b = board(false);
    b.trackArenaPlace({ inTown: false, traveling: true, isGrind: true });
    b.trackArenaPlace({ inTown: false, traveling: false, isGrind: true });
    expect(b.viewFade()).toBeFalse();
  });

  it('entering a town forgets the arena at once', () => {
    const b = board();
    b.arenaChoice.set('arena');
    b.trackArenaPlace({ inTown: false, traveling: true, isGrind: true });
    b.trackArenaPlace({ inTown: true, traveling: false, isGrind: false });
    expect(b.arenaChoice()).toBeNull();
    expect(b.viewFade()).toBeFalse();
  });
});
