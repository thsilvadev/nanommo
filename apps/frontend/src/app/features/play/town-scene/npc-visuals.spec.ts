import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { TownSceneDef } from '@nanommo/shared';
import { CharacterAssetCache } from '../../../shared/character-viewer/character-asset-cache';
import { isWebglAvailable, loadAppearanceCatalog } from '../../../shared/character-viewer/character-viewer.component';
import { NPC_VISUALS, buildNpcVisual, type NpcVisualDef } from './npc-visuals';
import { TownCharacterFactory } from './town-character';
import { createTownRuntime, type TownRuntime } from './town-runtime';

const propKinds = (id: string) => NPC_VISUALS[id].props.map(p => p.kind);
const costume = (id: string) => { const f = NPC_VISUALS[id].figure; return f.kind === 'body' ? f.costume : []; };

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
    expect(costume('uncle_phillip')).toEqual(jasmine.arrayContaining(['mustache', 'apron']));
    expect(propKinds('storage')).toEqual(jasmine.arrayContaining(['chest']));
    expect(costume('william')).toEqual(jasmine.arrayContaining(['giant-backpack']));
    expect(costume('oracle')).toEqual(jasmine.arrayContaining(['faceless']));
    expect(propKinds('cecilia')).toEqual(jasmine.arrayContaining(['crystal-ball', 'cards']));
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
      }
      runtime.dispose();
      runtime = null;
    }
  }, 60_000); // five real towns with dressed NPCs: well over jasmine's 5 s default
});
