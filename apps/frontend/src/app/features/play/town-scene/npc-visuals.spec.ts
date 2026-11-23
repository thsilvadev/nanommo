import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { obstacleRadius, type TownObstacle, type TownSceneDef } from '@nanommo/shared';
import { CharacterAssetCache } from '../../../shared/character-viewer/character-asset-cache';
import { isWebglAvailable, loadAppearanceCatalog } from '../../../shared/character-viewer/character-viewer.component';
import { NPC_VISUALS, buildNpcVisual, type NpcVisualDef } from './npc-visuals';
import { TownCharacter, TownCharacterFactory } from './town-character';
import { createTownRuntime, type TownRuntime } from './town-runtime';

const propKinds = (id: string) => NPC_VISUALS[id].props.map(p => p.kind);
const costume = (id: string): string[] => { const f = NPC_VISUALS[id].figure; return f.kind === 'body' ? f.costume : []; };

describe('NPC_VISUALS registry', () => {
  it('covers every town NPC', async () => {
    const maps = await fetch('/data/maps.json').then(r => r.json());
    const ids = new Set<string>(maps.maps.filter((m: any) => m.type === 'town').flatMap((m: any) => m.npcIds ?? []));
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) expect(NPC_VISUALS[id]).withContext(id).toBeDefined();
  });

  it('mailbox is only a prop', () => {
    expect(NPC_VISUALS['mailbox'].figure.kind).toBe('none');
    expect(propKinds('mailbox')).toEqual(['mailbox']);
  });

  it('follows the briefing', () => {
    expect(propKinds('blacksmith_loren')).toEqual(jasmine.arrayContaining(['anvil', 'hammer']));
    expect(propKinds('whitesmith_spitz')).toEqual(jasmine.arrayContaining(['forge', 'anvil', 'bucket']));
    expect(costume('whitesmith_spitz')).toEqual(jasmine.arrayContaining(['star-hat', 'big-nose']));
    expect(propKinds('paje_piata')).toEqual(jasmine.arrayContaining(['table', 'gourds', 'herbs']));
    expect(propKinds('uncle_phillip')).toEqual(jasmine.arrayContaining(['counter']));
    expect(costume('uncle_phillip')).toEqual(jasmine.arrayContaining(['mustache', 'chef-hat', 'chubby']));
    expect(propKinds('storage')).toEqual(jasmine.arrayContaining(['chest']));
    expect(costume('william')).toEqual(jasmine.arrayContaining(['giant-backpack']));
    expect(costume('oracle')).toEqual(jasmine.arrayContaining(['faceless']));
    expect(propKinds('cecilia')).toEqual(jasmine.arrayContaining(['crystal-ball', 'cards']));
  });

  it('follows the review of 2026-11-18', () => {
    const body = (id: string) => NPC_VISUALS[id].figure as Extract<NpcVisualDef['figure'], { kind: 'body' }>;
    expect(costume('blacksmith_loren')).not.toContain('leather-apron');
    expect(costume('whitesmith_spitz')).not.toContain('leather-apron');
    expect(costume('uncle_phillip')).not.toContain('apron');
    expect(costume('uncle_phillip')).not.toContain('belly');
    expect(body('whitesmith_spitz').appearance.hairColor).toBe(2); // blonde hair and beard
    expect(NPC_VISUALS['cecilia'].figure).toEqual({ kind: 'model', asset: '../npcs/figure-yunara.glb' }); // user decision 2026-11-23
    expect(body('paje_piata').outfit).toBeUndefined(); // underwear for now
    expect(costume('paje_piata')).toEqual(jasmine.arrayContaining(['leaf-crown', 'leaf-bundles', 'pipe']));
    expect(body('paje_piata').underwear).toBeDefined(); // straw-coloured
    expect(body('uncle_phillip').belly).toBe(2);
    expect(body('uncle_phillip').paint?.shirt).toBeDefined();
    expect(body('uncle_phillip').paint?.pants).toBeDefined();
    expect(body('whitesmith_spitz').paint?.shirt).toBeDefined();
    expect(body('william').paint?.shirt).toBeDefined();
    expect(body('paje_piata').appearance.hairColor).toBe(4); // white hair: an elder
    expect(NPC_VISUALS['storage'].props.find(p => p.kind === 'chest')!.scale).toBe(2);
    expect(body('storage').recolor).toBeDefined();
    expect(costume('father_marcelus')).toContain('hide-legs');
  });

  it('props stay clear of every POI in every town', async () => {
    const towns: TownSceneDef[] = (await fetch('/data/town_scenes.json').then(r => r.json())).towns;
    for (const town of towns) {
      for (const [npcId, spot] of Object.entries(town.npcSpots)) {
        const facing = (spot.facing * Math.PI) / 180;
        for (const prop of NPC_VISUALS[npcId].props) {
          // Local frame: +z is where the NPC looks, +x its left (three.js rotation.y = facing).
          const x = spot.x + prop.x * Math.cos(facing) + prop.z * Math.sin(facing);
          const z = spot.z - prop.x * Math.sin(facing) + prop.z * Math.cos(facing);
          for (const poi of town.pointsOfInterest) {
            expect(Math.hypot(x - poi.x, z - poi.z)).withContext(`${town.mapId} ${npcId} ${prop.kind} vs ${poi.id}`).toBeGreaterThan(poi.radius + 0.3);
          }
        }
      }
    }
  });
});

