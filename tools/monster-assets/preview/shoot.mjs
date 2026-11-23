/** node preview/shoot.mjs <out.png> <clip> <frac> [id...] — contact sheet of monsters next to the character. */
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../..'); const frontend = path.join(repo, 'apps/frontend');
const require = createRequire(path.join(frontend, 'package.json'));
const esbuild = require(require.resolve('esbuild', { paths: [path.join(repo, 'node_modules/.pnpm/esbuild@0.23.0/node_modules')] }));
const { chromium } = createRequire(path.join(repo, 'package.json'))('playwright');
const [out, clip, frac, ...only] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(frontend, 'public/assets/monsters/manifest.json'), 'utf8'));
const ids = Object.keys(manifest).filter((k) => manifest[k].file && (!only.length || only.includes(k)));
const js = (await esbuild.build({ entryPoints: [path.join(here, 'entry.js')], bundle: true, write: false, format: 'esm', nodePaths: [path.join(frontend, 'node_modules')], logLevel: 'error' })).outputFiles[0].text;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<body style="margin:0"><script type="module" src="/p.js"></script>'); }
  if (url === '/p.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(js); }
  const file = path.join(frontend, 'public', url); if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200); fs.createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/snap/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => window.ready);
const fr = process.env.FRACS ? process.env.FRACS.split(',').map(Number) : null; const jobs = fr ? fr.map((f) => [ids[0], f]) : ids.map((id) => [id, +frac]);
const S = +(process.env.CELL ?? 300), cols = Math.min(+(process.env.COLS ?? 6), jobs.length), comps = [];
for (const [i, [id, f]] of jobs.entries()) {
  const r = await page.evaluate((a) => window.shot(a), { id, ...manifest[id], clip, frac: f, yaw: +(process.env.YAW ?? 30), W: S });
  console.log(id, r.used, r.size.join('x'));
  const label = Buffer.from(`<svg width="${S}" height="22"><text x="4" y="16" font-size="15" fill="#fff" font-family="sans-serif">${id} · ${r.used}${fr ? ' ' + f : ''}</text></svg>`);
  comps.push({ input: Buffer.from(r.url.split(',')[1], 'base64'), left: (i % cols) * S, top: Math.floor(i / cols) * S }, { input: label, left: (i % cols) * S, top: Math.floor(i / cols) * S });
}
await sharp({ create: { width: cols * S, height: Math.ceil(jobs.length / cols) * S, channels: 3, background: '#000' } }).composite(comps).png().toFile(out);
await browser.close(); server.close(); if (errors.length) console.error(errors.join('\n'));
