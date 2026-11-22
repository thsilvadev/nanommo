/** A node of a source document as a rigid gear piece: mesh baked in place, pivot at the origin, long axis +Y. */
import { mat4, quat, vec3 } from 'gl-matrix';
import { transformMesh } from '@gltf-transform/functions';

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], '-x': [-1, 0, 0], '-y': [0, -1, 0], '-z': [0, 0, -1] };

/**
 * Keeps only `nodeName` (and its mesh descendants, merged under it), bakes its world transform,
 * moves `pivot` (source world units; default: bbox centre) to the origin, turns `up` onto +Y and,
 * when `length` is given, scales so the piece's extent along +Y is `length` metres. Mutates `doc`.
 */
export function extractRigid(doc, nodeName, { pivot, up = 'y', length } = {}) {
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const node = root.listNodes().find((n) => n.getName() === nodeName);
  if (!node) throw new Error(`node not found: ${nodeName}`);
  const keep = [];
  node.traverse((n) => { if (n.getMesh()) keep.push(n); });
  for (const n of keep) transformMesh(n.getMesh(), n.getWorldMatrix());

  const bbox = () => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const n of keep) for (const p of n.getMesh().listPrimitives()) {
      const P = p.getAttribute('POSITION');
      for (let i = 0; i < P.getCount(); i++) { const v = P.getElement(i, []); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); } }
    }
    return { min, max };
  };
  const { min, max } = bbox();
  const origin = pivot ?? [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  const m = mat4.fromQuat(mat4.create(), quat.rotationTo(quat.create(), AXES[up], [0, 1, 0]));
  mat4.translate(m, m, vec3.negate(vec3.create(), origin));
  for (const n of keep) transformMesh(n.getMesh(), m);
  if (length) {
    const b = bbox();
    const s = length / (b.max[1] - b.min[1]);
    for (const n of keep) transformMesh(n.getMesh(), mat4.fromScaling(mat4.create(), [s, s, s]));
  }

  // one node named nodeName holding every kept mesh's primitives
  const target = doc.createNode(nodeName);
  const mesh = doc.createMesh(nodeName);
  for (const n of keep) for (const p of n.getMesh().listPrimitives()) mesh.addPrimitive(p);
  target.setMesh(mesh);
  for (const n of root.listNodes()) if (n !== target) n.dispose();
  scene.addChild(target);
  return doc;
}
