import { ArenaScenery } from './arena-scenery';

describe('ArenaScenery (live assets)', () => {
  it("is ready for a region once that region's textures have loaded", async () => {
    const scenery = new ArenaScenery(1);
    expect(scenery.ready('caete')).toBeFalse();
    scenery.setRegion('caete', 0);
    expect(scenery.ready('caete')).toBeFalse();
    const started = performance.now();
    while (!scenery.ready('caete') && performance.now() - started < 20_000) await new Promise((r) => setTimeout(r, 50));
    expect(scenery.ready('caete')).toBeTrue();
    expect(scenery.ready('green_grounds')).toBeFalse();
    scenery.dispose();
  }, 30_000);

  it('the painted backdrop turns with the camera; the ground stays on the world', () => {
    const scenery = new ArenaScenery(1);
    scenery.setRegion('caete', 0);
    scenery.update(0, 16, 16, 0, 0.8);
    const backdrop = scenery.group.getObjectByName('arena:backdrop')!;
    expect(backdrop).toBeTruthy();
    expect(backdrop.rotation.y).toBeCloseTo(0.8, 6);
    expect(backdrop.children.length).toBe(3);
    const region = scenery.group.getObjectByName('arena:scenery:caete')!;
    expect(region.rotation.y).toBe(0);
    scenery.dispose();
  });
});

