/**
 * Character assets loaded once per page and shared by every rig and by the
 * town scene: raw glTF files, images and the animation library.
 *
 * What is shared is read-only. Anything a character mutates (deformed body
 * vertices, its skin canvas, bones, mixer) comes from `body()`, which returns
 * a new instance prepared from a clone of the cached file every time.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Sex } from '@nanommo/shared';
import { CLIP_NAMES, LIBRARY_CLIPS, deinterleave, prepareBody, type BodyAsset } from './body-asset';
import { GEAR_ASSET_VERSION, GEAR_MANIFEST_ASSET, type GearManifest, type LoadedGear } from './gear-manifest';

export type { BodyAsset } from './body-asset';
/**
 * `/assets/character/*` is cached by browsers for a day plus a week of
 * stale-while-revalidate (vercel.json): bump `v` whenever animations.glb is
 * rebuilt, or players keep the old file next to new code.
 */
export const ANIMATIONS_ASSET = 'animations.glb?v=2';
export type GltfLoad = (url: string) => Promise<unknown>;

interface AnimationLibrary { clips: THREE.AnimationClip[]; pelvisRest: number }

/** Meshes each body instance owns (deformed and repainted per appearance). */
const OWNED_MESHES = new Set(['Body', 'Brows']);

export class CharacterAssetCache {
  private static readonly byBase = new Map<string, CharacterAssetCache>();

  /** The page-wide cache for an asset base (the loader of the first caller is kept). */
  static shared(assetBase: string, load: GltfLoad): CharacterAssetCache {
    let cache = CharacterAssetCache.byBase.get(assetBase);
    if (!cache) {
      cache = new CharacterAssetCache(load, assetBase);
      CharacterAssetCache.byBase.set(assetBase, cache);
    }
    return cache;
  }

  private readonly gltfs = new Map<string, Promise<GLTF>>();
  private readonly images = new Map<string, Promise<ImageBitmap>>();
  private readonly skins = new Map<string, Promise<THREE.Texture>>();
  private library: Promise<AnimationLibrary> | null = null;
  private gearLoad: Promise<LoadedGear> | null = null;

  constructor(private readonly load: GltfLoad, private readonly assetBase: string) {}

  url(asset: string): string { return this.assetBase + asset; }

  /** Raw parsed glTF, loaded once. Callers must clone before mutating anything in it. */
  gltf(asset: string): Promise<GLTF> {
    return this.memo(this.gltfs, asset, () => this.load(this.url(asset)) as Promise<GLTF>);
  }

  /** Raw scene of a model (hair, beard, weapon): shared, clone before attaching. */
  async glb(asset: string): Promise<THREE.Object3D> {
    return (await this.gltf(asset)).scene;
  }

  /** Alias of glb() for hair/beard assets. */
  hair(asset: string): Promise<THREE.Object3D> { return this.glb(asset); }

  image(asset: string): Promise<ImageBitmap> {
    return this.memo(this.images, asset, () => fetch(this.url(asset)).then((response) => {
      if (!response.ok) throw new Error(`Unable to load ${asset}`);
      return response.blob();
    }).then((blob) => createImageBitmap(blob)));
  }

  animations(): Promise<THREE.AnimationClip[]> {
    return this.animationLibrary().then((library) => library.clips);
  }

