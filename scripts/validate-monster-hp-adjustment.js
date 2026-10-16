#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = JSON.parse(execFileSync('git', ['show', 'a5fd8b3:monsters.json'], { cwd: root, encoding: 'utf8' }));
const currentBytes = fs.readFileSync(path.join(root, 'monsters.json'));
const publicBytes = fs.readFileSync(path.join(root, 'apps/frontend/public/data/monsters.json'));
assert.equal(currentBytes.equals(publicBytes), true, 'root and frontend monster catalogues must be byte-identical');
const current = JSON.parse(currentBytes.toString('utf8'));
const baselineById = new Map(baseline.monsters.map(monster => [monster.id, monster]));
assert.equal(current.monsters.length, baseline.monsters.length, 'monster count cannot change in the HP-only adjustment');
for (const monster of current.monsters) {
  const before = baselineById.get(monster.id);
  assert.ok(before, `baseline contains ${monster.id}`);
  const expected = structuredClone(before);
  if (Number(before.level) >= 15) expected.hp = Math.max(1, Math.round(Number(before.hp) * 0.60));
  assert.deepEqual(monster, expected, `${monster.id} may only have the approved HP transformation`);
}
assert.equal(current.monsters.filter(monster => Number(monster.level) >= 15).length, 17, 'expected exactly 17 level-15+ monster rows');
console.log('monster HP adjustment validation: passed (HP-only 0.60 transform from a5fd8b3; root/public mirrors byte-identical)');
