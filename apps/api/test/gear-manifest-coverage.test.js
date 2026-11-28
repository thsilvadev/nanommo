// Direct-execution Node test, run from the repo root:
//   node apps/api/test/gear-manifest-coverage.test.js
// Every equipment item that is not an accessory has a 3D visual in the gear manifest, and the files exist.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '../../..');
const gearDir = path.join(repo, 'apps/frontend/public/assets/character/gear');
const items = JSON.parse(fs.readFileSync(path.join(repo, 'items.json'), 'utf8')).equipment;
const manifest = JSON.parse(fs.readFileSync(path.join(gearDir, 'manifest.json'), 'utf8'));

const wearable = items.filter((i) => i.slot !== 'accessory');
assert.equal(wearable.length, 64, 'non-accessory equipment count changed: update the gear pipeline');
const missing = wearable.filter((i) => !manifest.visuals[manifest.items[i.id]]).map((i) => i.id);
assert.deepEqual(missing, [], `items without a 3D visual: ${missing.join(', ')}`);
for (const i of wearable) {
  const v = manifest.visuals[manifest.items[i.id]];
  assert.equal(v.slot, i.slot, `${i.id}: visual slot ${v.slot} != item slot ${i.slot}`);
  if (i.weaponType) assert.equal(v.weaponType, i.weaponType, `${i.id}: weapon type`);
}
for (const f of [manifest.atlas, 'gear-male.glb', 'gear-female.glb', 'gear-rigid.glb']) assert.ok(fs.existsSync(path.join(gearDir, f)), `missing ${f}`);
console.log(`gear manifest covers all ${wearable.length} wearable items`);
