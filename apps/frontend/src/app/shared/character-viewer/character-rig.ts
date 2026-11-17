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
import type { AnimationSource, CharacterRigHandle, CharacterRigOptions, ViewerConfig, ViewerFraming } from './character-viewer.types';
import { CLIP_SECONDS, type AnimationState } from '../character-animation/animation-state';
import { averageSkinColor, bakeDecal, hexToRgb, sampleColor, tintSkinPixels, type BodySurface, type Decal, type Vec3 } from './skin-compositor';

/** Height of each body as modelled, in cm (assets report, Task 0). */
export const NATIVE_HEIGHT_CM: Record<Sex, number> = { male: 181, female: 177 };
const SKIN_TEXTURE_SIZE = 1024;
/** Background loops, phased by the absolute clock (two views of the same character walk in step). */
const BASE_CLIPS = ['Idle', 'Walk', 'CombatIdle'] as const;
/** Full-body clips that take over from the loop: actions, casting, death. */
const OVERLAY_CLIPS = ['Attack', 'Dead', 'CastStart', 'CastLoop'] as const;
/** Flinches, blended over whatever plays. */
const HIT_CLIPS = ['Damage', 'Damage2'] as const;
const CLIP_NAMES: string[] = [...BASE_CLIPS, ...OVERLAY_CLIPS, ...HIT_CLIPS];
/** Clips authored right-handed (sword arm, casting arm), mirrored for left-handed characters. */
const MIRRORED_CLIPS = ['Attack', 'CombatIdle', 'CastStart', 'CastLoop'];
const MIRROR_SAMPLES_PER_SECOND = 30;
const FADE_IN_SECONDS = 0.12;
const FADE_OUT_SECONDS = 0.2;
/** Peak weight of a flinch: enough to read as a hit, not enough to cut the action under it. */
const HIT_PEAK = 0.4;
const HAND_BONES = { right: 'hand_r', left: 'hand_l' } as const;
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;

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
  /** Face landmarks for the face-shape trait. */
  jaw: THREE.Vector3[];
  chin: THREE.Vector3;
  cheeks: THREE.Vector3[];
  earLobes: THREE.Vector3[];
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  /** One action per clip, all playing; the rig sets their time and weight on every frame. */
  actions: Map<string, THREE.AnimationAction>;
  /** Smoothed (crossfaded) layer weights, before composition. */
  weights: Map<string, number>;
  /** Clock time of the last animated frame; null until the body's first frame (which snaps). */
  animatedAtMs: number | null;
  /** The other handedness of MIRRORED_CLIPS; swapped with `actions` when it is in use. */
  mirrorActions: Map<string, THREE.AnimationAction>;
  /** Whether `actions` currently holds the left-handed (mirrored) variants. */
  mirrored: boolean;
  /** Closed-fist frame of each hand in the Idle pose, in hand-bone space. */
  fists: Record<'right' | 'left', Fist>;
  deformKey: string;
  skinKey: string;
}

