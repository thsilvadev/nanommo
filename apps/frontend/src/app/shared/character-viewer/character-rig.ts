/**
 * three.js character rig: loads the body for a sex, applies the appearance
 * (deformations, recomposed skin texture, hair, piercings), attaches hand items
 * to the hand bones and plays the Idle clip.
 *
 * Loaded on demand by CharacterViewerComponent, so three.js stays out of the
 * initial bundle.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AppearanceCatalog, AppearanceOption, AppearanceTrait, HandWeaponType, Sex } from '@nanommo/shared';
import type { CharacterRigHandle, CharacterRigOptions, ViewerConfig, ViewerFraming } from './character-viewer.types';
import { averageSkinColor, bakeDecal, hexToRgb, sampleColor, tintSkinPixels, type BodySurface, type Decal, type Vec3 } from './skin-compositor';

/** Height of each body as modelled, in cm (assets report, Task 0). */
export const NATIVE_HEIGHT_CM: Record<Sex, number> = { male: 181, female: 177 };
const SKIN_TEXTURE_SIZE = 1024;
const CLIP_NAMES = ['Idle', 'Walk', 'Attack', 'Damage', 'Dead'];
const HAND_BONES = { right: 'hand_r', left: 'hand_l' } as const;
const FINGER_BONES = { right: 'middle_01_r', left: 'middle_01_l' } as const;
const THUMB_BONES = { right: 'thumb_01_r', left: 'thumb_01_l' } as const;

interface BodyAsset {
  sex: Sex;
  root: THREE.Object3D;
  body: THREE.SkinnedMesh;
  brows: THREE.SkinnedMesh;
  bones: Map<string, THREE.Bone>;
  /** Bone world matrices in the bind pose, relative to the body root. */
  bind: Map<string, THREE.Matrix4>;
  originalBody: Float32Array;
  originalBrows: Float32Array;
  surface: BodySurface;
  baseSkin: ImageData;
  skinReference: [number, number, number];
  skinCanvas: HTMLCanvasElement;
  skinTexture: THREE.CanvasTexture;
  noseTip: THREE.Vector3;
  chestCenters: THREE.Vector3[];
  earLobes: THREE.Vector3[];
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  idle: THREE.AnimationAction;
  deformKey: string;
  skinKey: string;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const vec = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

function option(catalog: AppearanceCatalog, sex: Sex, trait: AppearanceTrait, index: number): AppearanceOption {
  const list = catalog[sex][trait];
  return list[Math.max(0, Math.min(list.length - 1, index))];
}
const param = (o: AppearanceOption, key: string) => Number(o.params?.[key] ?? 0);

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

export class CharacterRig implements CharacterRigHandle {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 0.75, 0.05, 50);
  /** Yaw + height scale of the whole character. */
  private readonly model = new THREE.Group();
  private readonly clock = new THREE.Clock();
  private readonly bodies = new Map<Sex, Promise<BodyAsset>>();
  private readonly glbCache = new Map<string, Promise<THREE.Object3D>>();
  private readonly imageCache = new Map<string, Promise<ImageBitmap>>();
  private readonly weapons = new Map<HandWeaponType, THREE.Object3D>();
  private readonly hairs = new Map<string, THREE.Object3D>();
  private animations: Promise<THREE.AnimationClip[]> | null = null;
  /** Pelvis rest distance of the animation library's mannequin. */
  private pelvisRest = 1;
  private current: BodyAsset | null = null;
  private handHolder: BodyAsset | null = null;
  private framing: ViewerFraming = 'full';
  private frame: number | null = null;
  private visible = true;
  private disposed = false;
  private interactive = false;
  private dragX: number | null = null;
  private readonly cleanups: Array<() => void> = [];

  static async create(host: HTMLElement, options: CharacterRigOptions): Promise<CharacterRig> {
    return new CharacterRig(host, options);
  }

