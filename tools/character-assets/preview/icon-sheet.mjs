#!/usr/bin/env node
/** Before/after sheet of the equipment icons: node preview/icon-sheet.mjs <new icons dir> <out.png> [old icons dir] */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [newDir, out, oldDirArg] = process.argv.slice(2);
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const oldDir = oldDirArg ?? path.join(repo, 'apps/frontend/assets/ui/items');
const order = ['head', 'body', 'cape', 'shoes', 'mainHand', 'offHand'];
const items = JSON.parse(fs.readFileSync(path.join(repo, 'items.json'), 'utf8')).equipment.filter((i) => i.slot !== 'accessory')
  .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot) || (a.weaponType ?? '').localeCompare(b.weaponType ?? '') || a.id.localeCompare(b.id));
const C = 10, T = 110, ROW = T * 2 + 22;
const tiles = [];
for (const [i, it] of items.entries()) {
  const x = (i % C) * T, y = Math.floor(i / C) * ROW;
  for (const [k, dir] of [[0, oldDir], [1, newDir]]) {
    const file = path.join(dir, 'svg/equipment', `${it.id}.svg`);
    if (fs.existsSync(file)) tiles.push({ input: await sharp(fs.readFileSync(file)).resize(T - 8).png().toBuffer(), left: x + 4, top: y + k * T + 2 });
  }
  tiles.push({ input: Buffer.from(`<svg width="${T}" height="16" xmlns="http://www.w3.org/2000/svg"><text x="2" y="12" font-size="9" fill="#ddd" font-family="sans-serif">${it.id.replace('equip_', '')}</text></svg>`), left: x, top: y + 2 * T + 2 });
}
await sharp({ create: { width: C * T, height: Math.ceil(items.length / C) * ROW, channels: 3, background: '#222' } }).composite(tiles).png().toFile(out);
console.log(out);
