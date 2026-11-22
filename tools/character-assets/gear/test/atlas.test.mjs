import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { packAtlas, remapUVs } from '../lib/atlas.mjs';
import { simplifyTo } from '../lib/simplify.mjs';
import { boxDoc, gridDoc } from './fixtures.mjs';

const png = (color) => sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
const entries = async () => [
  { id: 'a', image: await png('#ff0000'), size: 512 },
  { id: 'b', image: await png('#00ff00'), size: 512, tint: '#808080' },
  { id: 'c', image: null, color: [0, 0, 1], size: 256 },
];
const overlap = (r, s) => r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h;

test('two 512 images and a swatch pack into a 1024 atlas without overlap, deterministically', async () => {
  const first = await packAtlas(await entries());
  const second = await packAtlas(await entries());
  assert.equal(first.size, 1024);
  const rects = [...first.rects.values()];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!overlap(rects[i], rects[j]));
  assert.ok(first.png.equals(second.png));
});

test('UVs outside [0,1] wrap, then land inside their rect', async () => {
  const { rects } = await packAtlas(await entries());
  const { prim } = boxDoc([0, 0, 0], [1, 1, 1]);
  const uv = prim.getAttribute('TEXCOORD_0');
  uv.setArray(new Float32Array(16).map((_, i) => (i % 2 ? -0.5 : 1.25)));
  remapUVs(prim, rects.get('a'));
  const r = rects.get('a');
  for (let i = 0; i < uv.getCount(); i++) {
    const [u, v] = uv.getElement(i, []);
    assert.ok(u >= r.x && u <= r.x + r.w && v >= r.y && v <= r.y + r.h, `${u},${v}`);
  }
});

test('simplifyTo brings a 2048-triangle grid under 500 triangles', async () => {
  const { doc } = gridDoc(32);
  const tris = await simplifyTo(doc, 500);
  assert.ok(tris <= 500 && tris > 0, String(tris));
});