  private constructor(private readonly host: HTMLElement, private readonly options: CharacterRigOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    const lost = (event: Event) => { event.preventDefault(); this.options.onContextLost(); };
    canvas.addEventListener('webglcontextlost', lost);
    this.cleanups.push(() => canvas.removeEventListener('webglcontextlost', lost));

    this.scene.add(new THREE.HemisphereLight(0xfff1e0, 0x2e241d, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(1.6, 3.2, 3.4);
    const rim = new THREE.DirectionalLight(0x9db6ff, 1.3);
    rim.position.set(-2.4, 2.6, -3);
    this.scene.add(key, rim, this.model);
    this.model.rotation.y = 0.32;

    this.observeSize();
    this.observeVisibility();
    this.bindPointer(canvas);
  }

  // ---- CharacterRigHandle -------------------------------------------------

  bone(name: string): THREE.Bone {
    const bone = this.current?.bones.get(name);
    if (!bone) throw new Error(`No bone ${name}`);
    return bone;
  }
  clipNames(): string[] { return this.current?.clips.map((clip) => clip.name) ?? []; }
  playingClip(): string | null { return this.current?.idle.isRunning() ? this.current.idle.getClip().name : null; }
  modelScale(): number { return this.model.scale.y; }
  isDisposed(): boolean { return this.disposed; }
  isRendering(): boolean { return this.frame !== null; }

  // ---- Applying a configuration -------------------------------------------

  async apply(config: ViewerConfig): Promise<void> {
    const catalog = await this.options.catalog();
    const body = await this.loadBody(config.sex);
    if (this.disposed) return;
    const pick = (trait: AppearanceTrait) => option(catalog, config.sex, trait, config.appearance[trait]);

    // Fetch everything this configuration needs before touching the scene, so a
    // failure leaves the previous character intact.
    const hair = pick('hair');
    const facial = pick('facialHair');
    const [hairObject, beardObject, skinImages, weaponObjects] = await Promise.all([
      hair.asset ? this.loadGlb(hair.asset) : Promise.resolve(null),
      facial.asset?.endsWith('.glb') ? this.loadGlb(facial.asset) : Promise.resolve(null),
      this.loadSkinImages([pick('mouth'), facial, pick('tattoo')]),
      Promise.all((['right', 'left'] as const).map((side) => (config.hands[side] ? this.loadWeapon(config.hands[side]!) : null))),
    ]);
    if (this.disposed) return;

    if (this.current !== body) {
      if (this.current) { this.current.idle.stop(); this.model.remove(this.current.root); }
      this.model.add(body.root);
      this.current = body;
      body.idle.reset().play();
    }

    this.deform(body, pick('nose'), pick('chest'), config.sex === 'female' ? facial : null);
    this.composeSkin(body, pick('skin'), pick('hairColor'), pick('mouth'), facial, pick('tattoo'), skinImages);
    const hairColor = new THREE.Color().setStyle(pick('hairColor').color ?? '#3a2a20').multiplyScalar(1.6);
    (body.brows.material as THREE.MeshStandardMaterial).color.copy(hairColor).multiplyScalar(0.8);
    this.attachHead(body, 'hair', hairObject, hairColor);
    this.attachHead(body, 'beard', beardObject, hairColor);
    this.attachPiercing(body, pick('piercing'));
    this.attachHands(body, config.hands, weaponObjects);

    this.model.scale.setScalar(config.heightCm / NATIVE_HEIGHT_CM[config.sex]);
    this.framing = config.framing;
    this.interactive = config.interactive;
    this.renderer.domElement.style.cursor = config.interactive ? 'grab' : '';
    this.updateCamera();
    this.renderOnce();
  }

  // ---- Loading -------------------------------------------------------------

  private url(asset: string): string { return this.options.assetBase + asset; }

  private loadGltf(asset: string): Promise<GLTF> {
    return this.options.load(this.url(asset)) as Promise<GLTF>;
  }

  private loadGlb(asset: string): Promise<THREE.Object3D> {
    let pending = this.glbCache.get(asset);
    if (!pending) {
      pending = this.loadGltf(asset).then((gltf) => gltf.scene);
      pending.catch(() => this.glbCache.delete(asset));
      this.glbCache.set(asset, pending);
    }
    return pending;
  }

  private loadImage(asset: string): Promise<ImageBitmap> {
    let pending = this.imageCache.get(asset);
    if (!pending) {
      pending = fetch(this.url(asset)).then((response) => {
        if (!response.ok) throw new Error(`Unable to load ${asset}`);
        return response.blob();
      }).then((blob) => createImageBitmap(blob));
      pending.catch(() => this.imageCache.delete(asset));
      this.imageCache.set(asset, pending);
    }
    return pending;
  }

  private async loadSkinImages(options: AppearanceOption[]): Promise<Map<string, ImageBitmap>> {
    const assets = options.map((o) => o.asset).filter((a): a is string => !!a && a.endsWith('.png'));
    if (options.some((o) => o.asset?.startsWith('face/mouth_'))) assets.push('face/mouth_cover.png');
    const images = await Promise.all(assets.map((asset) => this.loadImage(asset)));
    return new Map(assets.map((asset, i) => [asset, images[i]]));
  }

  private loadAnimations(): Promise<THREE.AnimationClip[]> {
    if (!this.animations) {
      this.animations = this.loadGltf('animations.glb').then((gltf) => {
        const pelvis = gltf.scene.getObjectByName('pelvis');
        const clips = gltf.animations.filter((clip) => CLIP_NAMES.includes(clip.name));
        if (clips.length !== CLIP_NAMES.length) throw new Error('animations.glb is missing clips');
        this.pelvisRest = pelvis?.position.length() || 1;
        return clips;
      });
      this.animations.catch(() => { this.animations = null; });
    }
    return this.animations;
  }

  private loadBody(sex: Sex): Promise<BodyAsset> {
    let pending = this.bodies.get(sex);
    if (!pending) {
      pending = Promise.all([this.loadGltf(`body-${sex}.glb`), this.loadAnimations()]).then(([gltf, clips]) => this.prepareBody(sex, gltf, clips));
      pending.catch(() => this.bodies.delete(sex));
      this.bodies.set(sex, pending);
    }
    return pending;
  }

  private prepareBody(sex: Sex, gltf: GLTF, sourceClips: THREE.AnimationClip[]): BodyAsset {
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const bones = new Map<string, THREE.Bone>();
    const bind = new Map<string, THREE.Matrix4>();
    let body: THREE.SkinnedMesh | null = null;
    let brows: THREE.SkinnedMesh | null = null;
    root.traverse((child) => {
      if ((child as THREE.Bone).isBone) { bones.set(child.name, child as THREE.Bone); bind.set(child.name, child.matrixWorld.clone()); }
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = child as THREE.SkinnedMesh;
        mesh.frustumCulled = false;
        if (child.name === 'Body') body = mesh;
        if (child.name === 'Brows') brows = mesh;
      }
    });
    if (!body || !brows) throw new Error(`body-${sex}.glb has no Body/Brows mesh`);
    const bodyMesh: THREE.SkinnedMesh = body;
    const browsMesh: THREE.SkinnedMesh = brows;
    deinterleave(bodyMesh.geometry);
    deinterleave(browsMesh.geometry);
    markLashes(browsMesh, root);

    const geometry = bodyMesh.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const originalBody = new Float32Array(position.array as ArrayLike<number>);
    const originalBrows = new Float32Array((browsMesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>);
    const surface: BodySurface = { positions: originalBody, normals: normal.array as ArrayLike<number>, uvs: uv.array as ArrayLike<number>, index: geometry.index?.array as ArrayLike<number> ?? null };

    // Landmarks found on the mesh itself, so both bodies need no hand-tuned coordinates.
    const top = geometry.boundingBox?.max.y ?? (geometry.computeBoundingBox(), geometry.boundingBox!.max.y);
    const noseTip = new THREE.Vector3(0, 0, -Infinity);
    const chest = [new THREE.Vector3(0, 0, -Infinity), new THREE.Vector3(0, 0, -Infinity)];
    const ears = [new THREE.Vector3(-Infinity, 0, 0), new THREE.Vector3(Infinity, 0, 0)];
    const spine = bind.get('spine_03')!, neck = bind.get('neck_01')!;
    const chestLow = spine.elements[13], chestHigh = neck.elements[13];
    for (let i = 0; i < position.count; i++) {
      const x = originalBody[i * 3], y = originalBody[i * 3 + 1], z = originalBody[i * 3 + 2];
      if (Math.abs(x) < 0.02 && y > top - 0.25 && y < top - 0.08 && z > noseTip.z) noseTip.set(x, y, z);
      const ax = Math.abs(x);
      if (ax > 0.04 && ax < 0.17 && y > chestLow && y < chestHigh && normal.getZ(i) > 0.5) {
        const side = x > 0 ? 0 : 1;
        if (z > chest[side].z) chest[side].set(x, y, z);
      }
    }
    for (let i = 0; i < position.count; i++) {
      const x = originalBody[i * 3], y = originalBody[i * 3 + 1], z = originalBody[i * 3 + 2];
      if (y > noseTip.y && y < noseTip.y + 0.03 && Math.abs(z) < 0.06) {
        if (x > ears[0].x) ears[0].set(x, y, z);
        if (x < ears[1].x) ears[1].set(x, y, z);
      }
    }

    const material = bodyMesh.material as THREE.MeshStandardMaterial;
    const baseImage = material.map!.image as CanvasImageSource & { width: number; height: number };
    const skinCanvas = document.createElement('canvas');
    skinCanvas.width = skinCanvas.height = SKIN_TEXTURE_SIZE;
    const ctx = skinCanvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(baseImage, 0, 0, SKIN_TEXTURE_SIZE, SKIN_TEXTURE_SIZE);
    const baseSkin = ctx.getImageData(0, 0, SKIN_TEXTURE_SIZE, SKIN_TEXTURE_SIZE);
    const skinTexture = new THREE.CanvasTexture(skinCanvas);
    skinTexture.flipY = false;
    skinTexture.colorSpace = THREE.SRGBColorSpace;
    skinTexture.anisotropy = 4;
    material.map?.dispose();
    material.map = skinTexture;
    material.needsUpdate = true;

    // The library's clips carry the mannequin's pelvis height; rescale it to this body.
    const pelvis = bones.get('pelvis');
    const mixer = new THREE.AnimationMixer(root);
    const clips = sourceClips.map((source) => {
      const clip = source.clone();
      const ratio = (pelvis?.position.length() ?? 1) / this.pelvisRest;
      for (const track of clip.tracks) {
        if (track.name === 'pelvis.position') for (let i = 0; i < track.values.length; i++) track.values[i] *= ratio;
      }
      return clip;
    });
    const idle = mixer.clipAction(clips.find((clip) => clip.name === 'Idle')!);

    return {
      sex, root, body: bodyMesh, brows: browsMesh, bones, bind, originalBody, originalBrows, surface,
      baseSkin, skinReference: averageSkinColor(baseSkin.data), skinCanvas, skinTexture,
      noseTip, chestCenters: chest, earLobes: ears, mixer, clips, idle, deformKey: '', skinKey: '',
    };
  }

  // ---- Appearance ------------------------------------------------------------

  /** Nose, chest and (female) brow shape: vertex displacement from the original bind-pose positions. */
  private deform(body: BodyAsset, nose: AppearanceOption, chest: AppearanceOption, brows: AppearanceOption | null): void {
    const key = [nose.id, chest.id, brows?.id ?? ''].join('|');
    if (body.deformKey === key) return;
    body.deformKey = key;

    const position = body.body.geometry.getAttribute('position') as THREE.BufferAttribute;
    const normal = body.body.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const out = position.array as Float32Array;
    const src = body.originalBody;
    out.set(src);

    const tip = body.noseTip;
    const width = param(nose, 'width'), length = param(nose, 'length'), bridge = param(nose, 'bridge');
    const noseRadius = 0.034;
    const chestSize = param(chest, 'size');
    const chestRadius = body.sex === 'female' ? 0.078 : 0.09;
    const chestAmount = chestSize * (body.sex === 'female' ? 0.024 : 0.014);

    for (let i = 0; i < position.count; i++) {
      const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
      const dn = Math.hypot(x - tip.x, y - tip.y, z - tip.z);
      if (dn < noseRadius && z > tip.z - 0.045) {
        const f = smooth(1 - dn / noseRadius);
        const front = Math.max(0, Math.min(1, (z - (tip.z - 0.03)) / 0.03));
        out[i * 3] = x * (1 + 0.38 * width * f);
        out[i * 3 + 1] = y - 0.004 * length * f * front;
        out[i * 3 + 2] = z + 0.008 * length * f * front + 0.006 * bridge * f * Math.max(0, Math.min(1, (y - tip.y) / 0.02));
      }
      if (chestAmount !== 0 && normal.getZ(i) > 0) {
        for (const center of body.chestCenters) {
          const dc = Math.hypot(x - center.x, y - center.y, z - center.z);
          if (dc >= chestRadius) continue;
          const f = smooth(1 - dc / chestRadius) * chestAmount;
          out[i * 3] += normal.getX(i) * f;
          out[i * 3 + 1] += normal.getY(i) * f;
          out[i * 3 + 2] += normal.getZ(i) * f;
        }
      }
    }
    position.needsUpdate = true;

    const browPosition = body.brows.geometry.getAttribute('position') as THREE.BufferAttribute;
    const browOut = browPosition.array as Float32Array;
    const browSrc = body.originalBrows;
    browOut.set(browSrc);
    if (brows) {
      const thickness = param(brows, 'thickness'), arch = param(brows, 'arch');
      const lash = (body.brows.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
      let mean = 0, count = 0;
      for (let i = 0; i < browPosition.count; i++) if (lash[i * 3] >= 1) { mean += browSrc[i * 3 + 1]; count++; }
      mean /= Math.max(1, count);
      for (let i = 0; i < browPosition.count; i++) {
        const x = browSrc[i * 3], y = browSrc[i * 3 + 1];
        if (lash[i * 3] < 1) continue; // eyelashes keep their shape
        browOut[i * 3 + 1] = mean + (y - mean) * (1 + 0.25 * thickness) + arch * 0.0035 * Math.sin(Math.PI * Math.min(1, Math.abs(x) / 0.063));
      }
    }
    browPosition.needsUpdate = true;
  }

  /** Recomposes the skin texture: tone, mouth, painted facial hair, tattoo. */
  private composeSkin(
    body: BodyAsset, skin: AppearanceOption, hairColor: AppearanceOption, mouth: AppearanceOption,
    facial: AppearanceOption, tattoo: AppearanceOption, images: Map<string, ImageBitmap>,
  ): void {
    const key = [skin.id, hairColor.id, mouth.id, facial.id, tattoo.id].join('|');
    if (body.skinKey === key) return;
    body.skinKey = key;

    const size = SKIN_TEXTURE_SIZE;
    const ctx = body.skinCanvas.getContext('2d', { willReadFrequently: true })!;
    const pixels = ctx.createImageData(size, size);
    tintSkinPixels(body.baseSkin.data, pixels.data, body.skinReference, hexToRgb(skin.color ?? '#d9a37a'));
    ctx.putImageData(pixels, 0, 0);

    const tip = body.noseTip;
    const front: Vec3 = [0, 0, 1];
    const up: Vec3 = [0, 1, 0];
    const mouthY = tip.y - 0.033;
    const decals: Decal[] = [];
    const image = (asset: string | undefined) => (asset ? images.get(asset) : undefined);

    const mouthImage = image(mouth.asset);
    if (mouthImage) {
      // Hide the lips painted in the base texture under skin sampled from the chin.
      const chinUv = this.nearestUv(body, [0.012, tip.y - 0.058, tip.z]);
      decals.push({ image: images.get('face/mouth_cover.png')!, center: [0, mouthY, tip.z], normal: front, up, width: 0.078, height: 0.04, depth: 0.05, tint: sampleColor(ctx, chinUv[0], chinUv[1], size) });
      decals.push({ image: mouthImage, center: [0, mouthY, tip.z], normal: front, up, width: 0.066, height: 0.033, depth: 0.05 });
    }

    const facialImage = image(facial.asset);
    if (facialImage) {
      const ink = new THREE.Color().setStyle(hairColor.color ?? '#2a1d14').multiplyScalar(0.75).getStyle();
      if (facial.id === 'stubble') decals.push({ image: facialImage, center: [0, mouthY - 0.019, tip.z], normal: front, up, width: 0.15, height: 0.15, depth: 0.08, tint: ink, alpha: 0.75 });
      if (facial.id === 'mustache') decals.push({ image: facialImage, center: [0, tip.y - 0.022, tip.z], normal: front, up, width: 0.075, height: 0.028, depth: 0.05, tint: ink });
      if (facial.id === 'goatee') decals.push({ image: facialImage, center: [0, mouthY - 0.025, tip.z], normal: front, up, width: 0.1, height: 0.1, depth: 0.07, tint: ink });
    }

    const tattooImage = image(tattoo.asset);
    if (tattooImage) {
      const at = (bone: string) => new THREE.Vector3().setFromMatrixPosition(body.bind.get(bone)!);
      if (tattoo.id === 'face_marks') decals.push({ image: tattooImage, center: [0, tip.y + 0.012, tip.z], normal: front, up, width: 0.13, height: 0.04, depth: 0.08 });
      if (tattoo.id === 'arm_band') {
        const mid = at('upperarm_l').lerp(at('lowerarm_l'), 0.5);
        decals.push({ image: tattooImage, center: vec(mid), normal: front, up, width: 0.13, height: 0.049, depth: 0.07 });
      }
      if (tattoo.id === 'chest_sigil') {
        const y = THREE.MathUtils.lerp(at('spine_03').y, at('neck_01').y, 0.7);
        decals.push({ image: tattooImage, center: [0, y, 0.1], normal: front, up, width: 0.11, height: 0.11, depth: 0.1 });
      }
      if (tattoo.id === 'shoulder_knot') {
        const shoulder = at('upperarm_l');
        decals.push({ image: tattooImage, center: [shoulder.x, shoulder.y, shoulder.z], normal: [0, 1, 0], up: [0, 0, -1], width: 0.1, height: 0.1, depth: 0.1 });
      }
    }

    for (const decal of decals) bakeDecal(ctx, body.surface, decal, size);
    body.skinTexture.needsUpdate = true;
  }

  /** UV of the front-facing body vertex closest to a point. */
  private nearestUv(body: BodyAsset, point: Vec3): [number, number] {
    const { positions: P, normals: N, uvs: UV } = body.surface;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < P.length / 3; i++) {
      if (N[i * 3 + 2] < 0.3) continue;
      const d = Math.hypot(P[i * 3] - point[0], P[i * 3 + 1] - point[1], P[i * 3 + 2] - point[2]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return [UV[best * 2], UV[best * 2 + 1]];
  }

  /** Hair and 3D beard: built in Head-bone space by the asset pipeline. */
  private attachHead(body: BodyAsset, slot: 'hair' | 'beard', source: THREE.Object3D | null, color: THREE.Color): void {
    const head = body.bones.get('Head')!;
    for (const child of [...head.children]) if (child.name.startsWith(`${slot}:`)) head.remove(child);
    if (!source) return;
    let object = this.hairs.get(source.uuid);
    if (!object) {
      object = source.clone(true);
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone();
        (mesh.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        mesh.frustumCulled = false;
      });
      this.hairs.set(source.uuid, object);
    }
    object.name = `${slot}:${source.uuid}`;
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) (mesh.material as THREE.MeshStandardMaterial).color.copy(color);
    });
    head.add(object);
  }

