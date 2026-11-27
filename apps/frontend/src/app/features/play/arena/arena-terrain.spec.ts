import { ARENA_REGIONS } from './arena-region';
import { ARENA_PROP_PERIOD_M, FLAT_PROPS, arenaPropLayout, propLocalX } from './arena-prop-layout';
import { ARENA_FLAT_HALF_DEPTH_M, terrainHeight } from './arena-terrain';
import { cellToWorld } from './arena-camera';

describe('arena terrain', () => {
  it('is flat over the whole battle grid (feet stay on the ground), whatever the region relief', () => {
    for (const row of [0, 9]) {
      const z = cellToWorld({ row, column: 0 }).z;
      for (let x = -50; x <= 50; x += 0.7) expect(terrainHeight(x, z + Math.sign(z) * 1.2, 1.5)).toBe(0);
    }
  });

  it('rises in mounds behind the grid, lower in front, and not at all where the region is flat', () => {
    const behind = Array.from({ length: 200 }, (_, i) => terrainHeight(i * 0.5, -24, 1));
    expect(Math.max(...behind)).toBeGreaterThan(0.8);
    expect(Math.min(...behind)).toBeGreaterThan(0);
    const front = Array.from({ length: 200 }, (_, i) => terrainHeight(i * 0.5, 24, 1));
    expect(Math.max(...front)).toBeLessThan(Math.max(...behind));
    expect(terrainHeight(3, -24, 0)).toBe(0);
  });

  it('is smooth: no step between neighbouring 1 m vertices', () => {
    for (let z = -30; z <= 30; z += 1) for (let x = 0; x < 60; x += 1) expect(Math.abs(terrainHeight(x + 1, z, 1.5) - terrainHeight(x, z, 1.5))).toBeLessThan(0.5);
  });
});

describe('arena props', () => {
  it('only flat props (leaves, pebbles, twigs) lie inside the battle band', () => {
    for (const region of ARENA_REGIONS) {
      for (const p of arenaPropLayout(region)) {
        if (!FLAT_PROPS.has(p.kind)) expect(Math.abs(p.z)).withContext(`${region} ${p.kind} z=${p.z.toFixed(2)}`).toBeGreaterThan(ARENA_FLAT_HALF_DEPTH_M);
      }
    }
  });

  it('the same layout on every visit, and every region but the bridge has rocks or blocks', () => {
    expect(arenaPropLayout('kwaioua_forest')).toEqual(arenaPropLayout('kwaioua_forest'));
    for (const region of ARENA_REGIONS.filter((r) => r !== 'gods_bridge')) {
      expect(arenaPropLayout(region).some((p) => p.kind === 'rock' || p.kind === 'block')).withContext(region).toBeTrue();
    }
  });

  it('props scroll left as the party walks and wrap far off-screen', () => {
    expect(propLocalX(100, 0)).toBeCloseTo(100 - ARENA_PROP_PERIOD_M / 2, 6);
    expect(propLocalX(100, 10)).toBeCloseTo(propLocalX(100, 0) - 10, 6);
    for (let t = 0; t < 1000; t += 13) {
      const x = propLocalX(37, t);
      expect(x).toBeGreaterThanOrEqual(-ARENA_PROP_PERIOD_M / 2);
      expect(x).toBeLessThan(ARENA_PROP_PERIOD_M / 2);
    }
  });

  it("kwaioua's giant trunks are evenly spread behind the grid, and its nearest bushes grow twice as big", () => {
    const props = arenaPropLayout('kwaioua_forest');
    const trunks = props.filter((p) => p.kind === 'trunk').sort((a, b) => a.u - b.u);
    expect(trunks.length).toBe(9);
    for (const t of trunks) { expect(t.z).toBeLessThan(-15.9); expect(t.z).toBeGreaterThan(-22.1); }
    for (let i = 1; i < trunks.length; i++) expect(trunks[i].u - trunks[i - 1].u).withContext(`gap ${i}`).toBeGreaterThan(8);
    const bigShrubs = props.filter((p) => p.kind === 'shrub' && p.size > 3.3);
    expect(bigShrubs.length).toBeGreaterThan(10); // the grown "small trees" (1.9–3.3 m doubled)
    expect(props.some((p) => p.kind === 'log')).toBeFalse();
  });
});