describe('NPC props keep their distance', () => {
  /** Distance from (x, z) to an obstacle's footprint (negative inside). */
  const surface = (o: TownObstacle, x: number, z: number) => {
    const r = obstacleRadius(o);
    if (r != null) return Math.hypot(x - o.x, z - o.z) - r;
    const a = ((o.rot ?? 0) * Math.PI) / 180, dx = x - o.x, dz = z - o.z;
    const lx = dx * Math.cos(a) - dz * Math.sin(a), lz = dx * Math.sin(a) + dz * Math.cos(a);
    const qx = Math.abs(lx) - o.w! / 2, qz = Math.abs(lz) - o.d! / 2;
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  };

  it('no prop of an NPC on the ground touches a house, tree, fountain… (min 0.5 × its scale)', async () => {
    const towns: TownSceneDef[] = (await fetch('/data/town_scenes.json').then(r => r.json())).towns;
    for (const town of towns) {
      for (const [npcId, spot] of Object.entries(town.npcSpots)) {
        if ((spot.y ?? 0) > 0) continue; // up on a balcony, its props stand on the platform
        const facing = (spot.facing * Math.PI) / 180;
        for (const prop of NPC_VISUALS[npcId].props) {
          const x = spot.x + prop.x * Math.cos(facing) + prop.z * Math.sin(facing);
          const z = spot.z - prop.x * Math.sin(facing) + prop.z * Math.cos(facing);
          const scale = typeof prop.scale === 'number' ? prop.scale : Math.max(...(prop.scale ?? [1]));
          for (const o of town.obstacles) {
            expect(surface(o, x, z)).withContext(`${town.mapId} ${npcId} ${prop.kind} vs ${o.kind}@${o.x},${o.z}`).toBeGreaterThanOrEqual(0.5 * scale);
          }
        }
      }
    }
  });
});

describe('NPC visuals (real WebGL)', () => {
  let host: HTMLElement;
  let runtime: TownRuntime | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.cssText = 'width:640px;height:480px;position:fixed;left:0;top:0';
    document.body.appendChild(host);
  });
  afterEach(() => { runtime?.dispose(); runtime = null; host.remove(); });

  it('builds every visual with at least one mesh', async () => {
    if (!isWebglAvailable()) pending('WebGL is not available in this browser');
    const loader = new GLTFLoader();
    const cache = CharacterAssetCache.shared('/assets/character/', (url) => loader.loadAsync(url));
    const factory = new TownCharacterFactory(cache, await loadAppearanceCatalog('/data/appearance_catalog.json'));
    for (const [id, def] of Object.entries(NPC_VISUALS) as Array<[string, NpcVisualDef]>) {
      const object = await buildNpcVisual(def, { factory });
      let meshes = 0;
      object.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
      expect(meshes).withContext(id).toBeGreaterThan(0);
    }
  }, 60_000);

  it('the shaman\'s pipe smokes with the clock, deterministically', async () => {
    if (!isWebglAvailable()) pending('WebGL is not available in this browser');
    const loader = new GLTFLoader();
    const cache = CharacterAssetCache.shared('/assets/character/', (url) => loader.loadAsync(url));
    const factory = new TownCharacterFactory(cache, await loadAppearanceCatalog('/data/appearance_catalog.json'));
    const figure = NPC_VISUALS['paje_piata'].figure;
    const entry = factory.npcEntry('paje_piata', 'Piatã');
    const shaman = new TownCharacter(factory, entry, { npc: true, visual: figure });
    await shaman.ready;
    const T = Date.UTC(2026, 10, 18, 12);
    const pose = { x: 0, z: 0, facing: 0, state: 'idle' as const };
    shaman.update(pose, 0, 'full', T);
    const puff = shaman.object3d.getObjectByName('pipe-smoke')!;
    expect(puff).toBeTruthy();
    const at = () => JSON.stringify([puff.position.toArray(), puff.scale.toArray()]);
    const first = at();
    shaman.update(pose, 0, 'full', T);
    expect(at()).toBe(first);
    shaman.update(pose, 0, 'full', T + 120);
    expect(at()).not.toBe(first);
    shaman.dispose();
  });

  it('dressed NPCs keep their click box in every town', async () => {
    if (!isWebglAvailable()) pending('WebGL is not available in this browser');
    const towns: TownSceneDef[] = (await fetch('/data/town_scenes.json').then(r => r.json())).towns;
    for (const def of towns) {
      runtime = await createTownRuntime(host, {
        def, now: () => Date.UTC(2026, 10, 18, 12), assetBase: '/assets/character/', catalogUrl: '/data/appearance_catalog.json',
        npcNames: {}, selfId: null,
      });
      runtime.setCharacters([], null);
      await runtime.settled();
      for (const [npcId, spot] of Object.entries(def.npcSpots)) {
        runtime.centerOn(spot.x, spot.z);
        runtime.renderNow();
        const at = runtime.screenPositionOf('npc', npcId)!;
        expect(runtime.pick(at[0], at[1])).withContext(`${def.mapId} ${npcId}`).toEqual({ kind: 'npc', id: npcId });
        expect(runtime.npcDressed(npcId)).withContext(`${def.mapId} ${npcId}`).toBeTrue();
        // Costume pieces (William's giant backpack…) stay on the body, wherever the NPC stands.
        expect(runtime.npcSpreadOf(npcId)!).withContext(`${def.mapId} ${npcId} costume spread`).toBeLessThan(1.5);
      }
      runtime.dispose();
      runtime = null;
    }
  }, 60_000); // five real towns with dressed NPCs: well over jasmine's 5 s default
});
