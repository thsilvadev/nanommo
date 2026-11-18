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

  dispose(): void {
    for (const m of this.hairMaterials.values()) m.dispose();
    this.hairMaterials.clear();
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
  private lowAccumMs = 0;
  private readonly owned: Array<{ dispose(): void }> = [];
  private disposed = false;
  entry: TownRosterEntry;

  constructor(private readonly factory: TownCharacterFactory, entry: TownRosterEntry, readonly opts: { npc?: boolean; self?: boolean } = {}) {
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
  /** Name of the clip currently playing (null until loaded). */
  animation(): TownClip | null { return this.current; }

  setEntry(entry: TownRosterEntry): void {
    this.entry = entry;
    this.updatePlate();
  }

  update(pose: TownPose, dtMs: number, lod: TownLod): void {
    this.object3d.position.set(pose.x, 0, pose.z);
    this.model.rotation.y = pose.facing;
    if (this.plate) this.plate.visible = lod === 'full';
    if (!this.mixer) return;
    const clip: TownClip = pose.state === 'sleep' ? 'Dead' : pose.state === 'walk' ? 'Walk' : 'Idle';
    if (clip !== this.current) this.play(clip);
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
    const entry = this.entry;
    const sex: Sex = entry.sex ?? 'male';
    const appearance = entry.appearance ?? ({ v: 1 } as CharacterAppearance);
    const f = this.factory;
    const template = await f.template(sex);
    const skinOption = f.option(sex, appearance, 'skin');
    const hairOption = f.option(sex, appearance, 'hair');
    const facialOption = f.option(sex, appearance, 'facialHair');
    const hairColor = new THREE.Color().setStyle(f.option(sex, appearance, 'hairColor').color ?? '#3a2a20').multiplyScalar(1.6);
    const [skin, hair, beard] = await Promise.all([
      f.skin(sex, template, skinOption),
      hairOption.asset ? f.hair(hairOption.asset, hairColor) : Promise.resolve(null),
      facialOption.asset?.endsWith('.glb') ? f.hair(facialOption.asset, hairColor) : Promise.resolve(null),
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
    if (idle) idle.time = (Math.abs(mulberry32Seed(entry.characterId)) % 1000) / 1000 * idle.getClip().duration;
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
