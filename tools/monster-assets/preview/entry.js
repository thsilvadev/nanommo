import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const W = 300, H = 300;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.outputColorSpace = THREE.SRGBColorSpace; document.body.appendChild(renderer.domElement);
const loader = new GLTFLoader();
const load = (u) => new Promise((ok, ko) => loader.load(u, ok, undefined, ko));
let charGltf, anims;
async function character() {
  if (!charGltf) { charGltf = await load('/assets/character/body-male.glb'); anims = (await load('/assets/character/animations.glb')).animations; }
  return charGltf;
}
function pose(root, clips, name, frac) {
  if (name === 'Rest') return 'rest';
  const clip = clips.find((c) => c.name === name) ?? clips.find((c) => c.name === 'Idle');
  if (!clip) return 'none';
  const mixer = new THREE.AnimationMixer(root); const a = mixer.clipAction(clip); a.play(); a.clampWhenFinished = true; a.setLoop(THREE.LoopOnce);
  mixer.update(Math.max(0, Math.min(clip.duration - 1e-3, frac * clip.duration))); root.updateMatrixWorld(true);
  return clip.name;
}
window.shot = async ({ id, file, rig, clip, frac, yaw = 30, W: w = 300 }) => {
  renderer.setSize(w, w);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#2b2420');
  scene.add(new THREE.HemisphereLight('#ffffff', '#554433', 2.2)); const d = new THREE.DirectionalLight('#ffffff', 2); d.position.set(3, 6, 5); scene.add(d);
  const g = await load(`/assets/monsters/${file}?v=${Date.now()}`); const m = g.scene;
  const used = pose(m, rig === 'character' ? anims ?? (await character(), anims) : g.animations, clip, frac);
  scene.add(m);
  const box = new THREE.Box3().setFromObject(m); const size = box.getSize(new THREE.Vector3());
  const c = (await character()).scene; pose(c, anims, 'Idle', 0.3);
  c.position.set(box.min.x - 0.6, 0, 0); scene.add(c);
  scene.add(new THREE.GridHelper(10, 10, '#665544', '#443322'));
  const span = Math.max(size.y, 1.9, (box.max.x - box.min.x + 1.2) * 0.8) * 1.25;
  const cx = (box.max.x + box.min.x - 1.2) / 2;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  const dist = span / (2 * Math.tan((15 * Math.PI) / 180));
  const yr = (yaw * Math.PI) / 180;
  cam.position.set(cx + Math.sin(yr) * dist, span * 0.45 + 0.5, Math.cos(yr) * dist); cam.lookAt(cx, span * 0.4, 0);
  renderer.render(scene, cam);
  scene.remove(c);
  return { url: renderer.domElement.toDataURL('image/png'), used, size: size.toArray().map((v) => +v.toFixed(2)) };
};
window.ready = true;
