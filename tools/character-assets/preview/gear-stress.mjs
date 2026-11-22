#!/usr/bin/env node
/**
 * Perf gate for wearable gear: N town characters bare vs fully equipped (real TownCharacter code).
 *   node preview/gear-stress.mjs [count=200] [frames=240]
 * Pass: draw calls per character <= bare + 1, median frame time <= 1.25x bare.
 * Writes preview/screenshots/gear-stress.png (the equipped crowd).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const frontend = path.join(repo, 'apps/frontend');
const require = createRequire(path.join(frontend, 'package.json'));
const esbuild = require(require.resolve('esbuild', { paths: [path.join(repo, 'node_modules/.pnpm/esbuild@0.23.0/node_modules')] }));
const { chromium } = createRequire(path.join(repo, 'package.json'))('playwright');
const count = Number(process.argv[2] ?? 200), frames = Number(process.argv[3] ?? 240);

const js = (await esbuild.build({ entryPoints: [path.join(here, 'gear-stress-entry.ts')], bundle: true, write: false, format: 'esm', target: 'es2022', nodePaths: [path.join(frontend, 'node_modules')], logLevel: 'error' })).outputFiles[0].text;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') return res.end('<!doctype html><body style="margin:0"><div id="host"></div><script type="module" src="/e.js"></script>');
  if (url === '/e.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(js); }
  const file = path.join(frontend, 'public', url);
  if (!file.startsWith(path.join(frontend, 'public')) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  fs.createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/snap/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => typeof window.run === 'function');
const bare = await page.evaluate((o) => window.run(o), { count, equipped: false, frames });
const geared = await page.evaluate((o) => window.run(o), { count, equipped: true, frames });
await browser.close();
server.close();
fs.mkdirSync(path.join(here, 'screenshots'), { recursive: true });
fs.writeFileSync(path.join(here, 'screenshots', 'gear-stress.png'), Buffer.from(geared.shot.split(',')[1], 'base64'));
const perChar = (geared.calls - bare.calls) / count, ratio = geared.medianMs / bare.medianMs;
const result = {
  count, frames,
  bare: { calls: bare.calls, triangles: bare.triangles, medianMs: +bare.medianMs.toFixed(1) },
  equipped: { calls: geared.calls, triangles: geared.triangles, medianMs: +geared.medianMs.toFixed(1) },
  extraCallsPerCharacter: +perChar.toFixed(2), frameTimeRatio: +ratio.toFixed(3),
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) console.error(errors.join('\n'));
const pass = perChar <= 1 && ratio <= 1.25;
console.log(pass ? 'PERF GATE: PASS' : 'PERF GATE: FAIL');
process.exitCode = pass ? 0 : 1;
