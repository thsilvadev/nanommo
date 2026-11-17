#!/usr/bin/env node
/**
 * Draws the face/body overlay motifs (mouths, painted facial hair, tattoos)
 * from the SVG below and writes them as PNGs to
 * apps/frontend/public/assets/character/{face,tattoo}/.
 *
 *   cd tools/character-assets && npm install && node build-overlays.mjs
 *
 * Original artwork for this project; needs no source pack. The viewer projects
 * each motif onto the body as a decal, so every image is drawn as seen from
 * the front, centred, with "up" towards the top of the image.
 *
 * Facial hair and the mouth cover are white: the viewer tints them (hair
 * colour / sampled skin tone). Mouths and tattoos keep their own colours.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../apps/frontend/public/assets/character');

/** Deterministic PRNG so the stubble pattern is identical on every run. */
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svg = (w, h, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;

/** Lips: upper and lower shapes in a 256×128 box centred on the mouth line (y = 64). */
function lips({ width, upper, lower, corner = 0, tilt = 0, color, line, gloss = false }) {
  const l = 128 - width / 2, r = 128 + width / 2;
  const cl = 64 + corner + tilt, cr = 64 + corner - tilt;
  const top = `M ${l} ${cl} C ${l + width * 0.2} ${64 - upper * 0.6}, ${128 - width * 0.12} ${64 - upper * 1.15}, 128 ${64 - upper * 0.75} C ${128 + width * 0.12} ${64 - upper * 1.15}, ${r - width * 0.2} ${64 - upper * 0.6}, ${r} ${cr} C ${r - width * 0.25} ${66}, ${l + width * 0.25} ${66}, ${l} ${cl} Z`;
  const bottom = `M ${l} ${cl} C ${l + width * 0.25} ${66}, ${r - width * 0.25} ${66}, ${r} ${cr} C ${r - width * 0.15} ${64 + lower * 1.1}, ${l + width * 0.15} ${64 + lower * 1.1}, ${l} ${cl} Z`;
  const seam = `M ${l + 2} ${cl} C ${l + width * 0.25} ${66}, ${r - width * 0.25} ${66}, ${r - 2} ${cr}`;
  const shine = gloss ? `<ellipse cx="128" cy="${64 + lower * 0.55}" rx="${width * 0.14}" ry="${Math.max(2, lower * 0.18)}" fill="#ffffff" opacity="0.28"/>` : '';
  return svg(256, 128, `<g filter="url(#soft)"><path d="${top}" fill="${color}"/><path d="${bottom}" fill="${color}"/>${shine}<path d="${seam}" stroke="${line}" stroke-width="3" fill="none" stroke-linecap="round"/></g>`,
    '<filter id="soft"><feGaussianBlur stdDeviation="1.1"/></filter>');
}

/** Soft white ellipse: the viewer tints it with the sampled skin tone to hide the original painted lips. */
const mouthCover = svg(256, 128, '<ellipse cx="128" cy="64" rx="112" ry="52" fill="url(#g)"/>',
  '<radialGradient id="g"><stop offset="0.62" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>');

/**
 * Stubble: speckles over upper lip, jaw and chin, with the mouth left clear.
 * 256×256 box: mouth line at y = 96, chin at y ≈ 190.
 */
function stubble() {
  const rand = mulberry32(1337);
  const dots = [];
  for (let i = 0; i < 2600; i++) {
    const x = rand() * 256, y = rand() * 256;
    const dx = (x - 128) / 118, dy = (y - 120) / 120;
    if (dx * dx + dy * dy > 1) continue;            // face outline
    if (y < 52) continue;                            // below the nose only
    if (y < 80 && Math.abs(x - 128) > 70) continue;  // cheeks stay clean above the mouth corners
    const mx = (x - 128) / 52, my = (y - 96) / 13;
    if (mx * mx + my * my < 1) continue;             // mouth opening
    const fade = Math.min(1, (y - 52) / 26);
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.9 + rand() * 0.9).toFixed(2)}" fill="#fff" opacity="${(0.35 + rand() * 0.45) * fade}"/>`);
  }
  return svg(256, 256, dots.join(''));
}

/** Mustache: 256×96, centred on the upper lip. */
const mustache = svg(256, 96, `<g filter="url(#soft)"><path d="M 128 34 C 104 22, 70 26, 44 54 C 40 60, 46 66, 54 62 C 76 50, 102 50, 128 50 C 154 50, 180 50, 202 62 C 210 66, 216 60, 212 54 C 186 26, 152 22, 128 34 Z" fill="#fff"/></g>`,
  '<filter id="soft"><feGaussianBlur stdDeviation="1.4"/></filter>');

