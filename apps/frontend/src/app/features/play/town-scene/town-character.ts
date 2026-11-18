/**
 * One character (player or NPC) inside the shared town scene.
 *
 * Cheap on purpose (the town renders up to 100): every instance is a
 * SkeletonUtils clone of one prepared template body per sex, sharing its
 * geometry (no per-face deformation, invisible from the town camera), with its
 * own material, a small skin texture shared per skin tone, hair, and an
 * AnimationMixer playing Idle / Walk / Dead.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Mulberry32, mulberry32Seed } from '@nanommo/shared';
import type { AppearanceCatalog, AppearanceOption, AppearanceTrait, CharacterAppearance, Sex, TownPose, TownRosterEntry } from '@nanommo/shared';
import { APPEARANCE_TRAITS } from '@nanommo/shared';
import type { BodyAsset } from '../../../shared/character-viewer/body-asset';
import type { CharacterAssetCache } from '../../../shared/character-viewer/character-asset-cache';
import { hexToRgb, tintSkinPixels } from '../../../shared/character-viewer/skin-compositor';
import { dressCostume, npcOutfitAsset, type NpcFigure, type NpcFigureBody } from './npc-visuals';

/** Characters cast shadows from the main light; first thing to switch off if the town drops frames. */
export const TOWN_CHARACTER_SHADOWS = true;
export const TOWN_SKIN_SIZE = 256;
const NATIVE_HEIGHT_CM: Record<Sex, number> = { male: 181, female: 177 };
const CLIPS = ['Idle', 'Walk', 'Dead'] as const;
type TownClip = typeof CLIPS[number];
const FADE_SECONDS = 0.25;
const LOW_LOD_STEP_MS = 100; // 10 Hz
const PLATE_HEIGHT = 2.15;

export type TownLod = 'full' | 'low';
export interface TownPickInfo { kind: 'npc' | 'character'; id: string }

let hitGeometry: THREE.BoxGeometry | null = null;
let hitMaterial: THREE.MeshBasicMaterial | null = null;
let ringGeometry: THREE.RingGeometry | null = null;
let ringMaterial: THREE.MeshBasicMaterial | null = null;

/** Shared per-scene building blocks: one template body per sex, skins, hair. */
export class TownCharacterFactory {
  private readonly templates = new Map<Sex, Promise<BodyAsset>>();
  private readonly hairMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly heads = new Map<string, THREE.BufferGeometry>();

  constructor(readonly cache: CharacterAssetCache, readonly catalog: AppearanceCatalog) {}

  template(sex: Sex): Promise<BodyAsset> {
    let pending = this.templates.get(sex);
    if (!pending) {
      pending = this.cache.body(sex);
      pending.catch(() => this.templates.delete(sex));
      this.templates.set(sex, pending);
    }
    return pending;
  }

  option(sex: Sex, appearance: CharacterAppearance, trait: AppearanceTrait): AppearanceOption {
    const list = this.catalog[sex][trait];
    return list[Math.max(0, Math.min(list.length - 1, Number(appearance[trait]) || 0))];
  }

  /** Skin tone over the template's base skin, at town resolution, once per (sex, tone). */
  skin(sex: Sex, template: BodyAsset, skin: AppearanceOption): Promise<THREE.Texture> {
    return this.cache.skinTexture(`town:${sex}:${skin.id}`, () => {
      const base = template.baseSkin;
      const tinted = new ImageData(base.width, base.height);
      tintSkinPixels(base.data, tinted.data, template.skinReference, hexToRgb(skin.color ?? '#d9a37a'));
      const full = document.createElement('canvas');
      full.width = base.width; full.height = base.height;
      full.getContext('2d')!.putImageData(tinted, 0, 0);
      const small = document.createElement('canvas');
      small.width = small.height = TOWN_SKIN_SIZE;
      small.getContext('2d')!.drawImage(full, 0, 0, TOWN_SKIN_SIZE, TOWN_SKIN_SIZE);
      const texture = new THREE.CanvasTexture(small);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    });
  }

