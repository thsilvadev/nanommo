import type { TownSceneDef } from '@nanommo/shared';
import { buildTownWorld } from './town-world';
import { hiddenFraction, occluders } from './npc-occlusion';

describe('No NPC is hidden by the town', () => {
  it('every NPC is fully visible from the town camera (centred on it or panned up to 4 u, default and closest zoom)', async () => {
    const towns: TownSceneDef[] = (await fetch('/data/town_scenes.json').then(r => r.json())).towns;
    for (const def of towns) {
      const world = buildTownWorld(def);
      const meshes = occluders(world.group);
      for (const [npcId, spot] of Object.entries(def.npcSpots)) {
        expect(hiddenFraction(meshes, spot.x, spot.z, spot.y ?? 0)).withContext(`${def.mapId} ${npcId}`).toBe(0);
      }
      world.dispose();
    }
  }, 120_000);

  it('the check sees a pillar standing between an NPC and the camera', async () => {
    const towns: TownSceneDef[] = (await fetch('/data/town_scenes.json').then(r => r.json())).towns;
    const aramaia = towns.find(t => t.mapId === 'map_aramaia_city')!;
    const world = buildTownWorld(aramaia);
    // Right behind the pillar at (30, 30), on the side away from the camera.
    expect(hiddenFraction(occluders(world.group), 28.5, 28.5)).toBeGreaterThan(0.5);
    world.dispose();
  });
});
