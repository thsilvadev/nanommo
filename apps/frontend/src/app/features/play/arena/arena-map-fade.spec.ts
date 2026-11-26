import { ARENA_MAP_FADE_IN_MS, ARENA_MAP_FADE_MAX_HOLD_MS, ARENA_MAP_FADE_OUT_MS, arenaMapFade, nextMapChange, settleMapChange, type ArenaMapChange } from './arena-map-fade';

// Maps of three different regions (a region change is what fades).
const a = 'map_green_grounds_1', b = 'map_menace_hills_1', c = 'map_ipora_beach_1';

describe('arenaMapFade', () => {
  it('fades to white, swaps the map at the peak, fades back', () => {
    const change: ArenaMapChange = { atMs: 1000, fromMapId: a, toMapId: b };
    expect(arenaMapFade(change, 1250).white).toBeCloseTo(0.5, 6);
    expect(arenaMapFade(change, 1250).mapId).toBe(a);
    expect(arenaMapFade(change, 1500)).toEqual({ white: 1, mapId: b });
    expect(arenaMapFade(change, 1750).white).toBeCloseTo(0.5, 6);
    expect(arenaMapFade(change, 1750).mapId).toBe(b);
    expect(arenaMapFade(change, 2000)).toEqual({ white: 0, mapId: b });
    expect(arenaMapFade(null, 2000)).toEqual({ white: 0, mapId: null });
  });

  it('a second change during the fade ends on the last map without showing the middle one', () => {
    const first: ArenaMapChange = { atMs: 1000, fromMapId: a, toMapId: b };
    const second = nextMapChange(first, c, 1600)!;
    expect(second.fromMapId).toBe(b);
    expect(arenaMapFade(second, 1600).white).toBeCloseTo(arenaMapFade(first, 1600).white, 6);
    expect(arenaMapFade(second, 2100).mapId).toBe(c);
    for (let t = 1600; t <= 2600; t += 50) {
      const f = arenaMapFade(second, t);
      expect(f.white === 0 && f.mapId === b).withContext(`t=${t}`).toBeFalse();
    }
  });

  it('the first map seen is no change, and a change after the fade starts from clear', () => {
    expect(nextMapChange(null, a, 500)).toBeNull();
    const first: ArenaMapChange = { atMs: 1000, fromMapId: a, toMapId: b };
    expect(nextMapChange(first, c, 5000)).toEqual({ atMs: 5000, fromMapId: b, toMapId: c, readyAtMs: null });
  });

  it('a map of the same region swaps at once, without a fade (green_grounds-0 → green_grounds-1)', () => {
    const change = nextMapChange(null, 'map_green_grounds_2', 5000, 'map_green_grounds_1')!;
    expect(arenaMapFade(change, 5000)).toEqual({ white: 0, mapId: 'map_green_grounds_2' });
    const again = nextMapChange(change, 'map_green_grounds_3', 6000)!;
    expect(arenaMapFade(again, 6000)).toEqual({ white: 0, mapId: 'map_green_grounds_3' });
  });

  it('a same-region hop while fading back from a region change keeps that fade and ends on the new map', () => {
    const first: ArenaMapChange = { atMs: 1000, fromMapId: a, toMapId: b };
    const hop = nextMapChange(first, 'map_menace_hills_2', 1700)!;
    expect(arenaMapFade(hop, 1700).white).toBeCloseTo(arenaMapFade(first, 1700).white, 6);
    expect(arenaMapFade(hop, 1700).mapId).toBe('map_menace_hills_2');
    expect(arenaMapFade(hop, 2000)).toEqual({ white: 0, mapId: 'map_menace_hills_2' });
  });

  // The white stays until the new region's scene has loaded, then clears.
  it('a region change holds the white until the new scene is ready', () => {
    const change = nextMapChange(null, b, 1000, a)!;
    expect(change.readyAtMs).toBeNull();
    const peak = change.atMs + ARENA_MAP_FADE_IN_MS;
    expect(arenaMapFade(change, peak + 5000)).toEqual({ white: 1, mapId: b });
    const ready = { ...change, readyAtMs: peak + 5000 };
    expect(arenaMapFade(ready, peak + 5000)).toEqual({ white: 1, mapId: b });
    expect(arenaMapFade(ready, peak + 5000 + ARENA_MAP_FADE_OUT_MS / 2).white).toBeCloseTo(0.5, 6);
    expect(arenaMapFade(ready, peak + 5000 + ARENA_MAP_FADE_OUT_MS)).toEqual({ white: 0, mapId: b });
    // Ready before the peak: the white clears as soon as it is full.
    expect(arenaMapFade({ ...change, readyAtMs: change.atMs }, peak + ARENA_MAP_FADE_OUT_MS / 2).white).toBeCloseTo(0.5, 6);
  });

  it('settleMapChange marks the change ready once the new scene is, past the peak (or after the longest hold)', () => {
    const change = nextMapChange(null, b, 1000, a)!;
    const peak = change.atMs + ARENA_MAP_FADE_IN_MS;
    expect(settleMapChange(change, true, peak - 1)).toBe(change);
    expect(settleMapChange(change, false, peak + 100)).toBe(change);
    expect(settleMapChange(change, true, peak + 100)!.readyAtMs).toBe(peak + 100);
    expect(settleMapChange(change, false, peak + ARENA_MAP_FADE_MAX_HOLD_MS)!.readyAtMs).toBe(peak + ARENA_MAP_FADE_MAX_HOLD_MS);
    const settled = { ...change, readyAtMs: peak };
    expect(settleMapChange(settled, false, peak + 100)).toBe(settled);
    expect(settleMapChange(null, true, 0)).toBeNull();
  });

  it('a second region change while the white holds waits for the newest scene', () => {
    const first = nextMapChange(null, b, 1000, a)!;
    const second = nextMapChange(first, c, 4000)!;
    expect(arenaMapFade(second, 4000)).toEqual({ white: 1, mapId: c });
    expect(second.readyAtMs).toBeNull();
  });
});