interface Fist {
  /** Centre of the hole formed by the curled fingers. */
  centre: THREE.Vector3;
  /** Along the hole, towards the index/thumb side. */
  lateral: THREE.Vector3;
  /** From the wrist towards the knuckles. */
  along: THREE.Vector3;
  /** Towards the palm (where the fingers curl). */
  palm: THREE.Vector3;
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
  /** The bow in hand, if any: the Attack becomes a procedural draw-and-loose instead of the sword clip. */
  private bow: { side: 'right' | 'left'; item: THREE.Object3D } | null = null;
  private bowDraw: BowDrawParts | null = null;
  private lastBowDrawn = 0;
  /**
   * Bone rotations as the mixer left them before the bow pose overrode them. The mixer
   * only writes a bone when its mixed value changes, so they are put back before the
   * next frame; otherwise a static pose would keep the drawn arms.
   */
  private readonly ikRestore: Array<[THREE.Bone, THREE.Quaternion]> = [];
  private animation: AnimationSource = { base: 'Idle' };
  private animationClock: () => number = Date.now;
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
  private yawKey = '';
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
  playingClip(): string | null {
    let best: string | null = null, bestWeight = 0;
    for (const [name, action] of this.current?.actions ?? []) {
      const weight = action.getEffectiveWeight();
      if (weight > bestWeight) { best = name; bestWeight = weight; }
    }
    return best;
  }
  clipWeight(name: string): number { return this.current?.actions.get(name)?.getEffectiveWeight() ?? 0; }
  clipTime(name: string): number { return this.current?.actions.get(name)?.time ?? 0; }
  setAnimation(source: AnimationSource, clock: () => number = Date.now): void {
    this.animation = source;
    this.animationClock = clock;
  }
  renderNow(): void { this.renderOnce(); }
  bonePosition(name: string): [number, number, number] {
    const body = this.current;
    if (!body) return [0, 0, 0];
    body.root.updateMatrixWorld(true);
    const world = new THREE.Vector3().setFromMatrixPosition(this.bone(name).matrixWorld);
    return body.root.worldToLocal(world).toArray() as [number, number, number];
  }
  bowDrawn(): number { return this.lastBowDrawn; }
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
      this.loadSkinImages([pick('mouthDetails'), facial, pick('tattoo')]),
      Promise.all((['right', 'left'] as const).map((side) => (config.hands[side] ? this.loadWeapon(config.hands[side]!) : null))),
    ]);
    if (this.disposed) return;

    if (this.current !== body) {
      if (this.current) this.model.remove(this.current.root);
      this.model.add(body.root);
      this.current = body;
      // The body's first frame shows the current pose directly (no fade from a stale one).
      body.animatedAtMs = null;
    }

    this.deform(body, pick('face'), pick('nose'), pick('mouth'), pick('chest'), config.sex === 'female' ? facial : null);
    this.composeSkin(body, pick('skin'), pick('hairColor'), pick('mouthDetails'), facial, pick('tattoo'), skinImages);
    const hairColor = new THREE.Color().setStyle(pick('hairColor').color ?? '#3a2a20').multiplyScalar(1.6);
    (body.brows.material as THREE.MeshStandardMaterial).color.copy(hairColor).multiplyScalar(0.8);
    this.attachHead(body, 'hair', hairObject, hairColor);
    this.attachHead(body, 'beard', beardObject, hairColor);
    this.attachPiercing(body, pick('piercing'));
    this.attachHands(body, config.hands, weaponObjects);

    this.useHandedness(body, config.dominantHand === 'left');
    this.model.scale.setScalar(config.heightCm / NATIVE_HEIGHT_CM[config.sex]);
    // Turn the dominant side towards the camera. Not reset while the user can drag,
    // unless the framing or the dominant hand changes.
    const yawKey = `${config.framing}|${config.dominantHand}`;
    if (yawKey !== this.yawKey) {
      this.yawKey = yawKey;
      // portrait: whole body facing the screen; otherwise a slight turn towards the dominant side.
      this.model.rotation.y = config.framing === 'portrait' ? 0 : (config.dominantHand === 'left' ? -1 : 1) * 0.32;
    }
    this.framing = config.framing;
    this.interactive = config.interactive;
    this.renderer.domElement.style.cursor = config.interactive ? 'grab' : '';
    this.updateCamera();
    this.renderOnce();
  }

  /** Left-handed characters play the mirrored swing, guard and cast. */
  private useHandedness(body: BodyAsset, leftHanded: boolean): void {
    if (body.mirrored === leftHanded) return;
    for (const name of MIRRORED_CLIPS) {
      const from = body.actions.get(name)!, to = body.mirrorActions.get(name)!;
      to.time = from.time;
      to.setEffectiveWeight(from.getEffectiveWeight());
      from.setEffectiveWeight(0);
      body.actions.set(name, to);
      body.mirrorActions.set(name, from);
    }
    body.mirrored = leftHanded;
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
    const jaw = [new THREE.Vector3(-Infinity, 0, 0), new THREE.Vector3(Infinity, 0, 0)];
    const chin = new THREE.Vector3(0, 0, -Infinity);
    const cheeks = [new THREE.Vector3(0, 0, -Infinity), new THREE.Vector3(0, 0, -Infinity)];
    for (let i = 0; i < position.count; i++) {
      const x = originalBody[i * 3], y = originalBody[i * 3 + 1], z = originalBody[i * 3 + 2];
      const dy = y - noseTip.y, dz = z - noseTip.z;
      if (dy > -0.075 && dy < -0.045 && dz > -0.12 && dz < -0.06) {
        if (x > jaw[0].x) jaw[0].set(x, y, z);
        if (x < jaw[1].x) jaw[1].set(x, y, z);
      }
      if (Math.abs(x) < 0.01 && dy > -0.075 && dy < -0.055 && z > chin.z) chin.set(x, y, z);
      if (Math.abs(Math.abs(x) - 0.045) < 0.008 && Math.abs(dy + 0.008) < 0.01 && normal.getZ(i) > 0.3) {
        const side = x > 0 ? 0 : 1;
        if (z > cheeks[side].z) cheeks[side].set(x, y, z);
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
    // Left-handed variants of the clips that favour one hand (sampled before the mixer binds anything).
    const mirrorSources = clips.filter((clip) => MIRRORED_CLIPS.includes(clip.name)).map((clip) => mirrorClip(clip, root, bones));
    // Every clip plays all the time at time scale 0: the rig positions each one by the
    // clock and decides its weight, so the mixer never advances anything by itself.
    const makeAction = (clip: THREE.AnimationClip) => {
      const action = mixer.clipAction(clip);
      if (!(BASE_CLIPS as readonly string[]).includes(clip.name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true; // Dead (and every one-shot) holds its last frame
      }
      action.timeScale = 0;
      action.setEffectiveWeight(clip.name === 'Idle' ? 1 : 0);
      action.play();
      return action;
    };
    const actions = new Map<string, THREE.AnimationAction>(clips.map((clip) => [clip.name, makeAction(clip)]));
    const mirrorActions = new Map<string, THREE.AnimationAction>(mirrorSources.map((clip) => [clip.name, makeAction(clip)]));
    for (const action of mirrorActions.values()) action.setEffectiveWeight(0);

    // Measure the closed fist in the Idle pose (in the bind pose the fingers are straight).
    mixer.update(0);
    root.updateMatrixWorld(true);
    const fists = { right: measureFist(bones, 'r'), left: measureFist(bones, 'l') };

    return {
      sex, root, body: bodyMesh, brows: browsMesh, bones, bind, originalBody, originalBrows, surface,
      baseSkin, skinReference: averageSkinColor(baseSkin.data), skinCanvas, skinTexture,
      noseTip, chestCenters: chest, jaw, chin, cheeks, earLobes: ears, mixer, clips, actions, mirrorActions, mirrored: false,
      weights: new Map(CLIP_NAMES.map((name) => [name, name === 'Idle' ? 1 : 0])), animatedAtMs: null,
      fists, deformKey: '', skinKey: '',
    };
  }

  // ---- Appearance ------------------------------------------------------------

  /** Nose, chest and (female) brow shape: vertex displacement from the original bind-pose positions. */
  private deform(body: BodyAsset, face: AppearanceOption, nose: AppearanceOption, mouth: AppearanceOption, chest: AppearanceOption, brows: AppearanceOption | null): void {
    const key = [face.id, nose.id, mouth.id, chest.id, brows?.id ?? ''].join('|');
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
    const mouthWidth = param(mouth, 'width'), lipThickness = param(mouth, 'thickness');
    // Mouth centre: the slit between the lips, a fixed drop below the nose tip on both bodies.
    const mouthY = tip.y - 0.033, mouthZ = tip.z - 0.02, mouthRadius = 0.036;
    const jawWidth = param(face, 'jaw'), chinLength = param(face, 'chin'), chinWidth = param(face, 'chinWidth'), cheekFull = param(face, 'cheeks');

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
      // Mouth shape: wider/narrower and thicker/thinner lips (lips spread away from the slit).
      if ((mouthWidth !== 0 || lipThickness !== 0) && z > mouthZ - 0.03) {
        const d = Math.hypot(x, (y - mouthY) * 1.6, z - mouthZ);
        if (d < mouthRadius) {
          const f = smooth(1 - d / mouthRadius);
          out[i * 3] += x * 0.28 * mouthWidth * f;
          // Keep the slit itself in place (a 2 mm dead zone) so thicker lips do not open the mouth.
          const dy = y - mouthY;
          out[i * 3 + 1] += Math.sign(dy) * Math.max(0, Math.abs(dy) - 0.002) * 0.55 * lipThickness * f;
          out[i * 3 + 2] += 0.003 * lipThickness * f;
        }
      }
      // Face shape: wider/narrower jaw angles, longer/shorter and wider/narrower chin, fuller cheeks.
      if (jawWidth !== 0) {
        for (const corner of body.jaw) {
          const d = Math.hypot(x - corner.x, y - corner.y, z - corner.z);
          if (d < 0.05) out[i * 3] += Math.sign(corner.x) * 0.009 * jawWidth * smooth(1 - d / 0.05);
        }
      }
      if (chinLength !== 0 || chinWidth !== 0) {
        const c = body.chin;
        const d = Math.hypot(x - c.x, y - c.y, z - c.z);
        if (d < 0.038) {
          const f = smooth(1 - d / 0.038);
          out[i * 3] += x * 0.3 * chinWidth * f;
          out[i * 3 + 1] -= 0.008 * chinLength * f;
          out[i * 3 + 2] += 0.004 * chinLength * f;
        }
      }
      if (cheekFull !== 0) {
        for (const cheek of body.cheeks) {
          const d = Math.hypot(x - cheek.x, y - cheek.y, z - cheek.z);
          if (d >= 0.032) continue;
          const f = smooth(1 - d / 0.032) * 0.005 * cheekFull;
          out[i * 3] += normal.getX(i) * f;
          out[i * 3 + 1] += normal.getY(i) * f;
          out[i * 3 + 2] += normal.getZ(i) * f;
        }
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
      mesh.position.copy(at);
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
    if (piercing.id === 'nose_ring') ring(0.0055, new THREE.Vector3(tip.x + 0.013, tip.y - 0.004, tip.z - 0.014), 'normal');
    // Lower lip: it sits lower on the male face (measured: 4.3 cm vs 3.7 cm below the nose tip).
    const lowerLip = body.sex === 'male' ? 0.043 : 0.037;
    if (piercing.id === 'lip_ring') ring(0.0058, new THREE.Vector3(0.011, tip.y - lowerLip, tip.z - 0.012), 'normal');
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
    this.bow = null;
    (['right', 'left'] as const).forEach((side, i) => {
      const type = hands[side];
      const source = loaded[i];
      if (!type || !source) return;
      // The same item in both hands (dual daggers): the second hand gets its own copy.
      const item = source.parent ? Object.assign(source.clone(true), { name: source.name }) : source;
      body.bones.get(HAND_BONES[side])!.add(item);
      this.gripMatrix(body, side, type).decompose(item.position, item.quaternion, item.scale);
      if (type === 'bow') this.bow = { side, item };
    });
  }

  /**
   * Where an item sits in hand-bone space. The handle goes through the hole of
   * the closed fist (measured from the Idle pose), so the hand wraps it.
   */
  private gripMatrix(body: BodyAsset, side: 'right' | 'left', type: HandWeaponType): THREE.Matrix4 {
    const { centre, lateral, along, palm } = body.fists[side];
    const basis = (y: THREE.Vector3, zHint: THREE.Vector3) => {
      const yAxis = y.clone().normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zHint).normalize();
      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
      return new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    };
    /** Handle axis: out of the thumb side, tipped towards the fingertips (downwards when the arm hangs). */
    const through = (tilt: number, outwards = 0) => lateral.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(along, Math.sin(tilt)).addScaledVector(palm, -outwards);
    let matrix: THREE.Matrix4;
    switch (type) {
      case 'greatsword':
        matrix = basis(through(0.95, 0.35), palm).setPosition(centre);
        break;
      case 'bow':
        // Nearly upright at the side, upper limb forward; the string (bow +X) faces the
        // forearm and elbow, not the space in front of the character.
        matrix = basis(through(1.25).applyAxisAngle(palm, -Math.PI / 2), palm).setPosition(centre);
        break;
      case 'staff':
        // Top leans forward, following the fist's hole, so it clears the arm.
        matrix = basis(through(-0.62, 0.22), palm).setPosition(centre);
        break;
      case 'shield':
        // On the back of the forearm, facing outwards.
        matrix = basis(along.clone().negate(), palm.clone().negate())
          .setPosition(centre.clone().addScaledVector(along, -0.15).addScaledVector(palm, -0.038));
        break;
      case 'rune':
        matrix = basis(along.clone().negate(), lateral).setPosition(centre.clone().addScaledVector(along, 0.085));
        break;
      default: // dagger, sword, rod
        matrix = basis(through(0.5, 0.15), palm).setPosition(centre);
    }
    return matrix;
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
      const [half, centreBelowEyes] = [0.36, 0.17];
      const distance = Math.max(half, half * 0.62 / this.camera.aspect) / Math.tan(halfFov);
      this.camera.position.set(0, eyes - centreBelowEyes + 0.12, distance);
      this.camera.lookAt(0, eyes - centreBelowEyes, 0);
    } else {
      // full and portrait: fixed frame (2.24 m), so a shorter character really looks shorter.
      const half = 1.12;
      const distance = Math.max(half, half * 0.62 / this.camera.aspect) / Math.tan(halfFov);
      this.camera.position.set(0, 1.12, distance);
      this.camera.lookAt(0, 1.02, 0);
    }
    this.camera.updateProjectionMatrix();
  }

  private renderOnce(): void {
    if (this.disposed) return;
    if (this.current) this.animate(this.current, this.animationClock());
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Turns the AnimationState at `nowMs` into a time and an effective weight per clip.
   * Times come from the clock alone; only the crossfade weights carry over between
   * frames (the body's first frame snaps to the targets).
   */
  private animate(body: BodyAsset, nowMs: number): void {
    const state: AnimationState = typeof this.animation === 'function' ? this.animation(nowMs) : this.animation;
    for (const [bone, quaternion] of this.ikRestore.splice(0)) bone.quaternion.copy(quaternion);
    const snap = body.animatedAtMs === null;
    const dt = snap ? 0 : Math.max(0, (nowMs - body.animatedAtMs!) / 1000);
    body.animatedAtMs = nowMs;
    const action = (name: string) => body.actions.get(name)!;
    const duration = (name: string) => action(name).getClip().duration;
    const hold = (name: string, seconds: number) => { action(name).time = Math.max(0, Math.min(duration(name), seconds)); };

    for (const name of BASE_CLIPS) action(name).time = ((nowMs / 1000) % duration(name) + duration(name)) % duration(name);
    let overlay: string | null = null;
    // With a bow, Attack keeps the combat guard underneath and the arms are posed procedurally.
    const bowShot = this.bow && state.oneShot?.clip === 'Attack' ? state.oneShot : null;
    if (bowShot) {
      overlay = null;
    } else if (state.oneShot) {
      overlay = state.oneShot.clip;
      hold(overlay, ((nowMs - state.oneShot.startedAtMs) / 1000) * state.oneShot.speed);
    } else if (state.cast) {
      const elapsed = (nowMs - state.cast.startedAtMs) / 1000;
      const enter = duration('CastStart');
      if (elapsed < enter) {
        overlay = 'CastStart';
        hold('CastStart', elapsed);
      } else {
        overlay = 'CastLoop';
        hold('CastLoop', (elapsed - enter) % duration('CastLoop'));
      }
    }
    // Clips that leave the state keep their last time while they fade out.

    const ease = (name: string, target: number) => {
      const from = body.weights.get(name) ?? 0;
      const next = snap ? target : target > from ? Math.min(target, from + dt / FADE_IN_SECONDS) : Math.max(target, from - dt / FADE_OUT_SECONDS);
      body.weights.set(name, next);
      return next;
    };
    const baseWeights = BASE_CLIPS.map((name) => ease(name, name === state.base ? 1 : 0));
    const overlayWeights = OVERLAY_CLIPS.map((name) => ease(name, name === overlay ? 1 : 0));

    // Compose so the weights always sum to one: a deficit would blend in the bind pose.
    const overlaySum = overlayWeights.reduce((a, b) => a + b, 0);
    const overlayScale = overlaySum > 1 ? 1 / overlaySum : 1;
    const overlayTotal = Math.min(1, overlaySum);
    const baseSum = baseWeights.reduce((a, b) => a + b, 0) || 1;
    let hitWeight = 0;
    if (state.hit) {
      const elapsed = (nowMs - state.hit.startedAtMs) / 1000;
      const length = duration(state.hit.clip);
      if (elapsed >= 0 && elapsed < length) {
        hitWeight = HIT_PEAK * Math.sin((Math.PI * elapsed) / length);
        hold(state.hit.clip, elapsed);
      }
    }
    const rest = 1 - hitWeight;
    BASE_CLIPS.forEach((name, i) => action(name).setEffectiveWeight(rest * (1 - overlayTotal) * (baseWeights[i] / baseSum)));
    OVERLAY_CLIPS.forEach((name, i) => action(name).setEffectiveWeight(rest * overlayWeights[i] * overlayScale));
    for (const name of HIT_CLIPS) action(name).setEffectiveWeight(state.hit?.clip === name ? hitWeight : 0);
    body.mixer.update(0);
    const progress = bowShot ? ((nowMs - bowShot.startedAtMs) / 1000) * bowShot.speed / CLIP_SECONDS.Attack : null;
    this.lastBowDrawn = this.poseBowShot(body, progress !== null && progress >= 0 && progress < 1 ? progress : null);
  }

  /**
   * Draw and loose, posed over the animated arms with two-bone IK. `progress` is the
   * fraction of the Attack window (0..1), or null when no shot is under way. The bow
   * arm reaches forward, the other hand pulls the string from the bow to the face and
   * lets go; the string bends towards that hand and an arrow sits on it until release.
   * Returns how far the string is drawn (0..1).
   */
  private poseBowShot(body: BodyAsset, progress: number | null): number {
    const parts = this.bow ? this.bowParts(this.bow.item) : null;
    if (!this.bow || !parts || progress === null) {
      if (parts) { parts.restString(); parts.arrow.visible = false; }
      return 0;
    }
    const p = progress;
    // Phases: raise 0-0.18, draw 0.18-0.5, hold 0.5-0.62, loose 0.62-0.72, lower 0.72-1.
    const weight = p < 0.18 ? smooth(p / 0.18) : p > 0.72 ? smooth((1 - p) / 0.28) : 1;
    const drawn = p < 0.18 ? 0 : p < 0.5 ? smooth((p - 0.18) / 0.32) : p < 0.62 ? 1 : 0;
    const follow = p < 0.62 ? 0 : smooth(Math.min(1, (p - 0.62) / 0.1));

    const bowSide = this.bow.side === 'right' ? 'r' : 'l';
    const drawSide = bowSide === 'r' ? 'l' : 'r';
    for (const side of ['r', 'l']) {
      for (const name of [`upperarm_${side}`, `lowerarm_${side}`, `hand_${side}`]) {
        const bone = body.bones.get(name)!;
        this.ikRestore.push([bone, bone.quaternion.clone()]);
      }
    }
    const out = bowSide === 'r' ? -1 : 1; // the character's right side is -X in body space
    const root = body.root;
    root.updateMatrixWorld(true);
    const local = (name: string) => root.worldToLocal(new THREE.Vector3().setFromMatrixPosition(body.bones.get(name)!.matrixWorld));
    const toWorld = (v: THREE.Vector3) => root.localToWorld(v.clone());
    const reach = (side: string) => local(`lowerarm_${side}`).distanceTo(local(`upperarm_${side}`)) + local(`hand_${side}`).distanceTo(local(`lowerarm_${side}`));

    // Bow arm: straight out in front of its shoulder, so the bow stays clear of the face.
    const shoulder = local(`upperarm_${bowSide}`);
    const head = local('Head');
    const aim = new THREE.Vector3(out * 0.22, 0.08, 1).normalize();
    const bowHand = shoulder.clone().addScaledVector(aim, reach(bowSide) * 0.99);
    twoBoneIk(body.bones, bowSide, toWorld(bowHand), toWorld(shoulder.clone().add(new THREE.Vector3(out * 0.6, -1, -0.2))), weight);
    // Bow upright, string towards the archer.
    const rootQuat = root.getWorldQuaternion(new THREE.Quaternion());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rootQuat);
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(rootQuat);
    const bowWorld = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(back, up, new THREE.Vector3().crossVectors(back, up)));
    orientBone(body.bones.get(`hand_${bowSide}`)!, bowWorld.multiply(this.bow.item.quaternion.clone().invert()), weight);

    // Draw hand: from the nocking point on the resting string to the face, then away on release.
    this.bow.item.updateMatrixWorld(true);
    parts.restString();
    const nock = root.worldToLocal(this.bow.item.localToWorld(parts.nock.clone()));
    // Anchor under the chin, on the drawing side: as long a draw as the facing-forward body allows.
    const anchor = new THREE.Vector3(head.x - out * 0.05, head.y - 0.07, head.z + 0.06);
    const released = anchor.clone().add(new THREE.Vector3(-out * 0.08, 0.02, -0.1));
    const hand = nock.clone().lerp(anchor, drawn).lerp(released, follow);
    twoBoneIk(body.bones, drawSide, toWorld(hand), toWorld(local(`upperarm_${drawSide}`).add(new THREE.Vector3(-out * 1, 0.25, -0.6))), weight);

    // String and arrow follow the drawing hand (in bow space).
    this.bow.item.updateMatrixWorld(true);
    const pull = this.bow.item.worldToLocal(toWorld(nock.clone().lerp(anchor, drawn)));
    const pulled = drawn * weight;
    parts.bendString(new THREE.Vector3().lerpVectors(parts.nock, pull, pulled));
    parts.arrow.visible = p >= 0.12 && p < 0.62;
    if (parts.arrow.visible) parts.placeArrow(new THREE.Vector3().lerpVectors(parts.nock, pull, pulled));
    return pulled;
  }

  /** String vertices and an arrow for a bow item, created once per bow object. */
  private bowParts(item: THREE.Object3D): BowDrawParts | null {
    if (this.bowDraw?.item === item) return this.bowDraw;
    let string: THREE.Mesh | null = null;
    item.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.Material).name === 'White') string = mesh;
    });
    if (!string) return null;
    const stringMesh = string as THREE.Mesh;
    // Own copy of the geometry: the cached bow object is shared.
    stringMesh.geometry = stringMesh.geometry.clone();
    const position = stringMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const rest = new Float32Array(position.array as ArrayLike<number>);
    let top = 0, x = 0;
    for (let i = 0; i < position.count; i++) { top = Math.max(top, Math.abs(rest[i * 3 + 1])); x += rest[i * 3]; }
    x /= position.count;
    const nock = new THREE.Vector3(x, 0, 0);
    const arrow = buildArrow();
    arrow.visible = false;
    item.add(arrow);
    const parts: BowDrawParts = {
      item, nock, arrow,
      restString: () => { (position.array as Float32Array).set(rest); position.needsUpdate = true; },
      bendString: (to) => {
        const out = position.array as Float32Array;
        for (let i = 0; i < position.count; i++) {
          // Straight lines from each tip to the pulled nocking point.
          const t = 1 - Math.min(1, Math.abs(rest[i * 3 + 1]) / top);
          out[i * 3] = rest[i * 3] + (to.x - nock.x) * t;
          out[i * 3 + 1] = rest[i * 3 + 1] + to.y * t;
          out[i * 3 + 2] = rest[i * 3 + 2] + (to.z - nock.z) * t;
        }
        position.needsUpdate = true;
      },
      placeArrow: (at) => {
        // Nock on the string, shaft through the bow's grip (the origin), pointing away from the archer.
        const forward = at.clone().negate().normalize();
        arrow.position.copy(at);
        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
      },
    };
    this.bowDraw = parts;
    return parts;
  }

  private startLoop(): void {
    if (this.frame !== null || this.disposed || !this.visible || document.hidden) return;
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
 * Left-right mirror of a clip. Each frame is sampled on the body, every bone's rotation
 * relative to its rest pose is reflected across the body's midplane (x = 0) and given to
 * its counterpart (`_l` <-> `_r`), then turned back into local rotations. Working in body
 * space keeps it independent of the bones' axis conventions; it relies on the rest pose
 * being symmetric, which holds for both bodies. Must run before the body's own mixer
 * binds the bones; the sampled pose is undone afterwards.
 */
function mirrorClip(clip: THREE.AnimationClip, root: THREE.Object3D, bones: Map<string, THREE.Bone>): THREE.AnimationClip {
  const counterpart = (name: string) => (name.endsWith('_l') ? `${name.slice(0, -2)}_r` : name.endsWith('_r') ? `${name.slice(0, -2)}_l` : name);
  const list = [...bones.values()];
  const rest = list.map((bone) => [bone.quaternion.clone(), bone.position.clone()] as const);
  root.updateMatrixWorld(true);
  const rootInverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const inBody = (object: THREE.Object3D) => rootInverse.clone().multiply(object.getWorldQuaternion(new THREE.Quaternion()));
  const restInBody = new Map(list.map((bone) => [bone.name, inBody(bone)]));
  const animated = new Set(clip.tracks.filter((t) => t.name.endsWith('.quaternion')).map((t) => t.name.slice(0, -'.quaternion'.length)));
  const targets = list.filter((bone) => animated.has(counterpart(bone.name)));
  const pelvis = bones.get('pelvis');
  const movesPelvis = !!pelvis && clip.tracks.some((t) => t.name === 'pelvis.position');

  const sampler = new THREE.AnimationMixer(root);
  const action = sampler.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const count = Math.max(2, Math.ceil(clip.duration * MIRROR_SAMPLES_PER_SECOND) + 1);
  const times = new Float32Array(count);
  const rotations = new Map(targets.map((bone) => [bone.name, new Float32Array(count * 4)]));
  const pelvisPositions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    times[i] = Math.min(clip.duration, i / MIRROR_SAMPLES_PER_SECOND);
    action.time = times[i];
    sampler.update(0);
    root.updateMatrixWorld(true);
    const mirrored = new Map<string, THREE.Quaternion>();
    for (const bone of list) {
      const source = bones.get(counterpart(bone.name)) ?? bone;
      const delta = inBody(source).multiply(restInBody.get(source.name)!.clone().invert());
      // Reflection across x = 0: the rotation axis (a pseudovector) keeps x and flips y and z.
      mirrored.set(bone.name, new THREE.Quaternion(delta.x, -delta.y, -delta.z, delta.w).multiply(restInBody.get(bone.name)!));
    }
    for (const bone of targets) {
      const parent = bone.parent!;
      const parentInBody = (parent as THREE.Bone).isBone ? mirrored.get(parent.name)! : inBody(parent);
      parentInBody.clone().invert().multiply(mirrored.get(bone.name)!).toArray(rotations.get(bone.name)!, i * 4);
    }
    if (movesPelvis) {
      const position = root.worldToLocal(pelvis!.getWorldPosition(new THREE.Vector3()));
      position.x = -position.x;
      pelvis!.parent!.worldToLocal(root.localToWorld(position)).toArray(pelvisPositions, i * 3);
    }
  }
  sampler.stopAllAction();
  sampler.uncacheRoot(root);
  list.forEach((bone, i) => { bone.quaternion.copy(rest[i][0]); bone.position.copy(rest[i][1]); });
  root.updateMatrixWorld(true);

  const tracks: THREE.KeyframeTrack[] = targets.map((bone) => new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, rotations.get(bone.name)!));
  if (movesPelvis) tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, pelvisPositions));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

