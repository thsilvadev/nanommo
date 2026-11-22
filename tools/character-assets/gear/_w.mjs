import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'node:fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const d = f.endsWith('.gltf') ? await io.read(f) : await io.read(f);
  const scene = d.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const meshes = d.getRoot().listNodes().filter(n=>n.getMesh()).map(n=>n.getName());
  console.log(f.split('/').slice(-2).join('/').slice(-40).padEnd(42), 'min', b.min.map(x=>+x.toFixed(2)).join(','), 'max', b.max.map(x=>+x.toFixed(2)).join(','), meshes.length, meshes.slice(0,3).join('|'), d.getRoot().listMaterials().map(m=>m.getName()+(m.getBaseColorTexture()?'(t)':'')).join(','));
}
