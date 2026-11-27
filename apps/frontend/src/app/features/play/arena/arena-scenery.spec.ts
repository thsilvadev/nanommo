import * as THREE from 'three';
import { ArenaScenery, arenaHasNearLayer, arenaLight } from './arena-scenery';
import { ARENA_REGIONS } from './arena-region';

describe('ArenaScenery (live assets)', () => {
  it("is ready for a region once that region's textures have loaded", async () => {
    const scenery = new ArenaScenery(1);
    expect(scenery.ready('gods_bridge')).toBeFalse();
    scenery.setRegion('gods_bridge', 0);
    expect(scenery.ready('gods_bridge')).toBeFalse();
    const started = performance.now();
    while (!scenery.ready('gods_bridge') && performance.now() - started < 20_000) await new Promise((r) => setTimeout(r, 50));
    expect(scenery.ready('gods_bridge')).toBeTrue();
    expect(scenery.ready('green_grounds')).toBeFalse();
    scenery.dispose();
  }, 30_000);

  it('no region draws a painted layer any more (v2: everything 3D); the ground stays on the world when the camera turns', () => {
    for (const r of ARENA_REGIONS) {
      const scenery = new ArenaScenery(1);
      scenery.setRegion(r, 0);
      scenery.update(0, 16, 16, 0, 0.8);
      expect(scenery.group.getObjectByName('arena:backdrop')!.children.length).withContext(r).toBe(0);
      expect(arenaHasNearLayer(r)).withContext(r).toBeFalse();
      expect(scenery.group.getObjectByName(`arena:scenery:${r}`)!.rotation.y).toBe(0);
      scenery.dispose();
    }
  });

  it('kwaioua_forest has no painted layer (a starry night instead): its modelled plants load before the region is ready', async () => {
    const scenery = new ArenaScenery(1);
    scenery.setRegion('kwaioua_forest', 0);
    scenery.update(0, 16, 16);
    expect(scenery.group.getObjectByName('arena:backdrop')!.children.length).toBe(0);
    expect(scenery.group.getObjectByName('arena:stars')).toBeTruthy();
    expect(arenaLight('kwaioua_forest').background).toBeTruthy();
    expect(arenaLight('kwaioua_forest').fog).toBeTruthy();
    const started = performance.now();
    while (!scenery.ready('kwaioua_forest') && performance.now() - started < 20_000) await new Promise((r) => setTimeout(r, 50));
    expect(scenery.ready('kwaioua_forest')).toBeTrue();
    for (const kind of ['fern', 'shrub', 'tuft', 'stump', 'mossrock', 'trunk']) {
      const mesh = scenery.group.getObjectByName(`arena:props:${kind}`) as THREE.InstancedMesh;
      expect(mesh).withContext(kind).toBeTruthy();
      expect(mesh.geometry.getAttribute('color')).withContext(kind).toBeTruthy();
    }
    expect(arenaHasNearLayer('kwaioua_forest')).toBeFalse();
    scenery.dispose();
  }, 30_000);

  it('caete has no painted layer either: a misty day forest (light mist colour and fog, no stars), with its tropical plants', async () => {
    const scenery = new ArenaScenery(1);
    scenery.setRegion('caete', 0);
    scenery.update(0, 16, 16);
    expect(scenery.group.getObjectByName('arena:backdrop')!.children.length).toBe(0);
    expect(scenery.group.getObjectByName('arena:stars')).toBeFalsy();
    const light = arenaLight('caete');
    expect(light.fog).toBeTruthy();
    expect(new THREE.Color(light.background!).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).l).toBeGreaterThan(0.5);
    expect(arenaHasNearLayer('caete')).toBeFalse();
    const started = performance.now();
    while (!scenery.ready('caete') && performance.now() - started < 20_000) await new Promise((r) => setTimeout(r, 50));
    expect(scenery.ready('caete')).toBeTrue();
    for (const kind of ['bigleaf', 'trunk', 'fern', 'shrub']) {
      const mesh = scenery.group.getObjectByName(`arena:props:${kind}`) as THREE.InstancedMesh;
      expect(mesh).withContext(kind).toBeTruthy();
      expect(mesh.geometry.getAttribute('color')).withContext(kind).toBeTruthy();
    }
    scenery.dispose();
  }, 30_000);

  it('forest_ruins is a starry night: black sky, stars, its ground recoloured blue', () => {
    const light = arenaLight('forest_ruins');
    expect(light.stars).toBeTrue();
    expect(light.dome).toBeUndefined();
    expect(new THREE.Color(light.background!).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).l).toBeLessThan(0.06);
    const blue = new THREE.Color(light.groundRecolor!);
    expect(blue.b).toBeGreaterThan(blue.g);
    expect(blue.b).toBeGreaterThan(blue.r);
    const scenery = new ArenaScenery(1);
    scenery.setRegion('forest_ruins', 0);
    expect(scenery.group.getObjectByName('arena:stars')).toBeTruthy();
    scenery.dispose();
  });
});

