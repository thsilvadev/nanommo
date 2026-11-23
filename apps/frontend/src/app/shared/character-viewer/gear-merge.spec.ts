import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CharacterAssetCache } from './character-asset-cache';
import type { BodyAsset } from './body-asset';
import type { GearManifest, LoadedGear } from './gear-manifest';
import { bowString, gearMesh, mergedGearGeometry, planGear } from './gear-merge';

describe('gear merge', () => {
  let body: BodyAsset;
  let cache: CharacterAssetCache;
  beforeAll(async () => {
    const loader = new GLTFLoader();
    cache = new CharacterAssetCache((url) => loader.loadAsync(url), '/assets/character/');
    body = await cache.body('male');
  });

  function fakeGear(): LoadedGear {
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 0, 0.1, 1, 0, 0.1, 1.1, 0, 0, 1.1, 0], 3));
    quad.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(12).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
    quad.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(8).fill(0.5), 2));
    quad.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(16).fill(0).map((_, i) => (i % 4 === 0 ? 2 : 0)), 4));
    quad.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(16).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const skinned = new THREE.SkinnedMesh(quad);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1).toNonIndexed());
    box.geometry.setIndex([...Array(box.geometry.getAttribute('position').count).keys()]);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.9, 0.05));
    const identity = new THREE.Matrix4().toArray();
    const manifest: GearManifest = {
      version: 'x', atlas: 'a.webp',
      items: { body_item: 'fake-body', hat_item: 'fake-hat', sword_item: 'fake-sword', ghost_item: 'not-a-visual' },
      visuals: {
        'fake-body': { slot: 'body', kind: 'skinned', covers: ['torso'] },
        'fake-hat': { slot: 'head', kind: 'rigid', bone: 'Head', transform: { male: identity, female: identity }, hidesHair: true },
        'fake-sword': { slot: 'mainHand', kind: 'rigid', bone: 'hand_r', transform: { male: identity, female: identity }, weaponType: 'sword' },
      },
    };
    return {
      manifest, atlas: new THREE.Texture(),
      skinned: { male: new Map([['fake-body', skinned]]), female: new Map() },
      rigid: new Map<string, THREE.Object3D>([['fake-hat', box], ['fake-sword', blade]]),
    };
  }
  const item = (id: string) => (id === 'sword_item' ? { weaponType: 'sword' } : undefined);

  it('plans visuals, covered regions and hair; skips unknown items without throwing', () => {
    const plan = planGear(fakeGear(), { body: 'body_item', head: 'hat_item', cape: 'ghost_item', shoes: 'nope' }, item, 'right');
    expect(plan.visuals).toEqual(['fake-body', 'fake-hat']);
    expect([...plan.covered]).toEqual(['torso']);
    expect(plan.hidesHair).toBeTrue();
    expect(plan.weapons).toEqual([]);
  });

  it('puts the main-hand weapon in the dominant (left) hand', () => {
    const plan = planGear(fakeGear(), { mainHand: 'sword_item' }, item, 'left');
    expect(plan.weapons).toEqual([{ side: 'left', visual: 'fake-sword', type: 'sword', glint: 0 }]);
  });

  it('fuses skinned + rigid pieces into one geometry on the body skeleton; rigid vertices follow their bone', () => {
    const gear = fakeGear();
    const plan = planGear(gear, { body: 'body_item', head: 'hat_item', mainHand: 'sword_item' }, item, 'right');
    const withWeapons = mergedGearGeometry(gear, 'male', body, plan, { includeWeapons: true })!;
    const without = mergedGearGeometry(gear, 'male', body, plan, { includeWeapons: false })!;
    const count = (o: THREE.Object3D) => ((o as THREE.Mesh).geometry as THREE.BufferGeometry).getAttribute('position').count;
    expect(without.getAttribute('position').count).toBe(4 + count(gear.rigid.get('fake-hat')!));
    expect(withWeapons.getAttribute('position').count).toBe(4 + count(gear.rigid.get('fake-hat')!) + count(gear.rigid.get('fake-sword')!));
    const head = body.body.skeleton.bones.findIndex((b) => b.name === 'Head');
    const J = without.getAttribute('skinIndex'), W = without.getAttribute('skinWeight');
    for (let v = 4; v < J.count; v++) { expect(J.getX(v)).toBe(head); expect(W.getX(v)).toBe(1); }
    // the hat (identity transform) sits on the Head bone's bind position
    const P = without.getAttribute('position');
    const centre = new THREE.Vector3();
    for (let v = 4; v < P.count; v++) centre.add(new THREE.Vector3().fromBufferAttribute(P, v));
    centre.divideScalar(P.count - 4);
    const headBind = new THREE.Vector3().setFromMatrixPosition(body.body.skeleton.boneInverses[head].clone().invert());
    expect(centre.distanceTo(headBind)).toBeLessThan(0.01);
  });

  it('caches the fused geometry per sex + visuals and builds a mesh with the shared material', () => {
    const gear = fakeGear();
    const plan = planGear(gear, { body: 'body_item', head: 'hat_item' }, item, 'right');
    const a = mergedGearGeometry(gear, 'male', body, plan, { includeWeapons: false });
    expect(mergedGearGeometry(gear, 'male', body, planGear(gear, { head: 'hat_item', body: 'body_item' }, item, 'right'), { includeWeapons: false })).toBe(a);
    expect(mergedGearGeometry(gear, 'male', body, planGear(gear, {}, item, 'right'), { includeWeapons: true })).toBeNull();
    const m1 = gearMesh(a!, gear, body.body.skeleton, body.body.bindMatrix);
    const m2 = gearMesh(a!, gear, body.body.skeleton, body.body.bindMatrix);
    expect(m1.name).toBe('Gear');
    expect(m1.material).toBe(m2.material);
  });

  it('refined pieces shimmer: +10/+11 silver, +12 gold, each part drawn with its material slot', () => {
    const gear = fakeGear();
    const plan = planGear(gear, { body: 'body_item', head: 'hat_item', mainHand: 'sword_item' }, item, 'right', { body: 12, head: 9, mainHand: 10 });
    expect(plan.glints).toEqual([2, 0]);
    expect(plan.weapons[0].glint).toBe(1);
    const geometry = mergedGearGeometry(gear, 'male', body, plan, { includeWeapons: true })!;
    expect(geometry.groups.map((g) => g.materialIndex)).toEqual([2, 0, 1]);
    const mesh = gearMesh(geometry, gear, body.body.skeleton, body.body.bindMatrix);
    expect(Array.isArray(mesh.material)).toBeTrue();
    // unrefined gear keeps the single shared material and its own cached geometry
    const plain = mergedGearGeometry(gear, 'male', body, planGear(gear, { body: 'body_item', head: 'hat_item', mainHand: 'sword_item' }, item, 'right'), { includeWeapons: true })!;
    expect(plain).not.toBe(geometry);
    expect(plain.groups.length).toBe(0);
    expect(Array.isArray(gearMesh(plain, gear, body.body.skeleton, body.body.bindMatrix).material)).toBeFalse();
  });

  it('loads the real gear: every manifest visual resolves to a mesh', async () => {
    const gear = await cache.gear();
    for (const [id, v] of Object.entries(gear.manifest.visuals)) {
      if (v.kind === 'skinned') { expect(gear.skinned.male.get(id)).withContext(id).toBeTruthy(); expect(gear.skinned.female.get(id)).withContext(id).toBeTruthy(); }
      else expect(gear.rigid.get(id)).withContext(id).toBeTruthy();
    }
    for (const bow of ['bow-wooden', 'bow-golden', 'bow-evil']) expect(bowString(gear.rigid.get(bow)!)).withContext(bow).toBeTruthy();
  });
});
