import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { defaultAppearance, type TownRosterEntry, type VisibleEquipment } from '@nanommo/shared';
import { CharacterAssetCache } from '../../../shared/character-viewer/character-asset-cache';
import { loadAppearanceCatalog } from '../../../shared/character-viewer/character-viewer.component';
import { TownCharacter, TownCharacterFactory } from './town-character';

describe('TownCharacter gear', () => {
  let factory: TownCharacterFactory;
  const made: TownCharacter[] = [];
  beforeAll(async () => {
    const loader = new GLTFLoader();
    const cache = CharacterAssetCache.shared('/assets/character/', (url) => loader.loadAsync(url));
    factory = new TownCharacterFactory(cache, await loadAppearanceCatalog('/data/appearance_catalog.json'));
  });
  afterEach(() => { while (made.length) made.pop()!.dispose(); });

  const FULL: VisibleEquipment = { head: 'equip_head_phys_t2', body: 'equip_body_phys_t3', cape: 'equip_cape_phys_t3', shoes: 'equip_shoes_holy_t4', mainHand: 'equip_sword_t3', offHand: 'equip_shield_t2' };
  const entry = (id: string, equipment?: VisibleEquipment): TownRosterEntry => ({
    characterId: id, name: id, level: 10, appearance: { ...defaultAppearance(), hair: 2 }, sex: 'male', heightCm: 181, seed: 1, online: true,
    sleeping: null, wakeFrom: null, lastSeenAt: new Date(0).toISOString(), dominantHand: 'right', equipment,
  });
  const character = (e: TownRosterEntry, opts = {}) => { const c = new TownCharacter(factory, e, opts); made.push(c); return c; };
  const gears = (c: TownCharacter) => { const out: THREE.SkinnedMesh[] = []; c.object3d.traverse((o) => { if (o.name === 'Gear') out.push(o as THREE.SkinnedMesh); }); return out; };
  const named = (c: TownCharacter, prefix: string) => { const out: THREE.Object3D[] = []; c.object3d.traverse((o) => { if (o.name.startsWith(prefix)) out.push(o); }); return out; };
  const settle = async (c: TownCharacter) => { await c.ready; await c.gearReady(); };

  it('wears everything as one Gear mesh (weapons included), no separate weapon objects, hair hidden under the helmet', async () => {
    const c = character(entry('a', FULL));
    await settle(c);
    expect(gears(c).length).toBe(1);
    expect(named(c, 'weapon:').length).toBe(0);
    expect(named(c, 'town:hair').every((h) => !h.visible)).toBeTrue();
    expect(named(c, 'town:hair').length).toBe(1);
  });

  it('re-dresses on a new equipment, keeping one Gear mesh', async () => {
    const c = character(entry('b', FULL));
    await settle(c);
    const before = gears(c)[0].geometry;
    c.setEntry(entry('b', { body: 'equip_body_magic_t1' }));
    await c.gearReady();
    expect(gears(c).length).toBe(1);
    expect(gears(c)[0].geometry).not.toBe(before);
    expect(named(c, 'town:hair').every((h) => h.visible)).toBeTrue();
    c.setEntry(entry('b', {}));
    await c.gearReady();
    expect(gears(c).length).toBe(0);
  });

  it('characters with the same equipment share the fused geometry', async () => {
    const [c1, c2] = [character(entry('c', FULL)), character(entry('d', FULL))];
    await Promise.all([settle(c1), settle(c2)]);
    expect(gears(c1)[0].geometry).toBe(gears(c2)[0].geometry);
  });

  it('an equipment change arriving before the first build ends with the newest equipment', async () => {
    const c = character(entry('e', FULL));
    c.setEntry(entry('e', { body: 'equip_body_magic_t2' }));
    await settle(c);
    const fresh = character(entry('f', { body: 'equip_body_magic_t2' }));
    await settle(fresh);
    expect(gears(c)[0].geometry).toBe(gears(fresh)[0].geometry);
  });

  it('retries the same equipment after a transient gear download failure', async () => {
    const realGear = await factory.cache.gear();
    const load = spyOn(factory.cache, 'gear').and.returnValues(Promise.reject(new Error('temporary network failure')), Promise.resolve(realGear));
    const e = entry('retry', FULL);
    const c = character(e);
    await settle(c);
    expect(gears(c).length).toBe(0);
    c.setEntry({ ...e });
    await c.gearReady();
    expect(load).toHaveBeenCalledTimes(2);
    expect(gears(c).length).toBe(1);
  });

  it('NPCs never wear gear', async () => {
    const npc = character({ ...factory.npcEntry('storage', 'Storage'), equipment: FULL }, { npc: true });
    await settle(npc);
    expect(gears(npc).length).toBe(0);
  });
});
