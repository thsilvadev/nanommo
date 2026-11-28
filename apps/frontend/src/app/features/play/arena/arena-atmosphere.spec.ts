import * as THREE from 'three';
import { ArenaAtmosphere, arenaAtmosphere, atmosphereLayout, beamPosition, motePosition, wispPosition } from './arena-atmosphere';
import { ArenaScenery, arenaLight } from './arena-scenery';
import { ARENA_REGIONS } from './arena-region';

describe('arena atmosphere', () => {
  it('keeps floating motes only in the forests, Caete and ruins, preserving regional mist', () => {
    for (const region of ARENA_REGIONS) {
      const air = arenaAtmosphere(region)!;
      expect(air).withContext(region).not.toBeNull();
      if (['kwaioua_forest', 'caete', 'forest_ruins'].includes(region)) {
        expect(air.motes.count).withContext(region).toBeGreaterThan(100);
      } else {
        expect(air.motes.count).withContext(region).toBe(0);
        const atmosphere = new ArenaAtmosphere(air, false);
        expect(atmosphere.group.getObjectByName('arena:motes')).withContext(region).toBeUndefined();
        atmosphere.dispose();
      }
      // Mist only where there is fog (green_grounds has a clear sky).
      if (arenaLight(region).fog) expect(air.wisps.count).withContext(region).toBeGreaterThan(10);
    }
  });

  it('motes are small, float very slowly and stay round the arena, each glowing on its own beat', () => {
    const { motes } = atmosphereLayout(arenaAtmosphere('caete')!);
    for (const m of motes.slice(0, 40)) {
      const a = motePosition(m, 100, 0), b = motePosition(m, 101, 0);
      const speed = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      expect(speed).withContext('m/s').toBeLessThan(0.35);
      for (let t = 0; t < 600; t += 37) {
        const p = motePosition(m, t, t * 1.4);
        expect(p.y).toBeGreaterThan(0.2);
        expect(p.y).toBeLessThan(7);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(60);
        expect(p.glow).toBeGreaterThanOrEqual(0);
        expect(p.glow).toBeLessThanOrEqual(1);
      }
    }
    const glows = motes.slice(0, 20).map((m) => motePosition(m, 50, 0).glow);
    expect(new Set(glows.map((g) => g.toFixed(2))).size).toBeGreaterThan(5);
  });

  it('wisps scroll with the ground as the party walks and some drift across the battle band', () => {
    const spec = arenaAtmosphere('caete')!;
    const { wisps } = atmosphereLayout(spec);
    const w = wisps[0];
    const a = wispPosition(w, 10, 0), b = wispPosition(w, 10, 3);
    expect(b.x - a.x).toBeCloseTo(-3, 1);
    expect(wisps.some((x) => Math.abs(x.z) < 10)).toBeTrue();
  });

  it('builds one points cloud and one instanced wisp mesh, and fades with the region', () => {
    const atmosphere = new ArenaAtmosphere(arenaAtmosphere('caete')!, true);
    atmosphere.update(0, 5);
    const motes = atmosphere.group.getObjectByName('arena:motes') as THREE.Points;
    const wisps = atmosphere.group.getObjectByName('arena:wisps') as THREE.InstancedMesh;
    expect(motes).toBeTruthy();
    expect(wisps.count).toBe(arenaAtmosphere('caete')!.wisps.count);
    atmosphere.fade(0.5);
    expect((motes.material as THREE.PointsMaterial).opacity).toBeCloseTo(0.5, 6);
    atmosphere.dispose();
  });

  it('a region with no motes draws no motes at all', () => {
    const scenery = new ArenaScenery(1);
    scenery.setRegion('green_grounds', 0);
    scenery.update(0, 16, 16);
    expect(scenery.group.getObjectByName('arena:motes')).toBeFalsy();
    scenery.dispose();
  });

  it('the scenery adds it to the region and takes it away with it', () => {
    const scenery = new ArenaScenery(1);
    scenery.setRegion('caete', 0);
    scenery.update(0, 16, 16);
    expect(scenery.group.getObjectByName('arena:motes')).toBeTruthy();
    scenery.dispose();
    expect(scenery.group.getObjectByName('arena:motes')).toBeFalsy();
  });

  it('forest_ruins adds slanting sun shafts that breathe slowly', () => {
    const spec = arenaAtmosphere('forest_ruins')!;
    expect(spec.beams!.count).toBeGreaterThan(5);
    const atmosphere = new ArenaAtmosphere(spec, false);
    atmosphere.update(0, 3);
    const beams = atmosphere.group.getObjectByName('arena:beams') as THREE.InstancedMesh;
    expect(beams.count).toBe(spec.beams!.count);
    const { beams: layout } = atmosphereLayout(spec);
    const a = beamPosition(layout[0], 10, 0).glow, b = beamPosition(layout[0], 11, 0).glow;
    expect(Math.abs(b - a)).toBeLessThan(0.1);
    atmosphere.dispose();
  });

});

