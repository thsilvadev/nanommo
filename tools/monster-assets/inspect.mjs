// Prints animations (name, duration) and bounding box of each picked model.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const picks = JSON.parse(fs.readFileSync(path.join(HERE, 'picks.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [id, p] of [...Object.entries(picks).filter(([k]) => k[0] !== '_'), ...Object.entries(picks._extra)]) {
  if (!p.uid) continue;
  const f = path.join(HERE, '../character-assets/source/sketchfab', p.uid, 'model.glb');
  if (!fs.existsSync(f)) { console.log(id, 'MISSING'); continue; }
  const doc = await io.read(f); const root = doc.getRoot();
  const b = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
  const size = b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join('x');
  const anims = root.listAnimations().map((a) => { let t = 0; for (const s of a.listSamplers()) { const arr = s.getInput()?.getArray(); if (arr) t = Math.max(t, arr[arr.length - 1]); } return `${a.getName()}(${t.toFixed(1)}s)`; });
  console.log(`${id} | ${(fs.statSync(f).size / 1e6).toFixed(1)}MB | ${size} | skins:${root.listSkins().length} | ${anims.join(', ')}`);
}
