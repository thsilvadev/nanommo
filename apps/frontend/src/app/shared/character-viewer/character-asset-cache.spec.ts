import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CharacterAssetCache } from './character-asset-cache';

const BASE = '/assets/character/';

describe('CharacterAssetCache', () => {
  let calls: string[];
  let failNext: Set<string>;
  let cache: CharacterAssetCache;

  beforeEach(() => {
    calls = [];
    failNext = new Set();
    const loader = new GLTFLoader();
    const load = (url: string) => {
      calls.push(url);
      if (failNext.delete(url)) return Promise.reject(new Error('404'));
      return loader.loadAsync(url);
    };
    cache = new CharacterAssetCache(load, BASE);
  });

  const count = (asset: string) => calls.filter(url => url === BASE + asset).length;

  it('loads a raw glTF once and hands every caller the same Promise', async () => {
    const a = cache.gltf('body-male.glb');
    const b = cache.gltf('body-male.glb');
    expect(a).toBe(b);
    await a;
    expect(count('body-male.glb')).toBe(1);
  });

  it('body() fetches each file once but returns independent instances', async () => {
    const [first, second] = await Promise.all([cache.body('male'), cache.body('male')]);
    expect(count('body-male.glb')).toBe(1);
    expect(count('animations.glb')).toBe(1);
    expect(first).not.toBe(second);
    expect(first.root).not.toBe(second.root);
    // Appearance deforms vertices and repaints skin per instance: nothing mutable is shared.
    expect(first.body.geometry).not.toBe(second.body.geometry);
    expect(first.brows.geometry).not.toBe(second.brows.geometry);
    expect(first.body.material).not.toBe(second.body.material);
    expect(first.skinTexture).not.toBe(second.skinTexture);
    expect(first.bones.get('Head')).not.toBe(second.bones.get('Head'));
    expect(first.body.skeleton.bones.includes(first.bones.get('Head')!)).toBeTrue();
    // The raw cached scene is never mutated by an instance.
    const raw = (await cache.gltf('body-male.glb')).scene;
    expect(raw.parent).toBeNull();
    expect(first.root).not.toBe(raw);
  });

  it('prepared instances carry the animation library', async () => {
    const body = await cache.body('female');
    const clips = await cache.animations();
    expect(clips.map(c => c.name)).toEqual(jasmine.arrayContaining(['Idle', 'Walk', 'Dead']));
    expect(body.actions.has('Idle')).toBeTrue();
    expect(body.actions.has('Dead')).toBeTrue();
  });

  it('forgets a failed load so the next call retries', async () => {
    failNext.add(BASE + 'animations.glb');
    await expectAsync(cache.animations()).toBeRejected();
    await expectAsync(cache.animations()).toBeResolved();
    expect(count('animations.glb')).toBe(2);
  });

  it('glb() returns the shared raw scene of a model', async () => {
    const a = await cache.glb('weapons/sword.glb');
    const b = await cache.glb('weapons/sword.glb');
    expect(a).toBe(b);
    expect(count('weapons/sword.glb')).toBe(1);
  });

  it('skinTexture() composes once per appearance key', async () => {
    let composed = 0;
    const compose = async () => { composed++; return new THREE.Texture(); };
    const a = await cache.skinTexture('male|skin1|hair2', compose);
    const b = await cache.skinTexture('male|skin1|hair2', compose);
    const c = await cache.skinTexture('male|skin2|hair2', compose);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(composed).toBe(2);
  });

  it('shared() is one cache per asset base', () => {
    const load = (url: string) => new GLTFLoader().loadAsync(url);
    expect(CharacterAssetCache.shared(BASE, load)).toBe(CharacterAssetCache.shared(BASE, load));
    expect(CharacterAssetCache.shared('/other/', load)).not.toBe(CharacterAssetCache.shared(BASE, load));
  });
});
