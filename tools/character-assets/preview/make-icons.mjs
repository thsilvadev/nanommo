#!/usr/bin/env node
/**
 * Item icons from the approved 3D gear: each item's visual is rendered in an icon pose (transparent,
 * orthographic), traced into flat colour shapes (imagetracerjs) over a dark silhouette outline, like
 * the existing icon style. The framed variant keeps the item's own frame (tier colour) and swaps the art.
 *   node preview/make-icons.mjs [itemId,...] [--out <dir>]   (default: the frontend's icon folders)
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import ImageTracer from 'imagetracerjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const frontend = path.join(repo, 'apps/frontend');
const gearDir = path.join(frontend, 'public/assets/character/gear');
const require = createRequire(path.join(frontend, 'package.json'));
const esbuild = require(require.resolve('esbuild', { paths: [path.join(repo, 'node_modules/.pnpm/esbuild@0.23.0/node_modules')] }));
const { chromium } = createRequire(path.join(repo, 'package.json'))('playwright');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : path.join(frontend, 'assets/ui/items');
const only = args.find((a, i) => !a.startsWith('--') && i !== outIdx + 1)?.split(',');
const ICONS = path.join(frontend, 'assets/ui/items');
const manifest = JSON.parse(fs.readFileSync(path.join(gearDir, 'manifest.json'), 'utf8'));
const items = JSON.parse(fs.readFileSync(path.join(repo, 'items.json'), 'utf8')).equipment.filter((i) => i.slot !== 'accessory' && (!only || only.includes(i.id)));

/** Icon pose per slot (degrees): yaw/tilt turn the piece, roll turns the picture (weapons on the diagonal). */
function pose(item, visual) {
  const v = manifest.visuals[visual];
  if (v.slot === 'body') return { yaw: 0, tilt: 0, fill: 0.86 };
  if (v.slot === 'head') return { yaw: 20, tilt: 6, fill: 0.82 };
  if (v.slot === 'cape') return { yaw: 180, tilt: 0, fill: 0.84 };
  if (v.slot === 'shoes') return { yaw: 70, tilt: 10, fill: 0.86 };
  const t = v.weaponType;
  if (t === 'shield') return { yaw: 0, tilt: 0, fill: 0.8 };
  if (t === 'rune') return { yaw: 0, tilt: 0, fill: 0.62 };
  if (t === 'bow') return { yaw: 0, tilt: 0, roll: -45, fill: 0.9 };
  return { yaw: 0, tilt: 0, roll: -45, fill: 0.92 };
}

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
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => typeof window.applyConfig === 'function');

const OUTLINE = '#0d0b12';
async function trace(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageData = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
  const art = ImageTracer.imagedataToSVG(imageData, { numberofcolors: 8, colorquantcycles: 3, pathomit: 48, ltres: 1, qtres: 1, roundcoords: 1, blurradius: 2, blurdelta: 24, viewbox: true, strokewidth: 0, linefilter: true });
  // silhouette: alpha -> black mask
  const mask = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) { const on = data[i + 3] > 40; mask[i] = mask[i + 1] = mask[i + 2] = 0; mask[i + 3] = on ? 255 : 0; }
  const sil = ImageTracer.imagedataToSVG({ width: info.width, height: info.height, data: new Uint8ClampedArray(mask) }, { numberofcolors: 2, pathomit: 24, ltres: 1, qtres: 1, roundcoords: 1, viewbox: true, strokewidth: 0 });
  const paths = (svg, keep) => [...svg.matchAll(/<path [^>]*\/>/g)].map((m) => m[0]).filter(keep);
  const opaque = (p) => !/opacity="0(\.0+)?"/.test(p);
  const silhouette = paths(sil, (p) => /fill="rgb\(0,0,0\)"/.test(p) && opaque(p)).map((p) => p.replace(/ (stroke|stroke-width|opacity)="[^"]*"/g, '').replace(/fill="[^"]*"/, `fill="${OUTLINE}" stroke="${OUTLINE}" stroke-width="10" stroke-linejoin="round"`));
  const colour = paths(art, opaque).map((p) => p.replace(/ (stroke|stroke-width)="[^"]*"/g, '').replace(/ opacity="1"/, ''));
  return `<g transform="scale(0.25)">${silhouette.join('')}${colour.join('')}</g>`;
}

for (const item of items) {
  const visual = manifest.items[item.id];
  const png = Buffer.from((await page.evaluate((c) => window.applyConfig(c), { icon: visual, ...pose(item, visual) })).split(',')[1], 'base64');
  const art = await trace(png);
  const title = `<title>${item.name}</title>`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="${item.name}">`;
  fs.mkdirSync(path.join(OUT, 'svg-noframe/equipment'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'svg/equipment'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'svg-noframe/equipment', `${item.id}.svg`), `${open}${title}${art}</svg>`);
  // framed: the item's own square frame (tier colour) with the new art; items whose frame is part of
  // the old art (runes) or hand-made (traveler boots) take the square frame of their tier
  const frameOf = (id) => {
    const framed = fs.readFileSync(path.join(ICONS, 'svg/equipment', `${id}.svg`), 'utf8');
    const oldArt = fs.readFileSync(path.join(ICONS, 'svg-noframe/equipment', `${id}.svg`), 'utf8');
    const body = oldArt.slice(oldArt.indexOf('</defs>') >= 0 ? oldArt.indexOf('</defs>') + 7 : oldArt.indexOf('</title>') + 8, oldArt.lastIndexOf('</svg>'));
    const at = framed.indexOf(body);
    return at < 0 || !framed.includes('_rim') ? null : { head: framed.slice(0, at), tail: framed.slice(at + body.length) };
  };
  const frame = (item.weaponType === 'rune' ? null : frameOf(item.id)) ?? frameOf(`equip_sword_t${Math.min(3, item.tier)}`);
  const head = frame.head.replace(/aria-label="[^"]*"/, `aria-label="${item.name}"`).replace(/<title>[^<]*<\/title>/, title);
  fs.writeFileSync(path.join(OUT, 'svg/equipment', `${item.id}.svg`), head + art + frame.tail);
}
await browser.close();
server.close();
console.log(`${items.length} icons -> ${OUT}`);
