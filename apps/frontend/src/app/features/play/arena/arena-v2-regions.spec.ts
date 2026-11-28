import * as THREE from 'three';
import { ArenaRegionId } from './arena-region';
import { CENTRAL_DEPLOYMENT_ROWS } from '@nanommo/shared';
import { ArenaPropKind, FLAT_PROPS, NEAR_SIDE_PROPS, arenaPropLayout } from './arena-prop-layout';
import { arenaTreeShadows } from './arena-props';
import { cellToWorld } from './arena-camera';
import { ArenaScenery, arenaHasNearLayer, arenaLight } from './arena-scenery';
import { arenaAtmosphere } from './arena-atmosphere';

/**
 * The arena scenery standard (caete, 2026-11-27, refined by the user's review): nothing painted (open regions get
 * a 3D sky dome), the region's air (motes, mist where there is fog), something on the battle floor, and nothing
 * past the fog. A dense undergrowth is a *forest* trait: the other regions keep their vegetation sparse or none.
 */
interface V2Region {
  region: ArenaRegionId;
  /** A 3D sky dome (open sky) rather than a plain background. */
  sky: boolean;
  /** A forest: dense undergrowth behind the grid and a carpet of cover on the battle floor. */
  forest?: boolean;
  /** Fog reaching into the battle (default); `false`: a clear sky, no fog at all. */
  fog?: boolean;
  /** At most this many plants (undergrowth kinds) in the whole region. */
  maxPlants?: number;
}
const V2: V2Region[] = [
  { region: 'kwaioua_forest', sky: false, forest: true },
  { region: 'caete', sky: false, forest: true },
  { region: 'forest_ruins', sky: false, maxPlants: 260 },
  { region: 'green_grounds', sky: true, fog: false, maxPlants: 420 },
  { region: 'menace_hills', sky: true, maxPlants: 0 },
  { region: 'wastelands', sky: true, maxPlants: 0 },
  { region: 'ipora_beach', sky: true, maxPlants: 0 },
  { region: 'gods_bridge', sky: true, maxPlants: 0 },
];
/** Undergrowth: grass, sprouts, bushes, ferns, flowers (trees such as palms, dead trees and round crowns are not). */
const PLANTS: ReadonlySet<ArenaPropKind> = new Set(['sprout', 'tuft', 'bush', 'fern', 'bigleaf', 'flowers', 'blossom']);

describe('arena v2 regions', () => {
  for (const { region, sky, forest, fog = true, maxPlants } of V2) {
    it(`${region}: no painted layer${sky ? ' (a 3D sky dome)' : ''}, ${fog ? 'fog into the battle' : 'a clear sky, no fog'}, its own air`, () => {
      expect(arenaHasNearLayer(region)).toBeFalse();
      const scenery = new ArenaScenery(1);
      scenery.setRegion(region, 0);
      scenery.update(0, 16, 16);
      expect(scenery.group.getObjectByName('arena:backdrop')!.children.length).toBe(0);
      expect(!!scenery.group.getObjectByName('arena:dome')).toBe(sky);
      expect(!!scenery.group.getObjectByName('arena:motes')).toBe(['kwaioua_forest', 'caete', 'forest_ruins'].includes(region));
      scenery.dispose();
      const light = arenaLight(region);
      if (fog) {
        expect(light.fog!.near).toBeLessThan(16); // the camera stands ~20 m from the grid: the haze starts before it
        if (sky) expect(new THREE.Color(light.dome!.horizon).getHex()).toBe(new THREE.Color(light.background).getHex());
        expect(arenaAtmosphere(region)!.wisps.count).toBeGreaterThan(10);
      } else {
        expect(light.fog).toBeUndefined();
        expect(arenaAtmosphere(region)!.wisps.count).toBe(0);
      }
    });

    it(`${region}: ${forest ? 'dense undergrowth and a carpeted battle floor' : `sparse or no undergrowth (≤ ${maxPlants})`}, nothing past the fog`, () => {
      const props = arenaPropLayout(region);
      const floor = props.filter((p) => FLAT_PROPS.has(p.kind) && Math.abs(p.z) < 12);
      if (forest) {
        const behind = props.filter((p) => !FLAT_PROPS.has(p.kind) && p.z < -13.5 && p.z > -25);
        expect(behind.length).withContext('standing props behind the grid').toBeGreaterThan(450);
        expect(floor.length).withContext('ground cover on the battle floor').toBeGreaterThan(600);
      } else {
        expect(props.filter((p) => PLANTS.has(p.kind)).length).withContext('plants').toBeLessThanOrEqual(maxPlants!);
        expect(floor.length).withContext('something on the battle floor').toBeGreaterThan(80);
      }
      const far = arenaLight(region).fog?.far ?? 140;
      for (const p of props) expect(-p.z).withContext(`${p.kind} z=${p.z.toFixed(1)}`).toBeLessThan(far);
    });
  }

  describe('green_grounds (the cosy meadow, 2026-11-27 review)', () => {
    const props = arenaPropLayout('green_grounds');

    it('warm meadow floor: golden dry patches over the grass, a clear sky and no floating particles', () => {
      const light = arenaLight('green_grounds');
      expect(light.meadow).toBeTruthy();
      expect(light.meadow!.cover).toBeGreaterThan(0.15);
      expect(light.meadow!.cover).toBeLessThan(0.5);
      expect(light.fog).toBeUndefined();
      expect(arenaAtmosphere('green_grounds')!.motes.count).toBe(0);
    });

    it('a few trees, all on the far side of the arena, each with its shadow on the ground', () => {
      const trees = props.filter((p) => p.kind === 'tree');
      expect(trees.length).toBeGreaterThan(5);
      expect(trees.length).toBeLessThanOrEqual(24);
      for (const t of trees) expect(t.z).withContext(`tree z=${t.z.toFixed(1)}`).toBeLessThan(-20);
      expect(arenaTreeShadows('green_grounds').length).toBe(trees.length);
    });

    it('a few fences out behind the arena', () => {
      const behind = props.filter((p) => p.kind === 'fence' && p.z < 0);
      expect(behind.length).toBeGreaterThan(0);
      expect(behind.length).toBeLessThanOrEqual(6);
      for (const f of behind) expect(f.z).toBeLessThan(-13.5);
    });

    it('now and then a fence on the near side, never on a row any formation stands on', () => {
      const fences = props.filter((p) => NEAR_SIDE_PROPS.has(p.kind) && p.z > 0);
      expect(fences.length).toBeGreaterThan(0);
      expect(fences.length).toBeLessThanOrEqual(3); // rare: one every ~60 m of the walk or more
      const rows = [...new Set(Object.values(CENTRAL_DEPLOYMENT_ROWS).flat())].map((row) => cellToWorld({ row, column: 0 }).z);
      for (const f of fences) {
        expect(f.z).toBeGreaterThan(0); // between the party and the camera
        for (const z of rows) expect(Math.abs(f.z - z)).withContext(`fence z=${f.z.toFixed(2)} vs row z=${z}`).toBeGreaterThan(0.9);
        expect(Math.abs(f.yaw)).toBeLessThan(0.1); // along the walk
      }
    });

    it('no other region gets fences or meadow trees', () => {
      for (const region of V2.map((r) => r.region).filter((r) => r !== 'green_grounds')) {
        expect(arenaPropLayout(region).some((p) => p.kind === 'fence' || p.kind === 'tree' || p.kind === 'knoll')).withContext(region).toBeFalse();
      }
    });
  });
});
