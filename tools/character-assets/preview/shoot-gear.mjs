#!/usr/bin/env node
/**
 * Contact sheet of one gear slot: every visual of the slot (rows: visual × sex) in
 * Idle, Attack, Walk, CastLoop and Sit (columns).
 *   node preview/shoot-gear.mjs <slot> [visual,visual+other...]  -> preview/screenshots/gear-<slot>.png
 * ('a+b' wears both visuals in one row.)
 * Reads the built gear from $GEAR_OUT (default: the frontend's assets). Needs a Chromium
 * (CHROMIUM=/path, default /snap/bin/chromium).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const frontend = path.join(repo, 'apps/frontend');
const gearDir = process.env.GEAR_OUT ?? path.join(frontend, 'public/assets/character/gear');
const require = createRequire(path.join(frontend, 'package.json'));
const esbuild = require(require.resolve('esbuild', { paths: [path.join(repo, 'node_modules/.pnpm/esbuild@0.23.0/node_modules')] }));
const { chromium } = createRequire(path.join(repo, 'package.json'))('playwright');

const [slot, list] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(gearDir, 'manifest.json'), 'utf8'));
const visuals = list ? list.split(',') : Object.keys(manifest.visuals).filter((v) => manifest.visuals[v].slot === slot);
let POSES = {
  cape: [['Idle', 0.3, 0], ['Idle', 0.3, 35], ['Idle', 0.3, 200], ['Idle', 0.3, 135], ['Attack', 0.35, 200], ['Walk', 0.4, 120], ['Sit', 0.5, 150]],
  boots: [['Idle', 0.3, 0], ['Idle', 0.3, 60], ['Idle', 0.3, 120], ['Idle', 0.3, 180], ['Walk', 0.4, 150]],
  ankle: [['Idle', 0.3, 0], ['Idle', 0.3, 35], ['Idle', 0.3, 90], ['Idle', 0.3, 150], ['Walk', 0.4, 60]],
  head: [['Idle', 0.3, 0], ['Idle', 0.3, 50], ['Idle', 0.3, 110], ['Idle', 0.3, 180], ['Attack', 0.35, 40]],
  // silhouette: front, three-quarter, side, back (the portrait looks from slightly above)
  silhouette: [['Idle', 0.3, 0], ['Idle', 0.3, 30], ['Idle', 0.3, 90], ['Idle', 0.3, 180], ['Walk', 0.4, 20]],
  capetop: [['Idle', 0.3, 180], ['Idle', 0.3, 135], ['Idle', 0.3, 90], ['Idle', 0.3, 30], ['Attack', 0.35, 180]],
  knee: [['Idle', 0.3, 0], ['Idle', 0.3, 60], ['Idle', 0.3, 180], ['Walk', 0.4, 20], ['Walk', 0.7, 90]],
  lumbar: [['Idle', 0.3, 150], ['Idle', 0.3, 180], ['Idle', 0.3, 220], ['Attack', 0.35, 180], ['Walk', 0.4, 160]],
  // seen from above, like the town camera
  nape: [['Idle', 0.3, 150], ['Idle', 0.3, 180], ['Idle', 0.3, 210], ['Walk', 0.4, 180], ['Attack', 0.35, 180]],
  top: [['Idle', 0.3, 0], ['Idle', 0.3, 90], ['Idle', 0.3, 180], ['Walk', 0.4, 200], ['Attack', 0.35, 160]],
}[slot] ?? [['Idle', 0.3, 20], ['Attack', 0.35, 60], ['Walk', 0.4, 90], ['CastLoop', 0.3, 0], ['Sit', 0.5, 40]];
POSES = [...POSES];
const CAMERA = { capetop: { y: 1.35, dist: 1.6 }, knee: { y: 0.55, dist: 1.4 }, lumbar: { y: 1.05, dist: 1.4 }, top: { y: 1.1, dist: 2.2, eyeY: 3.6 }, nape: { y: 1.3, dist: 0.6, eyeY: 2.9 }, head: { y: 1.62, dist: 1.25 }, boots: { y: 0.35, dist: 1.6 }, ankle: { y: 0.3, dist: 1.9 } }[slot] ?? null;
const WEAPONS = slot === 'weapons';
const rows = WEAPONS
  ? [...new Set(visuals.map((v) => manifest.visuals[v].weaponType))].map((t) => ({ v: t, sex: '', list: Object.entries(manifest.items).filter(([, vis]) => manifest.visuals[vis].weaponType === t).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, vis]) => vis) }))
  : visuals.flatMap((v) => ['male', 'female'].map((sex) => ({ v, sex })));
if (WEAPONS) POSES.length = Math.max(...rows.map((r) => r.list.length));

const js = (await esbuild.build({ entryPoints: [path.join(here, 'gear-entry.js')], bundle: true, write: false, format: 'esm', nodePaths: [path.join(frontend, 'node_modules')], logLevel: 'error' })).outputFiles[0].text;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') return res.end('<!doctype html><body style="margin:0"><div id="host"></div><script type="module" src="/e.js"></script>');
  if (url === '/e.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(js); }
  const file = url.startsWith('/gear/') ? path.join(gearDir, url.slice(6)) : path.join(frontend, 'public', url);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  fs.createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/snap/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 240, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => typeof window.applyConfig === 'function');
const tiles = [];
for (const [r, { v, sex, list }] of rows.entries()) for (const [c, [clip, t, yaw]] of POSES.entries()) {
  if (WEAPONS && !list[c]) continue;
  await page.evaluate((cfg) => window.applyConfig(cfg), WEAPONS ? { weapon: list[c], yaw: 35 } : { sex, visuals: v.split('+'), clip, t, yaw, camera: CAMERA });
  tiles.push({ input: await page.locator('canvas').screenshot(), left: 160 + c * 240, top: r * 360 });
}
await browser.close();
server.close();
const labels = rows.map(({ v, sex }, r) => ({
  input: Buffer.from(`<svg width="160" height="360" xmlns="http://www.w3.org/2000/svg"><rect width="160" height="360" fill="#1e1a17"/><text x="8" y="170" fill="#eee" font-family="sans-serif" font-size="14">${v}</text><text x="8" y="192" fill="#aaa" font-family="sans-serif" font-size="13">${sex}</text></svg>`),
  left: 0, top: r * 360,
}));
const out = path.join(here, 'screenshots', `gear-${slot}.png`);
fs.mkdirSync(path.dirname(out), { recursive: true });
await sharp({ create: { width: 160 + POSES.length * 240, height: rows.length * 360, channels: 3, background: '#000' } })
  .composite([...labels, ...tiles]).png().toFile(out);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
console.log(out);
