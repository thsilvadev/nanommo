import { nearbyMonsterIds } from './arena-monster-set';

describe('nearbyMonsterIds (real maps.json)', () => {
  let maps: any[] = [];
  beforeAll(async () => { maps = (await (await fetch('/data/maps.json')).json()).maps; });

  /** Every species of the maps within one step (both axes) of `mapId`, the map included. */
  const expected = (mapId: string): string[] => {
    const at = maps.find((m) => m.id === mapId).coordinates;
    const ids = new Set<string>();
    for (const m of maps) {
      if (!m.coordinates || Math.abs(m.coordinates.x - at.x) > 1 || Math.abs(m.coordinates.y - at.y) > 1) continue;
      for (const row of m.monsters ?? []) {
        ids.add(row.monsterId);
        for (const c of row.raid?.candidates ?? []) ids.add(c.monsterId);
      }
    }
    return [...ids].sort();
  };

  it('a grind map warms its own species and its neighbours', () => {
    const ids = nearbyMonsterIds(maps, 'map_green_grounds_0');
    expect(ids).toContain('mon_slime');
    expect(ids).toContain('mon_fieldbat');
    expect(ids).toEqual(expected('map_green_grounds_0'));
    expect(ids.length).toBeLessThan(new Set(maps.flatMap((m) => (m.monsters ?? []).map((r: any) => r.monsterId))).size);
  });

  it('town warms its border maps', () => {
    const ids = nearbyMonsterIds(maps, 'map_town');
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(expected('map_town'));
  });

  it('an unknown map warms nothing', () => {
    expect(nearbyMonsterIds(maps, 'map_nowhere')).toEqual([]);
    expect(nearbyMonsterIds(maps, null)).toEqual([]);
    expect(nearbyMonsterIds([], 'map_town')).toEqual([]);
  });

  it('ignores a malformed monsters field', () => {
    expect(nearbyMonsterIds([{ id: 'a', coordinates: { x: 0, y: 0 }, monsters: { monsterId: 'mon_x' } }], 'a')).toEqual([]);
  });
});
