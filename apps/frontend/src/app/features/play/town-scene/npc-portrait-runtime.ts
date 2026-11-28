/** Lazy 3D portrait: the same dressed, animated figure used in the town. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CharacterAssetCache } from '../../../shared/character-viewer/character-asset-cache';
import { loadAppearanceCatalog } from '../../../shared/character-viewer/appearance-catalog';
import { TownCharacter, TownCharacterFactory } from './town-character';
import { NPC_VISUALS, buildNpcVisual, npcAppearance } from './npc-visuals';

export async function createNpcPortrait(host: HTMLElement, npcId: string): Promise<{ dispose(): void }> {
  const visual = NPC_VISUALS[npcId];
  if (!visual) throw new Error(`No NPC model for ${npcId}`);
  const loader = new GLTFLoader();
  const cache = CharacterAssetCache.shared('/assets/character/', url => loader.loadAsync(url));
  const factory = new TownCharacterFactory(cache, await loadAppearanceCatalog());
  const entry = factory.npcEntry(npcId, '');
  if (visual.figure.kind === 'body') {
    entry.sex = visual.figure.sex;
    entry.heightCm = visual.figure.heightCm;
    entry.appearance = npcAppearance(entry.appearance!, visual.figure);
  }
  const npc = new TownCharacter(factory, entry, { npc: true, visual: visual.figure, portrait: true });
  let renderer: THREE.WebGLRenderer | null = null;
  let resize: ResizeObserver | null = null;
  let frame = 0;
  const dispose = () => {
    cancelAnimationFrame(frame);
    resize?.disconnect();
    npc.dispose();
    factory.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
  };
  try {
    await npc.ready;
    // The mailbox has no body: its prop is its portrait.
    if (visual.figure.kind === 'none') npc.object3d.add(await buildNpcVisual(visual, { factory }));
    const pose = { x: 0, z: 0, facing: 0, state: 'idle' as const };
    npc.update(pose, 0, 'full', Date.now());
    const scene = new THREE.Scene();
    scene.add(npc.object3d, new THREE.HemisphereLight('#ffffff', '#4a3a2a', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 2);
    sun.position.set(-3, 6, 5);
    scene.add(sun);
    const box = new THREE.Box3().setFromObject(npc.object3d);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const fit = () => {
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      renderer!.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer!.setSize(w, h, false);
      camera.aspect = w / h;
      // Fit both height and width, including broad costumes such as William's pack.
      const span = Math.max(size.y, Math.hypot(size.x, size.z) / camera.aspect) * 1.18;
      const dist = span / (2 * Math.tan(Math.PI / 12));
      const yaw = -35 * Math.PI / 180;
      camera.position.set(center.x + Math.sin(yaw) * dist, center.y + span * 0.12, center.z + Math.cos(yaw) * dist);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
    };
    fit();
    resize = new ResizeObserver(fit);
    resize.observe(host);
    let previous = performance.now();
    const tick = () => {
      const now = performance.now();
      npc.update(pose, Math.min(100, now - previous), 'full', Date.now());
      previous = now;
      renderer!.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();
    host.appendChild(renderer.domElement);
    return { dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
