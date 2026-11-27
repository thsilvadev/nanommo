import * as THREE from 'three';
import { ArenaScenery, arenaHasNearLayer, arenaLight } from './arena-scenery';

describe('ArenaScenery (live assets)', () => {
  it("is ready for a region once that region's textures have loaded", async () => {
    const scenery = new ArenaScenery(1);
    expect(scenery.ready('forest_ruins')).toBeFalse();
    scenery.setRegion('forest_ruins', 0);
    expect(scenery.ready('forest_ruins')).toBeFalse();
    const started = performance.now();
    while (!scenery.ready('forest_ruins') && performance.now() - started < 20_000) await new Promise((r) => setTimeout(r, 50));
    expect(scenery.ready('forest_ruins')).toBeTrue();
    expect(scenery.ready('green_grounds')).toBeFalse();
    scenery.dispose();
  }, 30_000);

  it('the painted backdrop turns with the camera; the ground stays on the world', () => {
    const scenery = new ArenaScenery(1);
    scenery.setRegion('forest_ruins', 0);
    scenery.update(0, 16, 16, 0, 0.8);
    const backdrop = scenery.group.getObjectByName('arena:backdrop')!;
    expect(backdrop).toBeTruthy();
    expect(backdrop.rotation.y).toBeCloseTo(0.8, 6);
    expect(backdrop.children.length).toBe(3);
    const region = scenery.group.getObjectByName('arena:scenery:forest_ruins')!;
    expect(region.rotation.y).toBe(0);
    scenery.dispose();
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
    expect(arenaHasNearLayer('forest_ruins')).toBeTrue();
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
});
