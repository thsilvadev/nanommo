/**
 * Builds a character's skin texture on a 2D canvas: tints the base body
 * texture to the chosen skin tone, darkens the painted underwear, and bakes
 * decals (mouth, painted facial hair, tattoos) into it.
 *
 * Decals are positioned in 3D (metres, body bind pose) and baked triangle by
 * triangle into texture space, so UV seams, island orientation and texel
 * density are handled by the mesh itself. No three.js dependency.
 */

export type Vec3 = readonly [number, number, number];

export interface BodySurface {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  uvs: ArrayLike<number>;
  index: ArrayLike<number> | null;
}

export interface Decal {
  image: CanvasImageSource & { width: number; height: number };
  /** Centre of the decal on (or near) the body surface. */
  center: Vec3;
  /** Direction the decal is projected from (pointing away from the body). Unit length. */
  normal: Vec3;
  /** Image "up" on the body. Unit length, perpendicular to `normal`. */
  up: Vec3;
  width: number;
  height: number;
  /** Only surface within this distance of the decal plane is painted. */
  depth: number;
  /** Replaces the image colour (keeping its alpha). */
  tint?: string;
  alpha?: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex([r, g, b]: readonly number[]): string {
  return '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

/** How much a texel looks like skin (warm) rather than the grey painted underwear: 0..1. */
function skinWeight(r: number, b: number): number {
  return Math.max(0, Math.min(1, ((r - b) / 255 - 0.05) / 0.12));
}

/** Average colour of the skin texels of a base texture, used as the tint reference. */
export function averageSkinColor(pixels: Uint8ClampedArray): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    if (skinWeight(pixels[i], pixels[i + 2]) < 0.9) continue;
    r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : [200, 150, 120];
}

const CLOTH_SHADE = 0.3;

/** Recolours skin texels towards `skin`; darkens the painted underwear. Mutates `out`. */
export function tintSkinPixels(base: Uint8ClampedArray, out: Uint8ClampedArray, reference: readonly number[], skin: readonly number[]): void {
  const ratio = [skin[0] / reference[0], skin[1] / reference[1], skin[2] / reference[2]];
  for (let i = 0; i < base.length; i += 4) {
    const r = base[i], g = base[i + 1], b = base[i + 2];
    const w = skinWeight(r, b);
    const k = 1 - w;
    out[i] = r * (w * ratio[0] + k * CLOTH_SHADE);
    out[i + 1] = g * (w * ratio[1] + k * CLOTH_SHADE);
    out[i + 2] = b * (w * ratio[2] + k * CLOTH_SHADE);
    out[i + 3] = 255;
  }
}

function tinted(image: Decal['image'], tint: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Paints `decal` into a texture of `size`×`size` pixels. Every front-facing
 * triangle inside the decal box is drawn at its own UV position with the
 * image affinely mapped onto it.
 */
export function bakeDecal(ctx: CanvasRenderingContext2D, surface: BodySurface, decal: Decal, size: number): void {
  const right = cross(decal.up, decal.normal);
  const image = decal.tint ? tinted(decal.image, decal.tint) : decal.image;
  const iw = decal.image.width, ih = decal.image.height;
  const { positions: P, normals: N, uvs: UV } = surface;
  const count = surface.index ? surface.index.length : P.length / 3;
  const vertex = (k: number) => (surface.index ? surface.index[k] : k);

  ctx.save();
  ctx.globalAlpha = decal.alpha ?? 1;
  const s = [0, 0, 0], t = [0, 0, 0], ux = [0, 0, 0], uy = [0, 0, 0];
  for (let tri = 0; tri < count; tri += 3) {
    let facing = 0, inside = true, nearPlane = false;
    let sMin = Infinity, sMax = -Infinity, tMin = Infinity, tMax = -Infinity;
    for (let c = 0; c < 3; c++) {
      const v = vertex(tri + c);
      const p: Vec3 = [P[v * 3] - decal.center[0], P[v * 3 + 1] - decal.center[1], P[v * 3 + 2] - decal.center[2]];
      facing += N[v * 3] * decal.normal[0] + N[v * 3 + 1] * decal.normal[1] + N[v * 3 + 2] * decal.normal[2];
      if (Math.abs(dot(p, decal.normal)) <= decal.depth) nearPlane = true;
      s[c] = (dot(p, right) / decal.width + 0.5) * iw;
      t[c] = (0.5 - dot(p, decal.up) / decal.height) * ih;
      ux[c] = UV[v * 2] * size;
      uy[c] = UV[v * 2 + 1] * size;
      sMin = Math.min(sMin, s[c]); sMax = Math.max(sMax, s[c]); tMin = Math.min(tMin, t[c]); tMax = Math.max(tMax, t[c]);
    }
    if (facing / 3 < 0.25 || !nearPlane) inside = false;
    if (sMax < 0 || sMin > iw || tMax < 0 || tMin > ih) inside = false;
    if (!inside) continue;

    const denom = s[0] * (t[1] - t[2]) + s[1] * (t[2] - t[0]) + s[2] * (t[0] - t[1]);
    if (Math.abs(denom) < 1e-6) continue;
    const a = (ux[0] * (t[1] - t[2]) + ux[1] * (t[2] - t[0]) + ux[2] * (t[0] - t[1])) / denom;
    const b = (uy[0] * (t[1] - t[2]) + uy[1] * (t[2] - t[0]) + uy[2] * (t[0] - t[1])) / denom;
    const c = (ux[0] * (s[2] - s[1]) + ux[1] * (s[0] - s[2]) + ux[2] * (s[1] - s[0])) / denom;
    const d = (uy[0] * (s[2] - s[1]) + uy[1] * (s[0] - s[2]) + uy[2] * (s[1] - s[0])) / denom;
    const e = (ux[0] * (s[1] * t[2] - s[2] * t[1]) + ux[1] * (s[2] * t[0] - s[0] * t[2]) + ux[2] * (s[0] * t[1] - s[1] * t[0])) / denom;
    const f = (uy[0] * (s[1] * t[2] - s[2] * t[1]) + uy[1] * (s[2] * t[0] - s[0] * t[2]) + uy[2] * (s[0] * t[1] - s[1] * t[0])) / denom;

    // Clip to the triangle, grown by ~0.75 px so neighbouring triangles leave no hairline gaps.
    const cx = (ux[0] + ux[1] + ux[2]) / 3, cy = (uy[0] + uy[1] + uy[2]) / 3;
    ctx.save();
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const dx = ux[k] - cx, dy = uy[k] - cy;
      const len = Math.hypot(dx, dy) || 1;
      const x = ux[k] + (dx / len) * 0.75, y = uy[k] + (dy / len) * 0.75;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** Colour of the texture at a UV coordinate (0..1). */
export function sampleColor(ctx: CanvasRenderingContext2D, u: number, v: number, size: number): string {
  const x = Math.max(0, Math.min(size - 3, Math.round(u * size) - 1));
  const y = Math.max(0, Math.min(size - 3, Math.round(v * size) - 1));
  const data = ctx.getImageData(x, y, 3, 3).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; }
  return rgbToHex(sum.map((c) => c / 9));
}
