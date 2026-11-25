// Checks that animations.glb carries every clip the viewers and the arena play, and prints their lengths.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = path.join(ROOT, 'apps/frontend/public/assets/character/animations.glb');
const REQUIRED = ['Idle', 'Walk', 'Attack', 'Damage', 'Dead', 'CombatIdle', 'CastStart', 'CastLoop', 'Damage2', 'Gather', 'Sprint'];

const glb = fs.readFileSync(FILE);
const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
const bin = glb.subarray(20 + glb.readUInt32LE(12) + 8);
const lengths = new Map();
for (const animation of json.animations ?? []) {
  let max = 0;
  for (const sampler of animation.samplers) {
    const accessor = json.accessors[sampler.input];
    max = Math.max(max, accessor.max?.[0] ?? 0);
  }
  lengths.set(animation.name, max);
}
void bin;
for (const [name, seconds] of [...lengths].sort()) console.log(`${name.padEnd(12)} ${seconds.toFixed(3)} s`);
const missing = REQUIRED.filter((name) => !lengths.has(name));
if (missing.length) { console.error(`missing clips: ${missing.join(', ')}`); process.exit(1); }
console.log('all required clips present');
