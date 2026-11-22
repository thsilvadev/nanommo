#!/usr/bin/env node
/**
 * Fetches the gear sources into ./source (not versioned): the KayKit repos (git, CC0) and every
 * Sketchfab model the config uses (needs a Sketchfab API token in ~/.sketchfab_token for downloads;
 * Settings -> Password & API). Already present files are kept. Writes source/sketchfab/<uid>/meta.json
 * (title, author, license, url) — CREDITS.md is generated from it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VISUALS, SOURCES } from './gear.config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, '../source');
const KAYKIT = { 'kaykit-adventurers': 'KayKit-Character-Pack-Adventures-1.0', 'kaykit-Skeletons': 'KayKit-Character-Pack-Skeletons-1.0' };

for (const [dir, repo] of Object.entries(KAYKIT)) {
  const target = path.join(SOURCE, dir, dir === 'kaykit-adventurers' ? 'repo' : '');
  if (fs.existsSync(path.join(target, 'addons'))) continue;
  execFileSync('git', ['clone', '--depth', '1', `https://github.com/KayKit-Game-Assets/${repo}`, target], { stdio: 'inherit' });
}

const uids = [...new Set([...Object.values(VISUALS).map((v) => v.source), ...Object.keys(SOURCES)]
  .filter((s) => s?.startsWith('sketchfab:')).map((s) => s.split(':')[1]))].sort();
const tokenFile = path.join(os.homedir(), '.sketchfab_token');
const token = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : null;
for (const uid of uids) {
  const dir = path.join(SOURCE, 'sketchfab', uid);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'meta.json'))) {
    const m = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}`)).json();
    const meta = { uid, title: m.name, author: m.user?.displayName ?? m.user?.username, authorUrl: m.user?.profileUrl, license: m.license?.label, url: m.viewerUrl };
    fs.writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  }
  if (fs.existsSync(path.join(dir, 'model.glb'))) continue;
  if (!token) throw new Error(`model ${uid} missing and no ~/.sketchfab_token to download it`);
  const info = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${token}` } })).json();
  if (!info.glb?.url) throw new Error(`model ${uid}: no glb download (${JSON.stringify(info).slice(0, 120)})`);
  fs.writeFileSync(path.join(dir, 'model.glb'), Buffer.from(await (await fetch(info.glb.url)).arrayBuffer()));
  console.log('downloaded', uid);
}
console.log(`sources ok (${uids.length} Sketchfab models)`);