  /** A new body instance for `sex`; the files behind it are fetched once. */
  async body(sex: Sex): Promise<BodyAsset> {
    const [gltf, library] = await Promise.all([this.bodyGltf(sex), this.animationLibrary()]);
    const root = cloneSkinned(gltf.scene);
    root.traverse((child) => {
      const mesh = child as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !OWNED_MESHES.has(mesh.name)) return;
      mesh.geometry = mesh.geometry.clone();
      mesh.material = (mesh.material as THREE.Material).clone();
    });
    return prepareBody(sex, root, library.clips, library.pelvisRest);
  }

  /**
   * The wearable gear (manifest, the three GLBs and the atlas), loaded once per page. Files are
   * cache-busted by the manifest's content version. A failure is forgotten so the next call retries.
   */
  gear(): Promise<LoadedGear> {
    if (!this.gearLoad) {
      const pending = (async () => {
        const response = await fetch(`${this.url(GEAR_MANIFEST_ASSET)}?v=${GEAR_ASSET_VERSION}`);
        if (!response.ok) throw new Error('Unable to load the gear manifest');
        const manifest = (await response.json()) as GearManifest;
        const v = `?v=${manifest.version}`;
        const [male, female, rigid, bitmap] = await Promise.all([
          this.gltf(`gear/gear-male.glb${v}`), this.gltf(`gear/gear-female.glb${v}`), this.gltf(`gear/gear-rigid.glb${v}`),
          this.image(`gear/${manifest.atlas}${v}`),
        ]);
        const atlas = new THREE.Texture(bitmap);
        atlas.flipY = false;
        atlas.colorSpace = THREE.SRGBColorSpace;
        atlas.needsUpdate = true;
        const skinnedOf = (scene: THREE.Object3D) => {
          const map = new Map<string, THREE.SkinnedMesh>();
          scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && manifest.visuals[o.name]) map.set(o.name, o as THREE.SkinnedMesh); });
          return map;
        };
        const rigidMap = new Map<string, THREE.Object3D>();
        for (const child of rigid.scene.children) if (manifest.visuals[child.name]) rigidMap.set(child.name, child);
        return { manifest, atlas, skinned: { male: skinnedOf(male.scene), female: skinnedOf(female.scene) }, rigid: rigidMap };
      })();
      this.gearLoad = pending;
      pending.catch(() => { if (this.gearLoad === pending) this.gearLoad = null; });
    }
    return this.gearLoad;
  }

  /** A skin texture composed once per appearance key (bodies of the same look can share it). */
  skinTexture(key: string, compose: () => Promise<THREE.Texture> | THREE.Texture): Promise<THREE.Texture> {
    return this.memo(this.skins, key, async () => compose());
  }

  /** The body file with its owned meshes de-interleaved once, so instances clone plain arrays. */
  private bodyGltf(sex: Sex): Promise<GLTF> {
    return this.gltf(`body-${sex}.glb`).then((gltf) => {
      gltf.scene.traverse((child) => {
        const mesh = child as THREE.SkinnedMesh;
        if (mesh.isSkinnedMesh && OWNED_MESHES.has(mesh.name)) deinterleave(mesh.geometry);
      });
      return gltf;
    });
  }

  private animationLibrary(): Promise<AnimationLibrary> {
    if (!this.library) {
      const pending = this.gltf(ANIMATIONS_ASSET).then((gltf) => {
        const pelvis = gltf.scene.getObjectByName('pelvis');
        const clips = gltf.animations.filter((clip) => LIBRARY_CLIPS.includes(clip.name));
        // Only the rig's clips are required: a missing town emote (Dance, Sit…) just does not play,
        // it must never take every body down with it.
        const required = CLIP_NAMES.filter((name) => !clips.some((clip) => clip.name === name));
        if (required.length) throw new Error(`animations.glb is missing clips: ${required.join(', ')}`);
        return { clips, pelvisRest: pelvis?.position.length() || 1 };
      });
      this.library = pending;
      pending.catch(() => { if (this.library === pending) this.library = null; });
    }
    return this.library;
  }

  /** One in-flight/settled Promise per key; a rejected one is forgotten so the next call retries. */
  private memo<T>(map: Map<string, Promise<T>>, key: string, create: () => Promise<T>): Promise<T> {
    let pending = map.get(key);
    if (!pending) {
      pending = create();
      const settled = pending;
      settled.catch(() => { if (map.get(key) === settled) map.delete(key); });
      map.set(key, settled);
    }
    return pending;
  }
}