  /** Hair/beard model attached in Head-bone space (as the asset pipeline builds it). */
  async hair(asset: string, color: THREE.Color): Promise<THREE.Object3D> {
    const source = await this.cache.glb(asset);
    const object = source.clone(true);
    const key = `${asset}|${color.getHexString()}`;
    let material = this.hairMaterials.get(key);
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!material) {
        material = (mesh.material as THREE.MeshStandardMaterial).clone();
        material.side = THREE.DoubleSide;
        material.color.copy(color);
        this.hairMaterials.set(key, material);
      }
      mesh.material = material;
      mesh.frustumCulled = false;
      mesh.castShadow = TOWN_CHARACTER_SHADOWS;
    });
    return object;
  }

  /** Fixed look for an NPC, derived from its id (same on every client). */
  npcEntry(npcId: string, name: string): TownRosterEntry {
    const rng = new Mulberry32(mulberry32Seed(`npc:${npcId}`));
    const sex: Sex = rng.next() < 0.5 ? 'male' : 'female';
    const appearance = { v: 1 } as CharacterAppearance;
    for (const trait of APPEARANCE_TRAITS) appearance[trait] = Math.floor(rng.next() * Math.max(1, this.catalog[sex][trait].length));
    return {
      characterId: npcId, name, level: 0, appearance, sex, heightCm: 165 + Math.floor(rng.next() * 25),
      seed: 0, online: true, sleeping: null, wakeFrom: null, lastSeenAt: '',
    };
  }

  /**
   * The body reduced to the triangles driven by the head and neck: a dressed NPC
   * wears an outfit over everything else (the outfit pack asks for the head only,
   * the rest of the body would poke through the cloth).
   */
  headOnly(sex: Sex, body: THREE.SkinnedMesh): THREE.BufferGeometry {
    let head = this.heads.get(sex);
    if (!head) {
      const source = body.geometry;
      const keep = new Set(body.skeleton.bones.map((b, i) => (b.name === 'Head' || b.name === 'neck_01' ? i : -1)).filter((i) => i >= 0));
      const joints = source.getAttribute('skinIndex');
      const weights = source.getAttribute('skinWeight');
      const dominant = (v: number) => {
        let best = 0;
        for (let k = 1; k < 4; k++) if (weights.getComponent(v, k) > weights.getComponent(v, best)) best = k;
        return joints.getComponent(v, best);
      };
      const index = source.getIndex();
      const count = index ? index.count : source.getAttribute('position').count;
      const vertex = (i: number) => (index ? index.getX(i) : i);
      const kept: number[] = [];
      for (let i = 0; i < count; i += 3) {
        const tri = [vertex(i), vertex(i + 1), vertex(i + 2)];
        if (tri.every((v) => keep.has(dominant(v)))) kept.push(...tri);
      }
      head = source.clone();
      head.setIndex(kept);
      this.heads.set(sex, head);
    }
    return head;
  }

  dispose(): void {
    for (const m of this.hairMaterials.values()) m.dispose();
    this.hairMaterials.clear();
    for (const g of this.heads.values()) g.dispose();
    this.heads.clear();
  }
}

export class TownCharacter {
  readonly object3d = new THREE.Group();
  readonly ready: Promise<void>;
  private readonly model = new THREE.Group();
  private readonly hitbox: THREE.Mesh;
  private plate: THREE.Sprite | null = null;
  private plateKey = '';
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<TownClip, THREE.AnimationAction>();
  private current: TownClip | null = null;
  private frozen = false;
  /** Clock of the first update this character received (null until then). */
  private firstSeenAt: number | null = null;
  private lowAccumMs = 0;
  private readonly owned: Array<{ dispose(): void }> = [];
  private disposed = false;
  entry: TownRosterEntry;
  /** Height the character stands at (NPCs up on a balcony); the click box rises with it. */
  elevation = 0;

  private isDressed = false;

  constructor(private readonly factory: TownCharacterFactory, entry: TownRosterEntry, readonly opts: { npc?: boolean; self?: boolean; visual?: NpcFigure } = {}) {
    this.entry = entry;
    const pick: TownPickInfo = { kind: opts.npc ? 'npc' : 'character', id: entry.characterId };
    this.object3d.name = `${pick.kind}:${pick.id}`;
    hitGeometry ??= new THREE.BoxGeometry(0.9, 1.9, 0.9);
    hitMaterial ??= new THREE.MeshBasicMaterial({ visible: false });
    this.hitbox = new THREE.Mesh(hitGeometry, hitMaterial);
    this.hitbox.position.y = 0.95;
    this.hitbox.userData['pick'] = pick;
    this.object3d.add(this.model, this.hitbox);
    if (opts.self) {
      ringGeometry ??= new THREE.RingGeometry(0.45, 0.62, 32);
      ringMaterial ??= new THREE.MeshBasicMaterial({ color: '#ffd36a', transparent: true, opacity: 0.85, depthWrite: false, fog: false });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      this.object3d.add(ring);
    }
    this.updatePlate();
    this.ready = this.build();
  }

  get hitObject(): THREE.Object3D { return this.hitbox; }
  /** True once an NPC wears its own visual (outfit and costume, or nothing for a prop-only NPC). */
  dressed(): boolean { return this.isDressed; }

  /** Name of the clip currently playing (null until loaded). */
  animation(): TownClip | null { return this.current; }

  /** How far the fall into sleep has played (0..1); null when not asleep. */
  deadProgress(): number | null {
    const dead = this.actions.get('Dead');
    if (this.current !== 'Dead' || !dead) return null;
    const duration = dead.getClip().duration;
    return duration > 0 ? Math.min(1, dead.time / duration) : 1;
  }

