// Source contract: monster models are cached across reloads like character assets; the manifest stays fresh
// (a new GLB set must never be paired with an old manifest).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../vercel.json'), 'utf8'));
const rules = (vercel.headers ?? []).map((h) => ({
  re: new RegExp('^' + h.source.replace(/:\w+\(([^)]*)\)/g, '($1)') + '$'),
  cache: (h.headers.find((x) => x.key.toLowerCase() === 'cache-control') ?? {}).value,
}));
const match = (url) => rules.find((r) => r.re.test(url));

const glb = match('/assets/monsters/fieldbat.glb');
assert.ok(glb, 'a header rule matches monster GLBs');
assert.equal(glb.cache, 'public, max-age=86400, stale-while-revalidate=604800');
assert.equal(match('/assets/monsters/manifest.json'), undefined, 'the monster manifest is not cached');
console.log('ok');
