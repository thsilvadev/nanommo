/**
 * three.js character rig: loads the body for a sex, applies the appearance
 * (deformations, recomposed skin texture, hair, piercings), attaches hand items
 * to the hand bones and plays the Idle clip.
 *
 * Loaded on demand by CharacterViewerComponent, so three.js stays out of the
 * initial bundle.
 */
import * as THREE from 'three';
import type { AppearanceCatalog, AppearanceOption, AppearanceTrait, HandWeaponType, RefineGlint, Sex } from '@nanommo/shared';
import type { AnimationSource, CharacterRigHandle, CharacterRigOptions, ViewerConfig, ViewerFraming } from './character-viewer.types';
import { CLIP_SECONDS, type AnimationState } from '../character-animation/animation-state';
import { bakeDecal, hexToRgb, sampleColor, tintSkinPixels, type Decal, type Vec3 } from './skin-compositor';
import { BASE_CLIPS, HIT_CLIPS, MIRRORED_CLIPS, OVERLAY_CLIPS, SKIN_TEXTURE_SIZE, type BodyAsset } from './body-asset';
import { CharacterAssetCache } from './character-asset-cache';
import { gripMatrix } from './grip';
import { BowShotState, poseBowShot } from './bow-shot';
import { visibleBodyGeometry } from './gear-regions';
import { gearMaterial, gearMesh, mergedGearGeometry, planBands, planGear, type GearPlan } from './gear-merge';
import type { LoadedGear } from './gear-manifest';

/** Height of each body as modelled, in cm (assets report, Task 0). */
export const NATIVE_HEIGHT_CM: Record<Sex, number> = { male: 181, female: 177 };
const FADE_IN_SECONDS = 0.12;
const FADE_OUT_SECONDS = 0.2;
/** Peak weight of a flinch: enough to read as a hit, not enough to cut the action under it. */
const HIT_PEAK = 0.4;
const HAND_BONES = { right: 'hand_r', left: 'hand_l' } as const;


const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const vec = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

function option(catalog: AppearanceCatalog, sex: Sex, trait: AppearanceTrait, index: number): AppearanceOption {
  const list = catalog[sex][trait];
  return list[Math.max(0, Math.min(list.length - 1, index))];
}
const param = (o: AppearanceOption, key: string) => Number(o.params?.[key] ?? 0);

const PROCEDURAL_WEAPONS = new Set<HandWeaponType>(['staff', 'rod', 'rune']);

function disposeMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) material.dispose();
  });
}