  setEntry(entry: TownRosterEntry): void {
    this.entry = entry;
    this.updatePlate();
  }

  update(pose: TownPose, dtMs: number, lod: TownLod, nowMs: number): void {
    this.object3d.position.set(pose.x, this.elevation, pose.z);
    this.model.rotation.y = pose.facing;
    if (this.plate) this.plate.visible = lod === 'full';
    this.firstSeenAt ??= nowMs;
    if (!this.mixer) return;
    const clip: TownClip = pose.state === 'sleep' ? 'Dead' : pose.state === 'walk' ? 'Walk' : 'Idle';
    if (clip !== this.current) {
      if (clip === 'Dead') this.fallAsleep(nowMs);
      else this.play(clip);
    }
    if (this.frozen) return;
    let step = dtMs;
    if (lod === 'low') {
      this.lowAccumMs += dtMs;
      if (this.lowAccumMs < LOW_LOD_STEP_MS) return;
      step = this.lowAccumMs;
    }
    this.lowAccumMs = 0;
    this.mixer.update(step / 1000);
    // Asleep: once the fall has played, hold the last frame with the mixer stopped.
    const dead = this.actions.get('Dead');
    if (this.current === 'Dead' && dead && dead.time >= dead.getClip().duration - 1e-3 && dead.getEffectiveWeight() >= 0.999) this.frozen = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer?.stopAllAction();
    this.object3d.removeFromParent();
    for (const item of this.owned) item.dispose();
  }

  /**
   * The Dead pose follows the age of the sleep, so every client agrees: someone
   * asleep for minutes is already lying on the first frame, someone who just
   * fell asleep is caught mid-fall. Only a fall that starts while this
   * character is already on screen crossfades in.
   */
  private fallAsleep(nowMs: number): void {
    const dead = this.actions.get('Dead');
    if (!dead || !this.mixer) return;
    const at = this.entry.sleeping?.at ?? nowMs;
    const duration = dead.getClip().duration;
    const time = Math.max(0, Math.min((nowMs - at) / 1000, duration));
    const snap = this.current === null || this.firstSeenAt === null || at < this.firstSeenAt;
    if (!snap) {
      this.play('Dead');
      dead.time = time;
      return;
    }
    for (const action of this.actions.values()) if (action !== dead) action.stop();
    this.frozen = false;
    dead.reset().setEffectiveWeight(1).play();
    dead.time = time;
    this.current = 'Dead';
    this.mixer.update(0); // pose the skeleton now, even on a 10 Hz (low LOD) frame
    if (time >= duration - 1e-3) this.frozen = true;
  }

  private play(clip: TownClip): void {
    const next = this.actions.get(clip);
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    this.frozen = false;
    next.reset().setEffectiveWeight(1).play();
    if (prev && prev !== next) next.crossFadeFrom(prev, FADE_SECONDS, false);
    this.current = clip;
  }

  private async build(): Promise<void> {
    if (this.opts.visual?.kind === 'none') { this.isDressed = true; return; }
    const entry = this.entry;
    const sex: Sex = entry.sex ?? 'male';
    const appearance = entry.appearance ?? ({ v: 1 } as CharacterAppearance);
    const f = this.factory;
    const template = await f.template(sex);
    const skinOption = f.option(sex, appearance, 'skin');
    const hairOption = f.option(sex, appearance, 'hair');
    const facialOption = f.option(sex, appearance, 'facialHair');
    const hairColor = new THREE.Color().setStyle(f.option(sex, appearance, 'hairColor').color ?? '#3a2a20').multiplyScalar(1.6);
    const figure = this.opts.visual?.kind === 'body' ? this.opts.visual : null;
    const [skin, hair, beard, outfit] = await Promise.all([
      f.skin(sex, template, skinOption),
      hairOption.asset ? f.hair(hairOption.asset, hairColor) : Promise.resolve(null),
      facialOption.asset?.endsWith('.glb') ? f.hair(facialOption.asset, hairColor) : Promise.resolve(null),
      figure ? f.cache.glb(npcOutfitAsset(figure.outfit)) : Promise.resolve(null),
    ]);
    if (this.disposed) return;

    const root = cloneSkinned(template.root);
    root.traverse((child) => {
      const mesh = child as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.frustumCulled = false;
      mesh.castShadow = TOWN_CHARACTER_SHADOWS;
      if (mesh.name === 'Body') {
        const material = (mesh.material as THREE.MeshStandardMaterial).clone();
        material.map = skin;
        mesh.material = material;
        this.owned.push(material);
      } else if (mesh.name === 'Brows') {
        const material = (mesh.material as THREE.MeshStandardMaterial).clone();
        material.color.copy(hairColor).multiplyScalar(0.8);
        mesh.material = material;
        this.owned.push(material);
      }
    });
    if (figure && outfit) this.wear(root, outfit, figure, skinOption.color ?? '#d9a37a');
    const head = root.getObjectByName('Head');
    if (head) for (const item of [hair, beard]) if (item) head.add(item);
    const scale = (entry.heightCm ?? NATIVE_HEIGHT_CM[sex]) / NATIVE_HEIGHT_CM[sex];
    this.model.scale.setScalar(scale);
    this.model.add(root);

    this.mixer = new THREE.AnimationMixer(root);
    for (const name of CLIPS) {
      const clip = template.clips.find(c => c.name === name);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      if (name === 'Dead') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      action.setEffectiveWeight(0);
      this.actions.set(name, action);
    }
    // Idle loops start at a per-character phase so a crowd does not breathe in sync.
    const idle = this.actions.get('Idle');
    if (figure) {
      // Costume pieces are fitted on the Idle pose, then follow their bones.
      if (idle) { idle.reset().setEffectiveWeight(1).play(); this.mixer.update(0); }
      this.object3d.updateMatrixWorld(true);
      const body = root.getObjectByName('Body') as THREE.SkinnedMesh;
      dressCostume(this.model, figure, skinOption.color ?? '#d9a37a', { skeleton: body.skeleton, face: this.faceCentre(root) });
      idle?.stop();
      this.isDressed = true;
    }
    if (idle) idle.time = (Math.abs(mulberry32Seed(entry.characterId)) % 1000) / 1000 * idle.getClip().duration;
  }

