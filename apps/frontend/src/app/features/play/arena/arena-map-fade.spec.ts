import { arenaMapFade, nextMapChange, type ArenaMapChange } from './arena-map-fade';

describe('arenaMapFade', () => {
  it('fades to white, swaps the map at the peak, fades back', () => {
    const change: ArenaMapChange = { atMs: 1000, fromMapId: 'a', toMapId: 'b' };
    expect(arenaMapFade(change, 1250).white).toBeCloseTo(0.5, 6);
    expect(arenaMapFade(change, 1250).mapId).toBe('a');
    expect(arenaMapFade(change, 1500)).toEqual({ white: 1, mapId: 'b' });
    expect(arenaMapFade(change, 1750).white).toBeCloseTo(0.5, 6);
    expect(arenaMapFade(change, 1750).mapId).toBe('b');
    expect(arenaMapFade(change, 2000)).toEqual({ white: 0, mapId: 'b' });
    expect(arenaMapFade(null, 2000)).toEqual({ white: 0, mapId: null });
  });

  it('a second change during the fade ends on the last map without showing the middle one', () => {
    const first: ArenaMapChange = { atMs: 1000, fromMapId: 'a', toMapId: 'b' };
    const second = nextMapChange(first, 'c', 1600)!;
    expect(second.fromMapId).toBe('b');
    expect(arenaMapFade(second, 1600).white).toBeCloseTo(arenaMapFade(first, 1600).white, 6);
    expect(arenaMapFade(second, 2100).mapId).toBe('c');
    for (let t = 1600; t <= 2600; t += 50) {
      const f = arenaMapFade(second, t);
      expect(f.white === 0 && f.mapId === 'b').withContext(`t=${t}`).toBeFalse();
    }
  });

  it('the first map seen is no change, and a change after the fade starts from clear', () => {
    expect(nextMapChange(null, 'a', 500)).toBeNull();
    const first: ArenaMapChange = { atMs: 1000, fromMapId: 'a', toMapId: 'b' };
    expect(nextMapChange(first, 'c', 5000)).toEqual({ atMs: 5000, fromMapId: 'b', toMapId: 'c' });
  });
});
