#!/usr/bin/env node
/**
 * Development aid: screenshots of the character creator against a running
 * `ng serve`, with the API mocked in the browser (no backend needed).
 *   node preview/shoot-creator.mjs <out-dir> [frontend-url]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const { chromium } = createRequire(path.join(repo, 'package.json'))('playwright');
const [outDir, base = 'http://127.0.0.1:4310'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'none' })}.${b64({ userId: 'user-1', username: 'preview', emailVerified: true, exp: 4102444800 })}.x`;
const legacy = { id: 'char-1', userId: 'user-1', name: 'Veteran', dominantHand: 'left', sex: null, height: null, heightCm: null, appearance: null, level: 12, stateVersion: 3, status: 'town', currentMapId: 'map_town', diet: [], dietLevels: {} };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/snap/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
for (const scenario of [
  { name: 'creator-new-desktop', character: null, viewport: { width: 1280, height: 800 } },
  { name: 'creator-update-desktop', character: legacy, viewport: { width: 1280, height: 800 } },
  { name: 'creator-new-mobile', character: null, viewport: { width: 390, height: 844 } },
  { name: 'creator-update-confirm', character: legacy, viewport: { width: 1280, height: 800 }, confirm: true },
]) {
  const context = await browser.newContext({ viewport: scenario.viewport });
  await context.addInitScript(([t]) => { localStorage.setItem('accessToken', t); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('nanommo.locale', 'pt-BR'); }, [token]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${scenario.name}: ${e}`));
  await page.route('http://localhost:3000/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/characters') return route.fulfill({ json: scenario.character });
    if (url.pathname === '/equipment') return route.fulfill({ json: [{ slot: 'mainHand', itemId: 'equip_sword_t1' }, { slot: 'offHand', itemId: 'equip_shield_t1' }] });
    if (url.pathname === '/inventory') return route.fulfill({ json: { items: [], stateVersion: 1 } });
    return route.fulfill({ json: {} });
  });
  await page.goto(`${base}/create-character`);
  await page.waitForSelector('app-character-viewer canvas', { timeout: 30000 }).catch(() => errors.push(`${scenario.name}: no canvas`));
  await page.waitForTimeout(2500);
  if (scenario.confirm) await page.click('[data-test=confirm]');
  await page.screenshot({ path: path.join(outDir, `${scenario.name}.png`), fullPage: scenario.viewport.width < 500 });
  await context.close();
}
await browser.close();
if (errors.length) console.error(errors.join('\n'));
console.log('done');
