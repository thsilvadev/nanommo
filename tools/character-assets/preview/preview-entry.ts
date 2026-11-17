/** Browser entry for the screenshot harness: drives one CharacterRig from window.applyConfig(). */
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CharacterRig } from '../../../apps/frontend/src/app/shared/character-viewer/character-rig';

const loader = new GLTFLoader();
let rig: CharacterRig | null = null;
(window as any).applyConfig = async (config: any) => {
  const host = document.getElementById('host')!;
  host.style.width = `${config.width ?? 360}px`;
  host.style.height = `${config.height ?? 640}px`;
  if (!rig) {
    rig = await CharacterRig.create(host, {
      assetBase: '/assets/character/',
      catalog: () => fetch('/data/appearance_catalog.json').then((r) => r.json()),
      load: (url) => loader.loadAsync(url),
      onContextLost: () => { (window as any).contextLost = true; },
    });
  }
  await rig.apply(config);
  if (config.yaw !== undefined) (rig as any).model.rotation.y = config.yaw;
  (rig as any).updateCamera();
  if (config.zoom) {
    // Debug close-up on the face.
    const r = rig as any; const head = r.current.bones.get('Head');
    const THREE = await import('three');
    r.model.updateMatrixWorld(true);
    const y = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).y + 0.06 * r.model.scale.y;
    r.camera.position.set(0, y, config.zoom);
    r.camera.lookAt(0, y - 0.01, 0);
  }
  // Let the idle clip settle into a pose, then render.
  for (let i = 0; i < (config.frames ?? 20); i++) { (rig as any).renderOnce(); await new Promise((r) => setTimeout(r, 16)); }
  const r = rig as any;
  const body = r.current;
  const head = body.bones.get('Head');
  const THREE = await import('three');
  const pos = (o: any) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).toArray().map((x: number) => +x.toFixed(3));
  const piercing = head.children.find((c: any) => c.name.startsWith('piercing:'));
  return {
    noseTip: body.noseTip.toArray().map((x: number) => +x.toFixed(3)),
    headBind: new THREE.Vector3().setFromMatrixPosition(body.bind.get('Head')).toArray().map((x: number) => +x.toFixed(3)),
    headNow: pos(head),
    bodyMatrix: body.body.matrixWorld.elements.map((x: number) => +x.toFixed(3)),
    bindMatrix: body.body.bindMatrix.elements.map((x: number) => +x.toFixed(3)),
    piercingNow: piercing ? pos(piercing.children[0]) : null,
    camera: r.camera.position.toArray().map((x: number) => +x.toFixed(3)),
  };
};
