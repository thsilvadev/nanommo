#!/usr/bin/env node
// Development aid: screenshots of the battle arena with the real runtime and battle fixtures.
//   node tools/arena-assets/preview/shoot-arena.mjs <out-dir> [shot…]
// Needs a Chromium (CHROMIUM=/path, default /snap/bin/chromium) and a built @nanommo/shared.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const frontend = path.join(repo, 'apps/frontend');
const esbuild = createRequire(path.join(frontend, 'package.json'))(createRequire(import.meta.url).resolve('esbuild', { paths: [path.join(repo, 'node_modules/.pnpm/esbuild@0.23.0/node_modules')] }));
const { chromium } = createRequire(path.join(repo, 'package.json'))('playwright');
const [outDir, ...only] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const bundle = await esbuild.build({
  entryPoints: [path.join(here, 'arena-entry.ts')], bundle: true, write: false, format: 'esm', target: 'es2022',
  nodePaths: [path.join(frontend, 'node_modules')], logLevel: 'error', tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
});
const js = bundle.outputFiles[0].text;
const html = '<!doctype html><html><body style="margin:0;background:#000"><div id="host" style="width:1280px;height:560px;position:relative"></div><script type="module" src="/arena.js"></script></body></html>';
const types = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  if (url === '/arena.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(js); }
  const file = path.join(frontend, 'public', url);
  if (!file.startsWith(path.join(frontend, 'public')) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/snap/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => typeof window.shoot === 'function', null, { timeout: 60000 }).catch((e) => { console.error(errors.join('\n')); throw e; });
const names = only.length ? only : await page.evaluate(() => window.shots);
for (const name of names) {
  const info = await page.evaluate((n) => window.shoot(n), name);
  await page.locator('#host').screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(name, JSON.stringify(info));
}
await browser.close();
server.close();
if (errors.length) { console.error(errors.slice(0, 10).join('\n')); process.exitCode = 1; }
