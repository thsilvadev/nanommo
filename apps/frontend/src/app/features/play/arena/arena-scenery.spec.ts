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
});
