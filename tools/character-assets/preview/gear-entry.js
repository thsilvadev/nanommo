// Review harness page: our body + gear visuals from gear-<sex>.glb, textured by the atlas.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const W = 240, H = 360;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('host').appendChild(renderer.domElement);
const loader = new GLTFLoader();
const cache = new Map();
const load = (u) => { if (!cache.has(u)) cache.set(u, loader.loadAsync(u)); return cache.get(u); };
let atlas = null;
const region = (name) => {
  if (name === 'Head') return 'head';
  if (name === 'neck_01') return 'neck';
  if (/^upperarm_/.test(name)) return 'upperarms';
  if (/^lowerarm_/.test(name)) return 'forearms';
  if (/^(hand|thumb|index|middle|ring|pinky)_/.test(name)) return 'hands';
  if (/^thigh_/.test(name)) return 'thighs';
  if (/^calf_/.test(name)) return 'calves';
  if (/^(foot|ball)_/.test(name)) return 'feet';
  return 'torso';
};

window.applyConfig = async (c) => {
  const manifest = await (await fetch('/gear/manifest.json')).json();
  if (!atlas) {
    atlas = await new THREE.TextureLoader().loadAsync('/gear/gear-atlas.webp');
    atlas.flipY = false; atlas.colorSpace = THREE.SRGBColorSpace;
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#3a332d');
  scene.add(new THREE.HemisphereLight('#ffffff', '#554433', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(2, 4, 3); scene.add(sun);
  const root = cloneSkinned((await load(`/assets/character/body-${c.sex}.glb`)).scene);
  scene.add(root);
  const bones = new Map(); root.traverse((o) => { if (o.isBone) bones.set(o.name, o); });
  const body = root.getObjectByName('Body');
  body.material = new THREE.MeshStandardMaterial({ color: '#d9a37a' });
  const covered = new Set(c.visuals.flatMap((v) => manifest.visuals[v]?.covers ?? []));
  const g = body.geometry, J = g.getAttribute('skinIndex'), Wt = g.getAttribute('skinWeight'), idx = g.getIndex();
  const dom = (v) => { let b = 0; for (let k = 1; k < 4; k++) if (Wt.getComponent(v, k) > Wt.getComponent(v, b)) b = k; return J.getComponent(v, b); };
  const kept = [];
  for (let i = 0; i < idx.count; i += 3) {
    const t = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    if (!t.every((v) => covered.has(region(body.skeleton.bones[dom(v)].name)))) kept.push(...t);
  }
  const ng = g.clone(); ng.setIndex(kept); body.geometry = ng;
  const gear = (await load(`/gear/gear-${c.sex}.glb`)).scene;
  const material = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.9, metalness: 0 });
  for (const v of c.visuals) {
    const src = gear.getObjectByName(v);
    if (!src) continue;
    const mesh = src.isSkinnedMesh ? src : src.children.find((x) => x.isSkinnedMesh);
    const copy = new THREE.SkinnedMesh(mesh.geometry, material);
    copy.frustumCulled = false;
    body.parent.add(copy);
    copy.bind(new THREE.Skeleton(mesh.skeleton.bones.map((b) => bones.get(b.name)), mesh.skeleton.boneInverses), body.bindMatrix);
  }
  const anims = await load('/assets/character/animations.glb');
  const mixer = new THREE.AnimationMixer(root);
  const clip = anims.animations.find((a) => a.name === (c.clip ?? 'Idle'));
  if (clip) { mixer.clipAction(clip).play(); mixer.setTime(c.t ?? 0.3); }
  root.rotation.y = ((c.yaw ?? 20) * Math.PI) / 180;
  root.updateMatrixWorld(true);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
  cam.position.set(0, 1.0, 4.4); cam.lookAt(0, 0.85, 0);
  renderer.render(scene, cam);
};
