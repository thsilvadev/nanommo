/** Perf gate page: N real TownCharacters (town code path), bare or fully equipped; measures frames and draw calls. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CharacterAssetCache } from '../../../apps/frontend/src/app/shared/character-viewer/character-asset-cache';
import { TownCharacter, TownCharacterFactory } from '../../../apps/frontend/src/app/features/play/town-scene/town-character';

const W = 1280, H = 720;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('host')!.appendChild(renderer.domElement);
const loader = new GLTFLoader();
const cache = CharacterAssetCache.shared('/assets/character/', (url) => loader.loadAsync(url));
let factory: TownCharacterFactory | null = null;

const SETS = [
  { head: 'equip_head_phys_t3', body: 'equip_body_phys_t3', cape: 'equip_cape_phys_t3', shoes: 'equip_shoes_holy_t4', mainHand: 'equip_sword_t3', offHand: 'equip_shield_t3' },
  { head: 'equip_head_magic_t3', body: 'equip_body_magic_t3', cape: 'equip_cape_magic_t3', shoes: 'equip_shoes_shadow_t3', mainHand: 'equip_staff_t3' },
  { head: 'equip_head_phys_t2', body: 'equip_body_phys_t2', cape: 'equip_cape_phys_t2', shoes: 'equip_shoes_fire_t3', mainHand: 'equip_greatsword_t2' },
  { head: 'equip_head_magic_t2', body: 'equip_body_magic_t2', cape: 'equip_cape_magic_t2', shoes: 'equip_shoes_water_t2', mainHand: 'equip_rod_t3', offHand: 'equip_rune_t3' },
];

(window as any).run = async ({ count, equipped, frames }: { count: number; equipped: boolean; frames: number }) => {
  if (!factory) factory = new TownCharacterFactory(cache, await (await fetch('/data/appearance_catalog.json')).json());
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#3a332d');
  scene.add(new THREE.HemisphereLight('#ffffff', '#554433', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(5, 10, 6); scene.add(sun);
  const chars: TownCharacter[] = [];
  for (let i = 0; i < count; i++) {
    const sex = i % 2 ? 'female' : 'male';
    const entry = {
      characterId: `c${i}`, name: `C${i}`, level: 50, sex, heightCm: sex === 'male' ? 181 : 170, seed: i, online: true, sleeping: null, wakeFrom: null,
      lastSeenAt: new Date(0).toISOString(), dominantHand: i % 7 ? 'right' : 'left',
      appearance: { v: 1, hair: 1 + (i % 4), hairColor: i % 5, skin: i % 4, face: 0, nose: i % 3, mouth: 0, mouthDetails: 0, chest: 1, facialHair: sex === 'male' ? i % 3 : 0, piercing: 0, tattoo: 0 },
      equipment: equipped ? SETS[i % SETS.length] : {},
    } as any;
    const c = new TownCharacter(factory, entry);
    chars.push(c);
    scene.add(c.object3d);
  }
  await Promise.all(chars.map(async (c) => { await c.ready; await c.gearReady(); }));
  const cols = 20;
  const pose = (i: number) => ({ x: ((i % cols) - cols / 2) * 1.3, z: (Math.floor(i / cols) - count / cols / 2) * 1.6, facing: 0.6, state: 'idle' as const });
  const cam = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
  cam.position.set(0, 13, 20); cam.lookAt(0, 0.5, 0);
  const gl = renderer.getContext();
  const times: number[] = [];
  let now = 1_000_000;
  for (let f = 0; f < frames + 20; f++) {
    const t0 = performance.now();
    chars.forEach((c, i) => c.update(pose(i), 16, 'full', now));
    renderer.render(scene, cam);
    gl.finish();
    if (f >= 20) times.push(performance.now() - t0);
    now += 16;
  }
  const calls = renderer.info.render.calls, triangles = renderer.info.render.triangles;
  times.sort((a, b) => a - b);
  const shot = renderer.domElement.toDataURL('image/png');
  chars.forEach((c) => c.dispose());
  return { calls, triangles, medianMs: times[Math.floor(times.length / 2)], shot };
};
