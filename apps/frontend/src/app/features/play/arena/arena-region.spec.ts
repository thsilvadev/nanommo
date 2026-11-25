import { ARENA_REGIONS, arenaRegionAssets, arenaRegionOf } from './arena-region';

describe('arenaRegionOf', () => {
  it('every grind map in the catalogue resolves to one of the eight regions by its own prefix', async () => {
    const data = await fetch('/data/maps.json').then((r) => r.json());
    const grind = (data.maps as Array<{ id: string; type: string }>).filter((m) => m.type === 'grind');
    expect(grind.length).toBeGreaterThan(30);
    for (const map of grind) {
      const region = arenaRegionOf(map.id);
      expect(map.id.startsWith(`map_${region}`)).withContext(map.id).toBeTrue();
    }
  });

  it('strips the map_ prefix and the numeric suffix', () => {
    expect(arenaRegionOf('map_menace_hills_2')).toBe('menace_hills');
    expect(arenaRegionOf('map_gods_bridge')).toBe('gods_bridge');
    expect(arenaRegionOf('map_kwaioua_forest_7')).toBe('kwaioua_forest');
  });

  it('falls back to Green Grounds', () => {
    expect(arenaRegionOf(null)).toBe('green_grounds');
    expect(arenaRegionOf('map_somewhere_new_3')).toBe('green_grounds');
  });

  it('every region ships four layers', async () => {
    for (const region of ARENA_REGIONS) {
      const assets = arenaRegionAssets(region);
      for (const url of [assets.sky, assets.far, assets.near, assets.ground]) {
        const res = await fetch(url, { method: 'HEAD' });
        expect(res.ok).withContext(url).toBeTrue();
      }
    }
  });
});