/** Goatee: 256×256, mouth line at y = 64; chin beard plus a thin mustache. */
const goatee = svg(256, 256, `<g filter="url(#soft)"><path d="M 128 18 C 108 14, 86 22, 74 40 C 72 44, 76 46, 80 44 C 94 34, 112 32, 128 34 C 144 32, 162 34, 176 44 C 180 46, 184 44, 182 40 C 170 22, 148 14, 128 18 Z" fill="#fff"/><path d="M 92 92 C 96 150, 112 196, 128 206 C 144 196, 160 150, 164 92 C 150 104, 140 110, 128 110 C 116 110, 106 104, 92 92 Z" fill="#fff"/></g>`,
  '<filter id="soft"><feGaussianBlur stdDeviation="1.6"/></filter>');

const INK = '#1e2533';
const tattooDefs = '<filter id="ink"><feGaussianBlur stdDeviation="0.6"/></filter>';

/** Arm band: 512×192, wraps the upper arm; long axis along the arm. */
const armBand = svg(512, 192, `<g filter="url(#ink)" fill="none" stroke="${INK}" stroke-linecap="round" opacity="0.88">
  <path d="M 0 40 L 512 40" stroke-width="12"/><path d="M 0 152 L 512 152" stroke-width="12"/>
  ${Array.from({ length: 8 }, (_, i) => { const x = 32 + i * 64; return `<path d="M ${x - 26} 136 L ${x} 60 L ${x + 26} 136" stroke-width="10"/>`; }).join('')}
</g>`, tattooDefs);

/** Chest sigil: 256×256 rune circle. */
const chestSigil = svg(256, 256, `<g filter="url(#ink)" fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round" opacity="0.88">
  <circle cx="128" cy="128" r="104" stroke-width="9"/><circle cx="128" cy="128" r="84" stroke-width="3"/>
  <path d="M 128 52 L 128 204 M 88 92 L 128 128 L 168 92 M 96 176 L 128 148 L 160 176" stroke-width="10"/>
  ${Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; const x = 128 + Math.cos(a) * 94, y = 128 + Math.sin(a) * 94; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${INK}" stroke="none"/>`; }).join('')}
</g>`, tattooDefs);

/** Face marks: 512×160, two pairs of cheek stripes; the centre (nose) stays clear. */
const faceMarks = svg(512, 160, `<g filter="url(#ink)" stroke="${INK}" stroke-linecap="round" opacity="0.85" fill="none">
  <path d="M 40 58 L 150 72" stroke-width="12"/><path d="M 48 98 L 150 104" stroke-width="12"/>
  <path d="M 472 58 L 362 72" stroke-width="12"/><path d="M 464 98 L 362 104" stroke-width="12"/>
</g>`, tattooDefs);

/** Shoulder knot: 256×256 interlaced knot, seen from above the shoulder. */
const shoulderKnot = svg(256, 256, `<g filter="url(#ink)" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round" opacity="0.88">
  <path d="M 128 28 C 200 28, 228 100, 176 128 C 228 156, 200 228, 128 228 C 56 228, 28 156, 80 128 C 28 100, 56 28, 128 28 Z"/>
  <path d="M 80 128 C 110 108, 146 108, 176 128 C 146 148, 110 148, 80 128 Z"/>
  <circle cx="128" cy="128" r="14" fill="${INK}" stroke="none"/>
</g>`, tattooDefs);

const FILES = {
  'face/mouth_cover.png': mouthCover,
  'face/mouth_m_thin.png': lips({ width: 150, upper: 14, lower: 17, color: '#a35d55', line: '#5b2b27' }),
  'face/mouth_m_wide.png': lips({ width: 205, upper: 19, lower: 23, color: '#a96259', line: '#5b2b27' }),
  'face/mouth_m_stern.png': lips({ width: 170, upper: 13, lower: 16, corner: 7, color: '#9a5852', line: '#4f2522' }),
  'face/mouth_m_smirk.png': lips({ width: 170, upper: 17, lower: 20, tilt: 6, color: '#a95f57', line: '#5b2b27' }),
  'face/mouth_f_full.png': lips({ width: 175, upper: 24, lower: 30, color: '#c46a6c', line: '#6e2c33', gloss: true }),
  'face/mouth_f_thin.png': lips({ width: 160, upper: 12, lower: 15, color: '#b8676a', line: '#6a2d32' }),
  'face/mouth_f_dark.png': lips({ width: 170, upper: 20, lower: 25, color: '#6b2539', line: '#2c0c16', gloss: true }),
  'face/mouth_f_smile.png': lips({ width: 178, upper: 18, lower: 22, corner: -7, color: '#c06b6b', line: '#6e2c33', gloss: true }),
  'face/facial_m_stubble.png': stubble(),
  'face/facial_m_mustache.png': mustache,
  'face/facial_m_goatee.png': goatee,
  'tattoo/arm_band.png': armBand,
  'tattoo/chest_sigil.png': chestSigil,
  'tattoo/face_marks.png': faceMarks,
  'tattoo/shoulder_knot.png': shoulderKnot,
};

const report = [];
for (const [file, source] of Object.entries(FILES)) {
  const out = path.join(OUT, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(Buffer.from(source)).png({ compressionLevel: 9, palette: false }).toFile(out);
  report.push(`${file} ${(fs.statSync(out).size / 1024).toFixed(1)} kB`);
}
console.log(report.join('\n'));