/** The per-instance part of a body: Body/Brows geometry and material, and its skin texture. */
function disposeBodyInstance(body: BodyAsset): void {
  for (const mesh of [body.body, body.brows]) {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  body.skinTexture.dispose();
}

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
  private readonly bowShot = new BowShotState();
  private lastBowDrawn = 0;
  private animation: AnimationSource = { base: 'Idle' };
  private animationClock: () => number = Date.now;
  private readonly bodies = new Map<Sex, Promise<BodyAsset>>();
  /** Raw files are shared with every other rig and the town scene; this rig owns only its instances. */
  private readonly assets: CharacterAssetCache;
  /** Hand items by type (creator) or by gear visual id. */
  private readonly weapons = new Map<string, THREE.Object3D>();
  /** The body that wears the current Gear mesh (it may be the other sex's body). */
  private gearHolder: BodyAsset | null = null;
  private readonly hairs = new Map<string, THREE.Object3D>();
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
    this.assets = (options.cache as CharacterAssetCache | undefined) ?? new CharacterAssetCache(options.load, options.assetBase);
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
  clipNames(): string[] { return this.current ? [...this.current.actions.keys()] : []; }
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
  gearVertexCount(): number {
    const gear = this.current?.body.parent?.getObjectByName('Gear') as THREE.SkinnedMesh | undefined;
    return gear ? gear.geometry.getAttribute('position').count : 0;
  }
  bodyTriangles(): number { return this.current ? (this.current.body.geometry.getIndex()?.count ?? 0) / 3 : 0; }
  hairVisible(): boolean {
    const head = this.current?.bones.get('Head');
    return !!head?.children.some((c) => c.name.startsWith('hair:') && c.visible);
  }
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
    // Gear failing to load leaves the character bare (with type models in hand), never broken.
    const gear: LoadedGear | null = config.equipment ? await this.assets.gear().catch(() => null) : null;
    const plan = gear && config.equipment ? planGear(gear, config.equipment, () => undefined, config.dominantHand, config.refinement) : null;
    const visualIn = (side: 'right' | 'left') => plan?.weapons.find((w) => w.side === side)?.visual ?? null;
    const glintIn = (side: 'right' | 'left') => plan?.weapons.find((w) => w.side === side)?.glint ?? 0;
    const [hairObject, beardObject, skinImages, weaponObjects] = await Promise.all([
      hair.asset ? this.loadGlb(hair.asset) : Promise.resolve(null),
      facial.asset?.endsWith('.glb') ? this.loadGlb(facial.asset) : Promise.resolve(null),
      this.loadSkinImages([pick('mouthDetails'), facial, pick('tattoo')]),
      Promise.all((['right', 'left'] as const).map((side) => (config.hands[side] ? this.loadWeapon(config.hands[side]!, gear, visualIn(side), glintIn(side)) : null))),
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
    this.wearGear(body, config.sex, gear, plan);

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

  private loadGlb(asset: string): Promise<THREE.Object3D> {
    return this.assets.glb(asset);
  }

  private async loadSkinImages(options: AppearanceOption[]): Promise<Map<string, ImageBitmap>> {
    const assets = options.map((o) => o.asset).filter((a): a is string => !!a && a.endsWith('.png'));
    if (options.some((o) => o.asset?.startsWith('face/mouth_'))) assets.push('face/mouth_cover.png');
    const images = await Promise.all(assets.map((asset) => this.assets.image(asset)));
    return new Map(assets.map((asset, i) => [asset, images[i]]));
  }

  /** This rig's own body instance per sex (a fresh one from the shared files). */
  private loadBody(sex: Sex): Promise<BodyAsset> {
    let pending = this.bodies.get(sex);
    if (!pending) {
      pending = this.assets.body(sex);
      pending.catch(() => this.bodies.delete(sex));
      this.bodies.set(sex, pending);
    }
    return pending;
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

  private async loadWeapon(type: HandWeaponType, gear: LoadedGear | null = null, visual: string | null = null, glint: RefineGlint = 0): Promise<THREE.Object3D> {
    const source = visual ? gear?.rigid.get(visual) : undefined;
    const key = source ? (glint ? `${visual}+${glint}` : visual!) : type;
    let weapon = this.weapons.get(key);
    if (weapon) return weapon;
    if (source && gear) {
      // the item's own model, textured by the gear atlas (shared material; geometry shared with the cache)
      weapon = source.clone(true);
      weapon.position.set(0, 0, 0); weapon.quaternion.identity(); weapon.scale.set(1, 1, 1);
      weapon.traverse((child) => { if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = gearMaterial(gear, glint); });
    } else if (type === 'staff' || type === 'rod' || type === 'rune') {
      weapon = buildProceduralWeapon(type);
    } else {
      weapon = (await this.loadGlb(`weapons/${type}.glb`)).clone(true);
    }
    weapon.traverse((child) => { child.frustumCulled = false; });
    weapon.name = `weapon:${key}`;
    this.weapons.set(key, weapon);
    return weapon;
  }

  /**
   * Puts the gear on: the covered body is left out of the body's index, the worn pieces are one
   * Gear mesh on this body's skeleton (shared geometry/material: never disposed here), hair and
   * beard hide under helmets and hoods. No plan: the bare body.
   */
  private wearGear(body: BodyAsset, sex: Sex, gear: LoadedGear | null, plan: GearPlan | null): void {
    for (const holder of new Set([this.gearHolder, body])) {
      const old = holder?.body.parent?.getObjectByName('Gear');
      if (old) old.parent!.remove(old);
    }
    this.gearHolder = body;
    body.body.geometry = plan && gear
      ? visibleBodyGeometry(sex, body.body, plan.covered, planBands(gear, plan, sex))
      : visibleBodyGeometry(sex, body.body, new Set(), []);
    const geometry = plan && gear ? mergedGearGeometry(gear, sex, body, plan, { includeWeapons: false }) : null;
    if (geometry && gear) body.body.parent!.add(gearMesh(geometry, gear, body.body.skeleton, body.body.bindMatrix));
    const head = body.bones.get('Head')!;
    for (const child of head.children) {
      if (child.name.startsWith('hair:')) child.visible = !plan?.hidesHair;
      if (child.name.startsWith('beard:')) child.visible = !plan?.hidesBeard;
    }
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
      gripMatrix(body.fists[side], type).decompose(item.position, item.quaternion, item.scale);
      if (type === 'bow') this.bow = { side, item };
    });
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
    this.bowShot.restore();
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

  /** Draw and loose over the animated arms (see bow-shot.ts); returns how far the string is drawn. */
  private poseBowShot(body: BodyAsset, progress: number | null): number {
    return poseBowShot(this.bowShot, body.bones, body.root, this.bow, progress);
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
    // Only what this rig owns: its body instances (own geometry, material and skin), the
    // cloned hair materials and procedural weapons. Shared raw files stay in the cache.
    for (const pending of this.bodies.values()) {
      pending.then((body) => { body.mixer.stopAllAction(); disposeBodyInstance(body); }, () => undefined);
    }
    for (const [key, weapon] of this.weapons) if (PROCEDURAL_WEAPONS.has(key as HandWeaponType)) disposeObject(weapon);
    for (const hair of this.hairs.values()) disposeMaterials(hair);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
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
