/** Wavefront OBJ (+ .mtl Kd colours) -> a gltf-transform Document with one node, one primitive per material, faceted normals. */
import fs from 'node:fs';
import path from 'node:path';
import { Document } from '@gltf-transform/core';

function readMtl(file) {
  const colors = {};
  if (!fs.existsSync(file)) return colors;
  let current = null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [k, ...rest] = line.trim().split(/\s+/);
    if (k === 'newmtl') current = rest[0];
    else if (k === 'Kd' && current) colors[current] = rest.slice(0, 3).map(Number);
  }
  return colors;
}

export function readObj(file, nodeName) {
  const colors = readMtl(file.replace(/\.obj$/i, '.mtl'));
  const vertices = [];
  const faces = new Map();
  let material = 'default';
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [k, ...rest] = line.trim().split(/\s+/);
    if (k === 'v') vertices.push(rest.slice(0, 3).map(Number));
    else if (k === 'usemtl') material = rest[0];
    else if (k === 'f') {
      const idx = rest.map((t) => { const i = parseInt(t.split('/')[0], 10); return i < 0 ? vertices.length + i : i - 1; });
      (faces.get(material) ?? faces.set(material, []).get(material)).push(idx);
    }
  }
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh(nodeName ?? path.basename(file, '.obj'));
  for (const [name, list] of faces) {
    const pos = [], nor = [];
    for (const f of list) for (let i = 1; i + 1 < f.length; i++) {
      const [a, b, c] = [vertices[f[0]], vertices[f[i]], vertices[f[i + 1]]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...n) || 1;
      for (const p of [a, b, c]) { pos.push(...p); nor.push(n[0] / l, n[1] / l, n[2] / l); }
    }
    const count = pos.length / 3;
    mesh.addPrimitive(doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from({ length: count }, (_, i) => i)).setBuffer(buffer))
      .setMaterial(doc.createMaterial(name).setBaseColorFactor([...(colors[name] ?? [0.5, 0.5, 0.5]), 1])));
  }
  doc.createScene().addChild(doc.createNode(nodeName ?? mesh.getName()).setMesh(mesh));
  return doc;
}
