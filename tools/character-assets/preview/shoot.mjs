#!/usr/bin/env node
/**
 * Development aid: renders character configurations with the real rig and
 * saves screenshots.   node preview/shoot.mjs <out-dir> <configs.json>
 * Needs a Chromium; set CHROMIUM=/path/to/chrome (defaults to /snap/bin/chromium).
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

const [outDir, configsFile] = process.argv.slice(2);
const configs = JSON.parse(fs.readFileSync(configsFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const bundle = await esbuild.build({
  entryPoints: [path.join(here, 'preview-entry.ts')], bundle: true, write: false, format: 'esm', target: 'es2022',
  nodePaths: [path.join(frontend, 'node_modules')], logLevel: 'error',
});
const js = bundle.outputFiles[0].text;
const html = '<!doctype html><html><body style="margin:0;background:#2b2420"><div id="host"></div><script type="module" src="/preview.js"></script></body></html>';
const types = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  if (url === '/preview.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(js); }
  const file = path.join(frontend, 'public', url);
  if (!file.startsWith(path.join(frontend, 'public')) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/snap/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base);
await page.waitForFunction(() => typeof window.applyConfig === 'function');
for (const config of configs) {
  const info = await page.evaluate((c) => window.applyConfig(c), config);
  if (process.env.DEBUG) console.log(config.name, JSON.stringify(info));
  await page.locator('#host').screenshot({ path: path.join(outDir, `${config.name}.png`) });
}
await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
console.log(`${configs.length} screenshots in ${outDir}`);
