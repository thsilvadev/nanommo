/** Reduces a document's triangles under a budget with meshoptimizer (keeps skin attributes). */
import { simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

export function triangleCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return n;
}

export async function simplifyTo(doc, maxTriangles) {
  let tris = triangleCount(doc);
  if (tris <= maxTriangles) return tris;
  await MeshoptSimplifier.ready;
  await doc.transform(weld());
  let ratio = (maxTriangles / tris) * 0.95, error = 0.01;
  for (let attempt = 0; attempt < 12 && tris > maxTriangles; attempt++) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error }));
    tris = triangleCount(doc);
    if (process.env.GEAR_DEBUG) console.error('simplify', attempt, ratio.toFixed(3), error.toFixed(3), tris);
    ratio *= 0.8; error *= 1.6;
  }
  return tris;
}
