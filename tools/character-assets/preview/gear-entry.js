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
  if (c.icon) {
    // icon render: the piece alone, transparent background, orthographic, flat-ish light
    const S = 512;
    renderer.setSize(S, S);
    renderer.setClearColor(0x000000, 0);
    const scene2 = new THREE.Scene();
    scene2.add(new THREE.AmbientLight('#ffffff', 1.6));
    const key = new THREE.DirectionalLight('#ffffff', 1.6); key.position.set(-2, 3, 4); scene2.add(key);
    const group = new THREE.Group();
    const info = manifest.visuals[c.icon];
    const mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const onBody = info.kind === 'skinned' || info.slot === 'head';
    if (!onBody) {
      const piece = (await load('/gear/gear-rigid.glb')).scene.getObjectByName(c.icon);
      piece.traverse((o) => { if (o.isMesh) { const m = new THREE.Mesh(o.geometry, mat); o.updateWorldMatrix(true, false); m.applyMatrix4(o.matrixWorld); group.add(m); } });
    } else {
      // on the body in Idle; the body is hidden, except the head (near-black, like the old icons' faces) for head pieces
      const root = cloneSkinned((await load(`/assets/character/body-male.glb`)).scene);
      const bones = new Map(); root.traverse((o) => { if (o.isBone) bones.set(o.name, o); });
      const body = root.getObjectByName('Body');
      for (const name of ['Brows', 'Eyes']) { const o = root.getObjectByName(name); if (o) o.visible = false; }
      if (info.slot === 'head') {
        const g = body.geometry, J = g.getAttribute('skinIndex'), Wt = g.getAttribute('skinWeight'), idx = g.getIndex();
        const head = body.skeleton.bones.findIndex((b) => b.name === 'Head');
        const dom = (v) => { let b = 0; for (let k = 1; k < 4; k++) if (Wt.getComponent(v, k) > Wt.getComponent(v, b)) b = k; return J.getComponent(v, b); };
        const kept = []; for (let i = 0; i < idx.count; i += 3) { const t = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)]; if (t.every((v) => dom(v) === head)) kept.push(...t); }
        const ng = g.clone(); ng.setIndex(kept); body.geometry = ng;
        body.material = new THREE.MeshBasicMaterial({ color: '#14111a' });
      } else body.visible = false;
      if (info.kind === 'rigid') {
        const piece = (await load('/gear/gear-rigid.glb')).scene.getObjectByName(c.icon);
        const m = new THREE.Mesh((piece.isMesh ? piece : piece.children[0]).geometry, mat);
        m.matrixAutoUpdate = false; m.matrix.fromArray(info.transform.male);
        bones.get(info.bone).add(m);
      } else {
        const src = (await load('/gear/gear-male.glb')).scene.getObjectByName(c.icon);
        const mesh = src.isSkinnedMesh ? src : src.children.find((x) => x.isSkinnedMesh);
        const copy = new THREE.SkinnedMesh(mesh.geometry, mat); copy.frustumCulled = false;
        body.parent.add(copy);
        copy.bind(new THREE.Skeleton(mesh.skeleton.bones.map((b) => bones.get(b.name)), mesh.skeleton.boneInverses), body.bindMatrix);
      }
      const anims = await load('/assets/character/animations.glb');
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(anims.animations.find((a) => a.name === 'Idle')).play(); mixer.setTime(0.1);
      root.updateMatrixWorld(true);
      group.add(root);
    }
    group.rotation.set(((c.tilt ?? 0) * Math.PI) / 180, ((c.yaw ?? 0) * Math.PI) / 180, 0);
    const holder = new THREE.Group(); holder.add(group); holder.rotation.z = ((c.roll ?? 0) * Math.PI) / 180;
    scene2.add(holder);
    holder.updateMatrixWorld(true);
    holder.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.update(); });
    // fit: box of the actual (skinned) geometry
    const box = new THREE.Box3();
    holder.traverse((o) => { if (o.isSkinnedMesh && o.visible) { const p = new THREE.Vector3(); const idx = o.geometry.getIndex(); const used = idx ? new Set(idx.array) : null; const pos = o.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) { if (used && !used.has(i)) continue; o.getVertexPosition(i, p); box.expandByPoint(p.applyMatrix4(o.matrixWorld)); } } else if (o.isMesh && o.visible) box.expandByObject(o); });
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const half = Math.max(size.x, size.y) / 2 / (c.fill ?? 0.84);
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 100);
    cam.position.set(centre.x, centre.y, centre.z + 10); cam.lookAt(centre);
    renderer.render(scene2, cam);
    return renderer.domElement.toDataURL('image/png');
  }
  if (c.weapon) {
    const rigid = (await load('/gear/gear-rigid.glb')).scene;
    const piece = rigid.getObjectByName(c.weapon);
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.6, metalness: 0.1 });
    piece.traverse((o) => { if (o.isMesh) { const m = new THREE.Mesh(o.geometry, mat); o.updateWorldMatrix(true, false); m.applyMatrix4(o.matrixWorld); group.add(m); } });
    group.rotation.y = ((c.yaw ?? 35) * Math.PI) / 180;
    scene.add(group);
    const box = new THREE.Box3().setFromObject(group), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 50);
    const d = Math.max(size.y, size.x * 1.5, 0.35) * 2.1;
    cam.position.set(centre.x, centre.y + d * 0.1, centre.z + d); cam.lookAt(centre);
    renderer.render(scene, cam);
    return;
  }
  const root = cloneSkinned((await load(`/assets/character/body-${c.sex}.glb`)).scene);
  scene.add(root);
  const bones = new Map(); root.traverse((o) => { if (o.isBone) bones.set(o.name, o); });
  const body = root.getObjectByName('Body');
  body.material = new THREE.MeshStandardMaterial({ color: '#d9a37a' });
  const covered = new Set(c.visuals.flatMap((v) => manifest.visuals[v]?.covers ?? []));
  const bands = c.visuals.flatMap((v) => manifest.visuals[v]?.hide?.[c.sex] ?? []);
  const P = body.geometry.getAttribute('position');
  const g = body.geometry, J = g.getAttribute('skinIndex'), Wt = g.getAttribute('skinWeight'), idx = g.getIndex();
  const dom = (v) => { let b = 0; for (let k = 1; k < 4; k++) if (Wt.getComponent(v, k) > Wt.getComponent(v, b)) b = k; return J.getComponent(v, b); };
  const kept = [];
  for (let i = 0; i < idx.count; i += 3) {
    const t = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    // a vertex is hidden by a covered region or by a shell's band; a triangle goes when all three are
    const hidden = (v) => { const r = region(body.skeleton.bones[dom(v)].name); return covered.has(r) || bands.some((b) => (r === b.region || (b.region === 'calves' && r === 'thighs')) && P.getY(v) > b.minY && P.getY(v) < b.maxY); };
    if (!t.every(hidden)) kept.push(...t);
  }
  const ng = g.clone(); ng.setIndex(kept); body.geometry = ng;
  const gear = (await load(`/gear/gear-${c.sex}.glb`)).scene;
  const material = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.9, metalness: 0 });
  const rigid = (await load('/gear/gear-rigid.glb')).scene;
  for (const v of c.visuals) {
    const info = manifest.visuals[v];
    if (info?.kind === 'rigid') {
      const piece = rigid.getObjectByName(v);
      if (!piece) continue;
      const mesh = new THREE.Mesh((piece.isMesh ? piece : piece.children[0]).geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.fromArray(info.transform[c.sex]);
      bones.get(info.bone).add(mesh);
      continue;
    }
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
  const cy = c.camera?.y ?? 0.85; cam.position.set(0, cy + 0.15, c.camera?.dist ?? 4.4); cam.lookAt(0, cy, 0);
  renderer.render(scene, cam);
};