  /** Centre of the eyes in the body's bind pose (armature space). */
  private faceCentre(root: THREE.Object3D): THREE.Vector3 {
    const eyes = root.getObjectByName('Eyes') as THREE.Mesh | undefined;
    if (!eyes) return new THREE.Vector3(0, 1.68, 0.09);
    eyes.geometry.computeBoundingBox();
    return eyes.geometry.boundingBox!.getCenter(new THREE.Vector3());
  }

  /**
   * Puts the outfit on: its skinned meshes are bound to this body's bones by
   * name (same 65-bone rig), the body keeps only its head, bare skin takes the
   * NPC's skin tone and the cloth the figure's tint.
   */
  private wear(root: THREE.Object3D, outfitSource: THREE.Object3D, figure: NpcFigureBody, skinColor: string): void {
    const bones = new Map<string, THREE.Bone>();
    root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
    const body = root.getObjectByName('Body') as THREE.SkinnedMesh | undefined;
    if (!body) return;
    body.geometry = this.factory.headOnly(this.entry.sex ?? 'male', body);
    const outfit = cloneSkinned(outfitSource);
    const meshes: THREE.SkinnedMesh[] = [];
    outfit.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    const tint = new THREE.Color(figure.tint ?? '#ffffff');
    for (const mesh of meshes) {
      if (figure.costume.includes('no-hood') && /Head_Hood/.test(mesh.name)) continue;
      const skeleton = new THREE.Skeleton(mesh.skeleton.bones.map((b) => bones.get(b.name) ?? b), mesh.skeleton.boneInverses);
      const bindMatrix = mesh.bindMatrix.clone();
      body.parent!.add(mesh);
      mesh.bind(skeleton, bindMatrix);
      const recolor = (m: THREE.Material) => {
        const material = (m as THREE.MeshStandardMaterial).clone();
        material.color.set(material.name === 'Skin' ? skinColor : tint);
        this.owned.push(material);
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolor) : recolor(mesh.material);
      mesh.frustumCulled = false;
      mesh.castShadow = TOWN_CHARACTER_SHADOWS;
    }
  }

  private updatePlate(): void {
    const text = this.opts.npc ? this.entry.name : `${this.entry.name}  Lv ${this.entry.level}`;
    const key = `${text}|${this.entry.online}|${this.opts.self}`;
    if (key === this.plateKey) return;
    this.plateKey = key;
    if (this.plate) {
      this.object3d.remove(this.plate);
      (this.plate.material as THREE.SpriteMaterial).map?.dispose();
      this.plate.material.dispose();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '600 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, 256, 48);
    ctx.fillStyle = this.opts.npc ? '#ffe08a' : this.opts.self ? '#ffd36a' : this.entry.online ? '#ffffff' : '#b8b8c8';
    ctx.fillText(text, 256, 48);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false });
    this.plate = new THREE.Sprite(material);
    this.plate.scale.set(3.4, 0.64, 1);
    this.plate.position.y = PLATE_HEIGHT;
    this.plate.renderOrder = 10;
    this.object3d.add(this.plate);
    this.owned.push({ dispose: () => { texture.dispose(); material.dispose(); } });
  }
}