interface BowDrawParts {
  item: THREE.Object3D;
  /** Middle of the resting string, in bow space. */
  nock: THREE.Vector3;
  arrow: THREE.Object3D;
  restString(): void;
  /** Bends the string into two straight segments meeting at `to` (bow space). */
  bendString(to: THREE.Vector3): void;
  placeArrow(nock: THREE.Vector3): void;
}

const worldPosition = (object: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);

/** Rotates `bone` so the direction to `child` points at `target` (world space), blended by `weight`. */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3, weight: number): void {
  const origin = worldPosition(bone);
  const from = worldPosition(child).sub(origin).normalize();
  const to = target.clone().sub(origin).normalize();
  const world = new THREE.Quaternion().setFromUnitVectors(from, to).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  orientBone(bone, world, weight);
}

/** Sets a bone's world rotation (blended with its animated one by `weight`). */
function orientBone(bone: THREE.Object3D, world: THREE.Quaternion, weight: number): void {
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.slerp(parent.invert().multiply(world), weight);
  bone.updateMatrixWorld(true);
}

/** Two-bone IK on an arm: hand to `target`, elbow bent towards `pole` (world points). */
function twoBoneIk(bones: Map<string, THREE.Bone>, side: string, target: THREE.Vector3, pole: THREE.Vector3, weight: number): void {
  if (weight <= 0) return;
  const upper = bones.get(`upperarm_${side}`)!, lower = bones.get(`lowerarm_${side}`)!, hand = bones.get(`hand_${side}`)!;
  upper.updateMatrixWorld(true);
  const shoulder = worldPosition(upper);
  const a = shoulder.distanceTo(worldPosition(lower));
  const b = worldPosition(lower).distanceTo(worldPosition(hand));
  const toTarget = target.clone().sub(shoulder);
  const d = Math.min(Math.max(toTarget.length(), 1e-4), (a + b) * 0.999);
  const dir = toTarget.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const bend = pole.clone().sub(shoulder);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-10) bend.set(0, -1, 0).addScaledVector(dir, -dir.y);
  bend.normalize();
  const elbow = shoulder.clone().addScaledVector(dir, a * cosA).addScaledVector(bend, a * sinA);
  aimBone(upper, lower, elbow, weight);
  aimBone(lower, hand, shoulder.clone().addScaledVector(dir, d), weight);
}

