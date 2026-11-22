/** One texture atlas for all gear: images (or flat-colour swatches) packed on shelves, deterministic. */
import sharp from 'sharp';

const SWATCH = 8;
const MAX = 4096;

/**
 * entries: { id, image: Buffer|null, color?: [r,g,b] (0..1), tint?: '#rrggbb', hue?: degrees, colorize?: '#rrggbb' (greyscale then tint), brightness?: factor, size: 256|512|1024 }
 * Returns the atlas PNG, its size and per-id rects in UV units (x, y, w, h; y from the top, as glTF UVs).
 */
export async function packAtlas(entries) {
  const items = entries.map((e) => ({ ...e, px: e.image ? e.size : SWATCH }))
    .sort((a, b) => b.px - a.px || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let size = 256;
  let placed;
  for (; size <= MAX; size *= 2) { placed = shelfPack(items, size); if (placed) break; }
  if (!placed) throw new Error(`gear atlas does not fit in ${MAX}px`);
  const composites = [];
  const rects = new Map();
  for (const it of items) {
    const { x, y } = placed.get(it.id);
    let input;
    if (it.image) {
      let img = sharp(it.image).resize(it.px, it.px, { fit: 'fill' }).removeAlpha();
      if (it.colorize) img = sharp(await img.greyscale().normalise().png().toBuffer()).tint(it.colorize);
      if (it.brightness) img = img.modulate({ brightness: it.brightness });
      if (it.hue) img = img.modulate({ hue: it.hue });
      if (it.tint) img = img.tint(it.tint);
      input = await img.png().toBuffer();
    } else {
      const [r, g, b] = (it.color ?? [1, 1, 1]).map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255));
      let sw = sharp(await sharp({ create: { width: SWATCH, height: SWATCH, channels: 3, background: { r, g, b } } }).png().toBuffer());
      if (it.hue) sw = sw.modulate({ hue: it.hue });
      if (it.tint) sw = sw.tint(it.tint);
      input = await sw.png().toBuffer();
    }
    composites.push({ input, left: x, top: y });
    // inset by one texel so bilinear filtering never reads the neighbour
    rects.set(it.id, { x: (x + 1) / size, y: (y + 1) / size, w: (it.px - 2) / size, h: (it.px - 2) / size, swatch: !it.image });
  }
  const png = await sharp({ create: { width: size, height: size, channels: 3, background: '#000000' } })
    .composite(composites).png({ compressionLevel: 9 }).toBuffer();
  return { png, size, rects };
}

function shelfPack(items, size) {
  const placed = new Map();
  let x = 0, y = 0, shelf = 0;
  for (const it of items) {
    if (x + it.px > size) { x = 0; y += shelf; shelf = 0; }
    if (y + it.px > size) return null;
    placed.set(it.id, { x, y });
    x += it.px;
    shelf = Math.max(shelf, it.px);
  }
  return placed;
}

/** Moves a primitive's TEXCOORD_0 into its atlas rect (UVs outside [0,1] wrap first; swatches use the centre). */
export function remapUVs(prim, rect) {
  let uv = prim.getAttribute('TEXCOORD_0');
  const count = prim.getAttribute('POSITION').getCount();
  const out = new Float32Array(count * 2);
  const wrap = (t) => (t >= 0 && t <= 1 ? t : t - Math.floor(t));
  for (let i = 0; i < count; i++) {
    const [u, v] = rect.swatch || !uv ? [0.5, 0.5] : uv.getElement(i, []);
    out[i * 2] = rect.x + wrap(u) * rect.w;
    out[i * 2 + 1] = rect.y + wrap(v) * rect.h;
  }
  if (!uv) {
    uv = prim.getAttribute('POSITION').clone().setType('VEC2');
    prim.setAttribute('TEXCOORD_0', uv);
  }
  uv.setArray(out);
}

/**
 * The atlas as shipped (WebP). Lossy WebP subsamples chroma (4:2:0), which smeared small flat-colour
 * swatches into their neighbours (black armour turned teal): near-lossless keeps full chroma.
 */
export function encodeAtlas(png) {
  return sharp(png).webp({ nearLossless: true, quality: 80, effort: 6 }).toBuffer();
}
