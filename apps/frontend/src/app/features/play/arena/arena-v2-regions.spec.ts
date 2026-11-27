import { ArenaRegionId } from './arena-region';
import { FLAT_PROPS, arenaPropLayout } from './arena-prop-layout';
import { ArenaScenery, arenaHasNearLayer, arenaLight } from './arena-scenery';
import { arenaAtmosphere } from './arena-atmosphere';

/**
 * The arena scenery standard set by caete (2026-11-27): nothing painted cutting the 3D scene (at most the
 * painted sky, which nothing reaches), fog that reaches into the battle, a dense undergrowth behind the grid,
 * ankle-low cover on the battle floor, and the region's air (mist wisps, motes of light).
 */
const V2: Array<{ region: ArenaRegionId; sky: boolean }> = [
  { region: 'caete', sky: false },
  { region: 'forest_ruins', sky: false },
];

describe('arena v2 regions (the caete standard)', () => {
  for (const { region, sky } of V2) {
    it(`${region}: no painted layer but ${sky ? 'the sky' : 'none'}, fog into the battle, its own air`, () => {
      expect(arenaHasNearLayer(region)).toBeFalse();
      const scenery = new ArenaScenery(1);
      scenery.setRegion(region, 0);
      scenery.update(0, 16, 16);
      expect(scenery.group.getObjectByName('arena:backdrop')!.children.length).toBe(sky ? 1 : 0);
      expect(scenery.group.getObjectByName('arena:motes')).toBeTruthy();
      scenery.dispose();
      const fog = arenaLight(region).fog!;
      expect(fog).toBeTruthy();
      expect(fog.near).toBeLessThan(16); // the camera stands ~20 m from the grid: the haze starts before it
      expect(arenaAtmosphere(region)).not.toBeNull();
    });

    it(`${region}: dense undergrowth behind the grid, cover on the battle floor, nothing past the fog`, () => {
      const props = arenaPropLayout(region);
      const behind = props.filter((p) => !FLAT_PROPS.has(p.kind) && p.z < -13.5 && p.z > -25);
      expect(behind.length).withContext('standing props behind the grid').toBeGreaterThan(450);
      const floor = props.filter((p) => FLAT_PROPS.has(p.kind) && Math.abs(p.z) < 12);
      expect(floor.length).withContext('ground cover on the battle floor').toBeGreaterThan(600);
      const far = arenaLight(region).fog!.far;
      for (const p of props) expect(-p.z).withContext(`${p.kind} z=${p.z.toFixed(1)}`).toBeLessThan(far);
    });
  }
});
