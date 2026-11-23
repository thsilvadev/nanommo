/**
 * Downloads every Sketchfab model listed in picks.json into
 * tools/character-assets/source/sketchfab/<uid>/ (gitignored; shared with the character pipeline).
 * Needs ~/.sketchfab_token. Already present models are kept.
 */
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, '../character-assets/source/sketchfab');
const picks = JSON.parse(fs.readFileSync(path.join(HERE, 'picks.json'), 'utf8'));
const token = fs.readFileSync(path.join(os.homedir(), '.sketchfab_token'), 'utf8').trim();
const all = [...Object.values(picks), ...Object.values(picks._extra ?? {})];
const uids = [...new Set(all.map((p) => p.uid).filter(Boolean))];
for (const uid of uids) { await (async () => {
  const dir = path.join(SOURCE, uid);
  if (fs.existsSync(path.join(dir, 'model.glb'))) return;
  fs.mkdirSync(dir, { recursive: true });
  const m = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}`)).json();
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ uid, title: m.name, author: m.user?.displayName, authorUrl: m.user?.profileUrl, license: m.license?.label, url: m.viewerUrl }, null, 2));
  const info = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${token}` } })).json();
  if (!info.glb) { fs.rmSync(dir, { recursive: true }); console.log('NO GLB', uid, JSON.stringify(info).slice(0, 200)); return; }
  fs.writeFileSync(path.join(dir, 'model.glb'), Buffer.from(await (await fetch(info.glb.url)).arrayBuffer()));
  console.log('ok', uid, m.name);
})(); await new Promise((r) => setTimeout(r, 8000)); }