  private attachPiercing(body: BodyAsset, piercing: AppearanceOption): void {
    const head = body.bones.get('Head')!;
    for (const child of [...head.children]) if (child.name.startsWith('piercing:')) head.remove(child);
    if (piercing.id === 'none') return;

    const metal = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, metalness: 0.9, roughness: 0.25 });
    const group = new THREE.Group();
    group.name = `piercing:${piercing.id}`;
    const tip = body.noseTip;
    /** Point on the skin nearest to `target`, pushed out along the surface normal. */
    const onSkin = (target: THREE.Vector3, lift: number) => {
      const { positions: P, normals: N } = body.surface;
      let best = 0, bestD = Infinity;
      for (let i = 0; i < P.length / 3; i++) {
        const d = Math.hypot(P[i * 3] - target.x, P[i * 3 + 1] - target.y, P[i * 3 + 2] - target.z);
        if (d < bestD) { bestD = d; best = i; }
      }
      const normal = new THREE.Vector3(N[best * 3], N[best * 3 + 1], N[best * 3 + 2]).normalize();
      return { at: new THREE.Vector3(P[best * 3], P[best * 3 + 1], P[best * 3 + 2]).addScaledVector(normal, lift), normal };
    };
    const ring = (radius: number, target: THREE.Vector3, axis: 'x' | 'normal' = 'x') => {
      const { at, normal } = onSkin(target, radius * 0.6);
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.24, 6, 16), metal);
      mesh.position.copy(at).addScaledVector(new THREE.Vector3(0, -1, 0), radius * 0.7);
      // Hang the ring in the plane that contains "down" and the skin normal (it passes through the skin).
      const facing = axis === 'normal' ? normal : new THREE.Vector3(1, 0, 0);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing.clone().cross(new THREE.Vector3(0, -1, 0)).normalize());
      group.add(mesh);
    };
    const stud = (target: THREE.Vector3) => {
      const radius = 0.0028;
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), metal);
      mesh.position.copy(onSkin(target, radius * 0.5).at);
      group.add(mesh);
    };
    if (piercing.id === 'nose_ring') ring(0.0055, new THREE.Vector3(tip.x + 0.011, tip.y - 0.009, tip.z - 0.008), 'normal');
    if (piercing.id === 'lip_ring') ring(0.006, new THREE.Vector3(0.012, tip.y - 0.041, tip.z - 0.012), 'normal');
    if (piercing.id === 'eyebrow_stud') {
      stud(new THREE.Vector3(0.038, tip.y + 0.058, tip.z - 0.03));
      stud(new THREE.Vector3(0.046, tip.y + 0.05, tip.z - 0.035));
    }
    if (piercing.id === 'ear_rings') {
      for (const lobe of body.earLobes) ring(0.0075, new THREE.Vector3(lobe.x, lobe.y - 0.026, lobe.z));
    }

    // Placed in body space; move into Head-bone space.
    const toHead = body.bind.get('Head')!.clone().invert();
    group.applyMatrix4(toHead);
    head.add(group);
  }

  // ---- Hand items ------------------------------------------------------------

  private async loadWeapon(type: HandWeaponType): Promise<THREE.Object3D> {
    let weapon = this.weapons.get(type);
    if (weapon) return weapon;
    if (type === 'staff' || type === 'rod' || type === 'rune') {
      weapon = buildProceduralWeapon(type);
    } else {
      weapon = (await this.loadGlb(`weapons/${type}.glb`)).clone(true);
    }
    weapon.traverse((child) => { child.frustumCulled = false; });
    weapon.name = `weapon:${type}`;
    this.weapons.set(type, weapon);
    return weapon;
  }

  private attachHands(body: BodyAsset, hands: ViewerConfig['hands'], loaded: Array<THREE.Object3D | null>): void {
    // Clear both hands of whichever body held items last (it may be the other sex's body).
    for (const holder of new Set([this.handHolder, body])) {
      if (!holder) continue;
      for (const side of ['right', 'left'] as const) {
        const hand = holder.bones.get(HAND_BONES[side])!;
        for (const child of [...hand.children]) if (child.name.startsWith('weapon:')) hand.remove(child);
      }
    }
    this.handHolder = body;
    (['right', 'left'] as const).forEach((side, i) => {
      const type = hands[side];
      const source = loaded[i];
      if (!type || !source) return;
      // The same item in both hands (dual daggers): the second hand gets its own copy.
      const item = source.parent ? Object.assign(source.clone(true), { name: source.name }) : source;
      body.bones.get(HAND_BONES[side])!.add(item);
      this.gripMatrix(body, side, type).decompose(item.position, item.quaternion, item.scale);
    });
  }

  /**
   * Where an item sits relative to the hand bone. Built in the body's bind pose
   * from the hand's own finger and thumb directions, so it works for both rigs
   * and both hands.
   */
  private gripMatrix(body: BodyAsset, side: 'right' | 'left', type: HandWeaponType): THREE.Matrix4 {
    const at = (bone: string) => new THREE.Vector3().setFromMatrixPosition(body.bind.get(bone)!);
    const hand = at(HAND_BONES[side]);
    const finger = at(FINGER_BONES[side]).sub(hand).normalize();
    const thumbRaw = at(THUMB_BONES[side]).sub(hand);
    const thumb = thumbRaw.sub(finger.clone().multiplyScalar(thumbRaw.dot(finger))).normalize();
    let palm = new THREE.Vector3().crossVectors(finger, thumb).normalize();
    if (palm.y > 0) palm.negate(); // palms face down in the bind pose

    const basis = (y: THREE.Vector3, zHint: THREE.Vector3) => {
      const yAxis = y.clone().normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zHint).normalize();
      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
      return new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    };
    const fist = hand.clone().addScaledVector(finger, 0.075).addScaledVector(palm, 0.022);
    // One-handed blades and wands hang along the leg, point tilted slightly forward.
    const hanging = finger.clone().multiplyScalar(Math.cos(0.45)).addScaledVector(thumb, Math.sin(0.45));
    let rotation = basis(hanging, palm.clone().negate());
    let position = fist;
    switch (type) {
      case 'dagger': case 'sword': case 'rod':
        break;
      case 'greatsword': case 'staff':
        rotation = basis(finger.clone().negate(), thumb);
        position = fist.clone().addScaledVector(thumb, 0.02);
        break;
      case 'bow':
        rotation = basis(finger.clone().negate(), thumb.clone().negate());
        break;
      case 'shield':
        rotation = basis(finger.clone().negate(), palm.clone().negate());
        position = hand.clone().addScaledVector(finger, -0.12).addScaledVector(palm, -0.055);
        break;
      case 'rune':
        rotation = basis(finger.clone().negate(), thumb);
        position = fist.clone().addScaledVector(palm, 0.06);
        break;
    }
    const world = rotation.setPosition(position);
    return body.bind.get(HAND_BONES[side])!.clone().invert().multiply(world);
  }

  // ---- Rendering ---------------------------------------------------------------

  private updateCamera(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    this.camera.aspect = w > 0 && h > 0 ? w / h : 0.75;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    if (this.framing === 'bust' && this.current) {
      // Follow the animated head (the idle pose lowers it a few centimetres).
      const head = this.current.bones.get('Head')!;
      this.model.updateMatrixWorld(true);
      const headY = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).y;
      const bindHeadY = new THREE.Vector3().setFromMatrixPosition(this.current.bind.get('Head')!).y;
      const eyes = headY + (this.current.noseTip.y + 0.04 - bindHeadY) * this.model.scale.y;
      const half = 0.36;
      const distance = half / Math.tan(halfFov);
      this.camera.position.set(0, eyes - 0.05, distance);
      this.camera.lookAt(0, eyes - 0.17, 0);
    } else {
      // Fixed frame (2.24 m), so a shorter character really looks shorter.
      const half = 1.12;
      const distance = Math.max(half, half * 0.62 / this.camera.aspect) / Math.tan(halfFov);
      this.camera.position.set(0, 1.12, distance);
      this.camera.lookAt(0, 1.02, 0);
    }
    this.camera.updateProjectionMatrix();
  }

  private renderOnce(): void {
    if (this.disposed) return;
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.current?.mixer.update(delta);
    this.renderer.render(this.scene, this.camera);
  }

  private startLoop(): void {
    if (this.frame !== null || this.disposed || !this.visible || document.hidden) return;
    this.clock.getDelta();
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      this.renderOnce();
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private observeSize(): void {
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = this.host;
      if (w > 0 && h > 0) this.renderer.setSize(w, h, false);
      this.updateCamera();
      this.renderOnce();
    };
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(resize);
      observer.observe(this.host);
      this.cleanups.push(() => observer.disconnect());
    }
  }

  private observeVisibility(): void {
    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver((entries) => {
        this.visible = entries.some((entry) => entry.isIntersecting);
        if (this.visible) this.startLoop(); else this.stopLoop();
      });
      observer.observe(this.host);
      this.cleanups.push(() => observer.disconnect());
    }
    const onVisibility = () => (document.hidden ? this.stopLoop() : this.startLoop());
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
    this.startLoop();
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    const down = (event: PointerEvent) => {
      if (!this.interactive) return;
      this.dragX = event.clientX;
      canvas.setPointerCapture?.(event.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const move = (event: PointerEvent) => {
      if (this.dragX === null) return;
      this.model.rotation.y += (event.clientX - this.dragX) * 0.012;
      this.dragX = event.clientX;
    };
    const up = () => {
      this.dragX = null;
      if (this.interactive) canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    this.cleanups.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    // Listeners first: releasing the context fires webglcontextlost, which must not report a failure.
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const pending of this.bodies.values()) {
      pending.then((body) => { body.mixer.stopAllAction(); disposeObject(body.root); }, () => undefined);
    }
    for (const weapon of this.weapons.values()) disposeObject(weapon);
    for (const hair of this.hairs.values()) disposeObject(hair);
    for (const pending of this.glbCache.values()) pending.then(disposeObject, () => undefined);
    for (const pending of this.imageCache.values()) pending.then((image) => image.close(), () => undefined);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

/**
 * The brow mesh also holds the eyelashes/eyeliner. Vertices close to an eye get
 * a dark vertex colour so only the brows take the hair colour.
 */
function markLashes(brows: THREE.SkinnedMesh, root: THREE.Object3D): void {
  const eyes = root.getObjectByName('Eyes') as THREE.Mesh | undefined;
  const centres = [new THREE.Vector3(), new THREE.Vector3()];
  const counts = [0, 0];
  const eyePosition = eyes?.geometry.getAttribute('position');
  if (eyePosition) {
    for (let i = 0; i < eyePosition.count; i++) {
      const side = eyePosition.getX(i) > 0 ? 0 : 1;
      centres[side].x += eyePosition.getX(i); centres[side].y += eyePosition.getY(i); centres[side].z += eyePosition.getZ(i);
      counts[side]++;
    }
    centres.forEach((centre, side) => centre.divideScalar(Math.max(1, counts[side])));
  }
  const position = brows.geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
    const nearEye = !!eyePosition && Math.min(p.distanceTo(centres[0]), p.distanceTo(centres[1])) < 0.019;
    colors.fill(nearEye ? 0.12 : 1, i * 3, i * 3 + 3);
  }
  brows.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  (brows.material as THREE.MeshStandardMaterial).vertexColors = true;
  (brows.material as THREE.MeshStandardMaterial).needsUpdate = true;
}

/** The appearance code reads and rewrites vertex arrays directly, which needs one plain array per attribute. */
function deinterleave(geometry: THREE.BufferGeometry): void {
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if ((attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      const source = attribute as THREE.InterleavedBufferAttribute;
      const plain = new THREE.BufferAttribute(new Float32Array(source.count * source.itemSize), source.itemSize, source.normalized);
      for (let i = 0; i < source.count; i++) {
        for (let c = 0; c < source.itemSize; c++) plain.setComponent(i, c, source.getComponent(i, c));
      }
      geometry.setAttribute(name, plain);
    }
  }
}

/** Items the CC0 pack does not have: simple low-poly shapes, grip at the origin, long axis +Y. */
function buildProceduralWeapon(type: 'staff' | 'rod' | 'rune'): THREE.Object3D {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.85, flatShading: true });
  const crystal = (color: number) => new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92,
  });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    group.add(mesh);
    return mesh;
  };
  if (type === 'staff') {
    add(new THREE.CylinderGeometry(0.016, 0.02, 1.62, 6), wood, 0.24);
    add(new THREE.TorusGeometry(0.05, 0.012, 5, 8), wood, 1.08).rotation.x = Math.PI / 2;
    add(new THREE.IcosahedronGeometry(0.048, 0), crystal(0x4fb6ff), 1.1);
  } else if (type === 'rod') {
    add(new THREE.CylinderGeometry(0.008, 0.013, 0.36, 6), wood, 0.12);
    add(new THREE.OctahedronGeometry(0.026, 0), crystal(0xa86bff), 0.33).scale.set(1, 1.5, 1);
  } else {
    const gem = add(new THREE.OctahedronGeometry(0.06, 0), crystal(0x58e0d0), 0);
    gem.scale.set(1, 1.45, 1);
    const halo = add(new THREE.TorusGeometry(0.085, 0.005, 4, 18), crystal(0x58e0d0), 0);
    halo.rotation.x = Math.PI / 2;
  }
  return group;
}