/** Arrow with its nock at the origin, pointing along +Y. */
function buildArrow(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'bow:arrow';
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.8, flatShading: true });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.7, roughness: 0.35, flatShading: true });
  const feather = new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.9, side: THREE.DoubleSide });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.72, 5), wood);
  shaft.position.y = 0.36;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.045, 4), steel);
  head.position.y = 0.742;
  group.add(shaft, head);
  for (let i = 0; i < 3; i++) {
    const vane = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.07), feather);
    vane.position.y = 0.06;
    vane.rotation.y = (i * Math.PI * 2) / 3;
    vane.translateX(0.009);
    group.add(vane);
  }
  group.traverse((child) => { child.frustumCulled = false; });
  return group;
}

/** Closed-fist frame of one hand, from its finger bones in the current pose, in hand-bone space. */
function measureFist(bones: Map<string, THREE.Bone>, side: 'r' | 'l'): Fist {
  const hand = bones.get(`hand_${side}`)!;
  const local = (name: string) => hand.worldToLocal(new THREE.Vector3().setFromMatrixPosition(bones.get(`${name}_${side}`)!.matrixWorld));
  const average = (names: string[]) => names.map(local).reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(names.length);
  const knuckles = average(FINGERS.map((f) => `${f}_01`));
  const tips = average(FINGERS.map((f) => `${f}_03`));
  const along = knuckles.clone().normalize();
  const lateral = local('index_01').sub(local('pinky_01'));
  lateral.addScaledVector(along, -lateral.dot(along)).normalize();
  const palm = tips.clone().sub(knuckles);
  palm.addScaledVector(along, -palm.dot(along)).addScaledVector(lateral, -palm.dot(lateral)).normalize();
  return { centre: knuckles.clone().add(tips).multiplyScalar(0.5), lateral, along, palm };
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
