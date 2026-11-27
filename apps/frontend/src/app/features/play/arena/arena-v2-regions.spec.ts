import * as THREE from 'three';
import { ArenaRegionId } from './arena-region';
import { ArenaPropKind, FLAT_PROPS, arenaPropLayout } from './arena-prop-layout';
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
      expect(scenery.group.getObjectByName('arena:motes')).toBeTruthy();
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
});
