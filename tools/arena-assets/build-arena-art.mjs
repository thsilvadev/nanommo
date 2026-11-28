// Battle-arena scenery: per region, three parallax layers (sky, far, near; 2048×512)
// and a tiling ground texture (512×512), painted procedurally as SVG and encoded
// with sharp. Every layer wraps horizontally (and the ground both ways): shapes
// that cross an edge are drawn again one period over, and ridges are sums of
// whole-period sines. Seeded, so a rebuild gives the same pictures.
//
// Run: node tools/arena-assets/build-arena-art.mjs [region…]
// Output: apps/frontend/public/assets/arena/<region>/{sky,far,near,ground}.webp
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
// sharp is already installed for the character tools.
const sharp = createRequire(path.join(ROOT, 'tools/character-assets/package.json'))('sharp');
const OUT = path.join(ROOT, 'apps/frontend/public/assets/arena');
const W = 2048, H = 512, G = 512;

// ---- helpers -------------------------------------------------------------------
function rng(seedText) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const range = (r, lo, hi) => lo + (hi - lo) * r();
/** A ridge that wraps every `period` px: whole-period sines. */
function ridge(r, { base, amp, octaves = 5, period = W }) {
  const waves = Array.from({ length: octaves }, (_, i) => ({ k: Math.round(range(r, 1, 3) * 2 ** i), a: amp / (1.7 ** i), p: range(r, 0, Math.PI * 2) }));
  return (x) => base - waves.reduce((s, w) => s + w.a * Math.sin((2 * Math.PI * w.k * x) / period + w.p), 0);
}
function ridgePath(f, bottom, step = 8, width = W) {
  let d = `M0,${bottom} `;
  for (let x = 0; x <= width; x += step) d += `L${x},${f(x).toFixed(1)} `;
  return d + `L${width},${bottom} Z`;
}
/** Draws `make(dx)` at dx = −W, 0, W so anything crossing an edge wraps. */
const wrap = (make, period = W) => [-period, 0, period].map(make).join('');
const svg = (w, h, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;
const blur = (id, s) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${s}"/></filter>`;
const vgrad = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;

// ---- building blocks -----------------------------------------------------------
function clouds(r, { count = 9, y = [40, 210], color = '#ffffff', opacity = 0.9, size = 1 }) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const cx = range(r, 0, W), cy = range(r, y[0], y[1]), s = range(r, 0.6, 1.4) * size;
    const puffs = Array.from({ length: 6 }, () => ({ dx: range(r, -90, 90) * s, dy: range(r, -18, 10) * s, rx: range(r, 40, 90) * s, ry: range(r, 22, 40) * s }));
    out += wrap((dx) => puffs.map((p) => `<ellipse cx="${cx + dx + p.dx}" cy="${cy + p.dy}" rx="${p.rx}" ry="${p.ry}"/>`).join(''));
  }
  return `<g fill="${color}" opacity="${opacity}" filter="url(#soft)">${out}</g>`;
}
function sky(top, bottom, extra = '') {
  return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#sky)"/>${extra}`, vgrad('sky', [[0, top], [1, bottom]]) + blur('soft', 6) + blur('haze', 18));
}
function mountains(r, { base, amp, fill, shade, snow = null, snowLine = 0 }) {
  const f = ridge(r, { base, amp });
  let body = `<path d="${ridgePath(f, H)}" fill="${fill}"/>`;
  if (shade) body += `<path d="${ridgePath((x) => f(x) + 26, H)}" fill="${shade}" opacity="0.55"/>`;
  if (snow) {
    let d = '';
    for (let x = 0; x <= W; x += 8) { const y = f(x); d += `${d ? 'L' : 'M'}${x},${Math.min(y, snowLine).toFixed(1)} `; }
    for (let x = W; x >= 0; x -= 8) d += `L${x},${Math.min(f(x) + 30, snowLine).toFixed(1)} `;
    body += `<path d="${d}Z" fill="${snow}" opacity="0.92"/>`;
  }
  return body;
}
/** A line of round-canopy trees along a ridge. */
function treeline(r, { base, amp, count, size, colors, trunk = '#3b2a1c', spread = 1 }) {
  const f = ridge(r, { base, amp, octaves: 3 });
  let out = `<path d="${ridgePath((x) => f(x) + size * 0.6, H)}" fill="${colors[0]}"/>`;
  for (let i = 0; i < count; i++) {
    const x = (i / count) * W + range(r, -20, 20) * spread, y = f(x), s = size * range(r, 0.7, 1.3);
    const c = colors[Math.floor(r() * colors.length)];
    out += wrap((dx) => `<rect x="${x + dx - s * 0.06}" y="${y}" width="${s * 0.12}" height="${s * 0.9}" fill="${trunk}"/>`
      + `<ellipse cx="${x + dx}" cy="${y - s * 0.15}" rx="${s * 0.55}" ry="${s * 0.5}" fill="${c}"/>`
      + `<ellipse cx="${x + dx - s * 0.25}" cy="${y + s * 0.05}" rx="${s * 0.38}" ry="${s * 0.33}" fill="${c}"/>`
      + `<ellipse cx="${x + dx + s * 0.27}" cy="${y + s * 0.02}" rx="${s * 0.4}" ry="${s * 0.35}" fill="${c}"/>`
      + `<ellipse cx="${x + dx - s * 0.1}" cy="${y - s * 0.32}" rx="${s * 0.22}" ry="${s * 0.16}" fill="#ffffff" opacity="0.08"/>`);
  }
  return out;
}
function pines(r, { base, count, size, color, snow = null }) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = range(r, 0, W), y = base + range(r, -12, 12), s = size * range(r, 0.7, 1.3);
    out += wrap((dx) => `<path d="M${x + dx},${y - s} L${x + dx + s * 0.32},${y} L${x + dx - s * 0.32},${y} Z" fill="${color}"/>`
      + (snow ? `<path d="M${x + dx},${y - s} L${x + dx + s * 0.1},${y - s * 0.68} L${x + dx - s * 0.1},${y - s * 0.68} Z" fill="${snow}"/>` : ''));
  }
  return out;
}
function bushes(r, { count, y, size, colors, opacity = 1 }) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = range(r, 0, W), cy = y + range(r, -10, 30), s = size * range(r, 0.6, 1.4), c = colors[Math.floor(r() * colors.length)];
    out += wrap((dx) => [0, 1, 2, 3].map((k) => `<ellipse cx="${x + dx + (k - 1.5) * s * 0.45}" cy="${cy - Math.sin(k + 0.5) * s * 0.25}" rx="${s * 0.42}" ry="${s * 0.36}" fill="${c}"/>`).join(''));
  }
  return `<g opacity="${opacity}">${out}</g>`;
}
function grassTufts(r, { count, y, height, colors }) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = range(r, 0, W), by = y + range(r, 0, H - y), h = height * range(r, 0.5, 1.3), c = colors[Math.floor(r() * colors.length)];
    const blades = Array.from({ length: 5 }, (_, k) => { const lean = range(r, -0.5, 0.5) * h; return `M${x + k * 3},${by} Q${x + k * 3 + lean * 0.3},${by - h * 0.6} ${x + k * 3 + lean},${by - h}`; });
    out += wrap((dx) => `<path d="${blades.join(' ')}" transform="translate(${dx},0)" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
  }
  return out;
}
function rocks(r, { count, y, size, colors }) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = range(r, 0, W), by = y + range(r, 0, 60), s = size * range(r, 0.5, 1.5), c = colors[Math.floor(r() * colors.length)];
    const pts = Array.from({ length: 7 }, (_, k) => { const a = Math.PI + (k / 6) * Math.PI; const rr = s * range(r, 0.7, 1.1); return [Math.cos(a) * rr * 1.3, Math.sin(a) * rr * 0.8]; });
    out += wrap((dx) => `<path d="M${pts.map(([px, py]) => `${(x + dx + px).toFixed(1)},${(by + py).toFixed(1)}`).join(' L')} Z" fill="${c}"/>`
      + `<path d="M${(x + dx - s * 0.6).toFixed(1)},${(by - s * 0.45).toFixed(1)} L${(x + dx + s * 0.2).toFixed(1)},${(by - s * 0.7).toFixed(1)}" stroke="#ffffff" stroke-opacity="0.18" stroke-width="3"/>`);
  }
  return out;
}
function ferns(r, { count, y, size, colors }) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = range(r, 0, W), by = y + range(r, 0, H - y), s = size * range(r, 0.6, 1.4), c = colors[Math.floor(r() * colors.length)];
    const fronds = Array.from({ length: 7 }, (_, k) => { const a = -Math.PI / 2 + (k - 3) * 0.32; return `M${x},${by} Q${x + Math.cos(a) * s * 0.5},${by + Math.sin(a) * s * 0.8} ${x + Math.cos(a) * s},${by + Math.sin(a) * s * 0.75}`; });
    out += wrap((dx) => `<path d="${fronds.join(' ')}" transform="translate(${dx},0)" stroke="${c}" stroke-width="${s * 0.09}" fill="none" stroke-linecap="round"/>`);
  }
  return out;
}
/** Point on a quadratic Bézier. */
const qb = (a, c, b, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
/** Coconut palms: tapered, ringed, two-tone trunks; pinnate fronds drooping from the crown; coconuts. */
function palms(r, { count, y, size }) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = range(r, 0, W), s = size * range(r, 0.8, 1.2), lean = range(r, -0.4, 0.4) * s, by = y + range(r, 0, 30);
    const base = [x, by], ctrl = [x + lean * 0.15, by - s * 0.55], top = [x + lean, by - s];
    // Trunk: a polygon around the curve, wide at the foot, ringed every few percent.
    const n = 24, left = [], right = [], rings = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, [px, py] = qb(base, ctrl, top, t), [qx, qy] = qb(base, ctrl, top, Math.min(1, t + 0.01));
      const len = Math.hypot(qx - px, qy - py) || 1, nx = -(qy - py) / len, ny = (qx - px) / len, w = s * (0.045 - 0.018 * t) * (k === 0 ? 1.35 : 1);
      left.push([px + nx * w, py + ny * w]); right.push([px - nx * w, py - ny * w]);
      if (k % 2 === 1 && k < n) rings.push(`M${(px + nx * w).toFixed(1)},${(py + ny * w).toFixed(1)} Q${(px + 2).toFixed(1)},${(py + 3).toFixed(1)} ${(px - nx * w).toFixed(1)},${(py - ny * w).toFixed(1)}`);
    }
    const poly = (pts) => pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' L');
    const trunk = `<path d="M${poly(left)} L${poly([...right].reverse())} Z" fill="#8a6a44"/>`
      + `<path d="M${poly(left)} L${poly([...left].reverse().map(([a, b], k) => { const [c, d] = [...right].reverse()[k]; return [a * 0.62 + c * 0.38, b * 0.62 + d * 0.38]; }))} Z" fill="#a8865a" opacity="0.8"/>`
      + `<path d="${rings.join(' ')}" stroke="#5e4428" stroke-width="${(s * 0.007).toFixed(1)}" fill="none" opacity="0.8"/>`;
    // Fronds: a drooping rachis with leaflets on both sides, back ones darker.
    let fronds = '';
    const count2 = 9;
    for (let k = 0; k < count2; k++) {
      const a = -Math.PI + (k / (count2 - 1)) * Math.PI + range(r, -0.12, 0.12), back = k % 2 === 1;
      const len = s * range(r, 0.42, 0.58), droop = s * range(r, 0.18, 0.32);
      const end = [top[0] + Math.cos(a) * len, top[1] + Math.sin(a) * len * 0.35 + droop];
      const mid = [top[0] + Math.cos(a) * len * 0.55, top[1] + Math.sin(a) * len * 0.5 - s * 0.06];
      const dark = back ? '#1f6b2c' : '#2f8a38', light = back ? '#2d7c34' : '#4fa846';
      let leaflets = '';
      for (let m = 2; m <= 14; m++) {
        const t = m / 15, [px, py] = qb(top, mid, end, t), [qx, qy] = qb(top, mid, end, Math.min(1, t + 0.02));
        const l = Math.hypot(qx - px, qy - py) || 1, ux = (qx - px) / l, uy = (qy - py) / l, ll = s * 0.11 * Math.sin(Math.PI * Math.min(1, t * 1.1));
        for (const side of [-1, 1]) {
          const ex = px + (ux * 0.55 - uy * side) * ll, ey = py + (uy * 0.55 + ux * side) * ll + ll * 0.35;
          leaflets += `M${px.toFixed(1)},${py.toFixed(1)} Q${((px + ex) / 2).toFixed(1)},${((py + ey) / 2 - ll * 0.15).toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)} `;
        }
      }
      fronds += `<path d="${leaflets}" stroke="${dark}" stroke-width="${(s * 0.016).toFixed(1)}" stroke-linecap="round" fill="none"/>`
        + `<path d="${leaflets}" stroke="${light}" stroke-width="${(s * 0.006).toFixed(1)}" stroke-linecap="round" fill="none" opacity="0.7"/>`
        + `<path d="M${top[0]},${top[1]} Q${mid[0].toFixed(1)},${mid[1].toFixed(1)} ${end[0].toFixed(1)},${end[1].toFixed(1)}" stroke="#5f7a2a" stroke-width="${(s * 0.008).toFixed(1)}" fill="none"/>`;
    }
    const nuts = [[-0.03, 0.035], [0.025, 0.04], [0, 0.06]].map(([dx, dy]) => `<circle cx="${(top[0] + dx * s).toFixed(1)}" cy="${(top[1] + dy * s).toFixed(1)}" r="${(s * 0.03).toFixed(1)}" fill="#6b4a26"/>`).join('');
    out += wrap((dx) => `<g transform="translate(${dx},0)">${trunk}${fronds}${nuts}</g>`);
  }
  return out;
}
function ruins(r, { count, y, size }) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = range(r, 0, W), s = size * range(r, 0.7, 1.3), broken = r() < 0.5;
    const h = s * (broken ? range(r, 0.5, 0.8) : 1);
    out += wrap((dx) => {
      let g = `<rect x="${x + dx}" y="${y - h}" width="${s * 0.16}" height="${h}" fill="#9a9a8c"/><rect x="${x + dx - s * 0.03}" y="${y - h}" width="${s * 0.22}" height="${s * 0.05}" fill="#b4b4a4"/>`;
      g += `<rect x="${x + dx + s * 0.5}" y="${y - s}" width="${s * 0.16}" height="${s}" fill="#8e8e80"/>`;
      if (!broken) g += `<path d="M${x + dx},${y - s} Q${x + dx + s * 0.33},${y - s * 1.35} ${x + dx + s * 0.66},${y - s}" stroke="#a4a494" stroke-width="${s * 0.1}" fill="none"/>`;
      g += `<path d="M${x + dx},${y - h * 0.3} q${s * 0.08},-${s * 0.1} ${s * 0.16},0" stroke="#4f7a3a" stroke-width="${s * 0.05}" fill="none"/>`;
      return g;
    });
  }
  return out;
}
function bridge(r, { y, span, color, height = 110 }) {
  let out = '';
  for (let i = 0; i < 2; i++) {
    const x = i * W / 2 + range(r, 100, 300);
    // A stone block with an arch cut out of it (evenodd), a parapet on top.
    out += wrap((dx) => {
      const x0 = x + dx, x1 = x0 + span, inset = span * 0.12;
      return `<path fill-rule="evenodd" fill="${color}" d="M${x0},${y} L${x1},${y} L${x1},${y + height} L${x0},${y + height} Z M${x0 + inset},${y + height} Q${x0 + span / 2},${y - height * 0.15} ${x1 - inset},${y + height} Z"/>`
        + `<path d="M${x0 + inset},${y + height} Q${x0 + span / 2},${y - height * 0.15} ${x1 - inset},${y + height}" stroke="#00000030" stroke-width="5" fill="none"/>`
        + Array.from({ length: 11 }, (_, k) => `<rect x="${x0 + k * span / 10 - 5}" y="${y - 16}" width="10" height="16" fill="${color}"/>`).join('')
        + `<rect x="${x0}" y="${y - 4}" width="${span}" height="6" fill="#00000022"/>`;
    });
  }
  return out;
}

// ---- ground ----------------------------------------------------------------------
function ground(r, { base, speckles, patches, patchOpacity = 0.55, extra = '' }) {
  let body = `<rect width="${G}" height="${G}" fill="${base}"/>`;
  const both = (make) => [-G, 0, G].flatMap((dx) => [-G, 0, G].map((dy) => make(dx, dy))).join('');
  for (let i = 0; i < patches.count; i++) {
    const x = range(r, 0, G), y = range(r, 0, G), rx = range(r, 20, 70), ry = range(r, 14, 40), c = patches.colors[Math.floor(r() * patches.colors.length)];
    body += `<g filter="url(#gblur)" opacity="${patchOpacity}">${both((dx, dy) => `<ellipse cx="${x + dx}" cy="${y + dy}" rx="${rx}" ry="${ry}" fill="${c}"/>`)}</g>`;
  }
  for (let i = 0; i < speckles.count; i++) {
    const x = range(r, 0, G), y = range(r, 0, G), s = range(r, 1, speckles.size), c = speckles.colors[Math.floor(r() * speckles.colors.length)];
    const blade = speckles.blades && r() < 0.7;
    body += both((dx, dy) => blade
      ? `<path d="M${x + dx},${y + dy} l${range(r, -2, 2)},-${s * 2.2}" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`
      : `<circle cx="${x + dx}" cy="${y + dy}" r="${s * 0.6}" fill="${c}"/>`);
  }
  return svg(G, G, body + extra, blur('gblur', 10));
}

/**
 * Green Grounds: a warm meadow (yellow-green, sun-warmed) of fine blades over soft darker and lighter clumps,
 * no bare patches (the arena shader lays the golden dry-grass patches in world space, bigger than a tile).
 */
function meadow(r) {
  const both = (make) => [-G, 0, G].flatMap((dx) => [-G, 0, G].map((dy) => make(dx, dy))).join('');
  let body = `<rect width="${G}" height="${G}" fill="#6c9632"/>`;
  for (let i = 0; i < 22; i++) {
    const x = range(r, 0, G), y = range(r, 0, G), rx = range(r, 30, 90), ry = range(r, 20, 60), c = ['#557a26', '#7ea23c', '#5f8a2c', '#8aaa44'][Math.floor(r() * 4)];
    body += `<g filter="url(#gblur)" opacity="0.6">${both((dx, dy) => `<ellipse cx="${x + dx}" cy="${y + dy}" rx="${rx}" ry="${ry}" fill="${c}"/>`)}</g>`;
  }
  const blades = ['#4e7420', '#628a2a', '#76a034', '#86aa3c', '#456a1c', '#98b048', '#6e962e', '#a8b452'];
  for (let i = 0; i < 9000; i++) {
    const x = range(r, 0, G), y = range(r, 0, G), l = range(r, 4, 10), c = blades[Math.floor(r() * blades.length)], lean = range(r, -3, 3);
    body += both((dx, dy) => `<path d="M${(x + dx).toFixed(1)},${(y + dy).toFixed(1)} q${(lean * 0.3).toFixed(1)},-${(l * 0.5).toFixed(1)} ${lean.toFixed(1)},-${l.toFixed(1)}" stroke="${c}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`);
  }
  return svg(G, G, body, blur('gblur', 14));
}

/** God's Bridge deck: courses of worn stone slabs running along the bridge, dark joints, a little moss. */
function deck(r) {
  const courses = 4, h = G / courses;
  let body = '';
  for (let c = 0; c < courses; c++) {
    let x = range(r, -60, 0);
    while (x < G) {
      const w = range(r, 70, 150), tone = ['#b5a486', '#a39274', '#bcae90', '#9c8b6e', '#ad9c7e'][Math.floor(r() * 5)];
      const draw = (dx) => `<rect x="${(x + dx).toFixed(1)}" y="${c * h + 2}" width="${(w - 4).toFixed(1)}" height="${h - 4}" rx="5" fill="${tone}"/>`
        + `<rect x="${(x + dx + 4).toFixed(1)}" y="${c * h + 5}" width="${(w - 12).toFixed(1)}" height="5" fill="#ffffff" opacity="0.08"/>`;
      body += [-G, 0, G].map(draw).join('');
      x += w;
    }
  }
  for (let i = 0; i < 260; i++) {
    const x = range(r, 0, G), y = range(r, 0, G), s = range(r, 1, 4);
    body += [-G, 0, G].flatMap((dx) => [-G, 0, G].map((dy) => `<circle cx="${x + dx}" cy="${y + dy}" r="${s * 0.6}" fill="${r() < 0.3 ? '#6f7a4a' : '#7d6d55'}" opacity="0.6"/>`)).join('');
  }
  return svg(G, G, `<rect width="${G}" height="${G}" fill="#5e5242"/>` + body);
}

// ---- regions ---------------------------------------------------------------------
const REGIONS = {
  green_grounds: (r) => ({
    sky: sky('#5aa9f0', '#dff3ff', clouds(r, { count: 10 })),
    far: svg(W, H, mountains(r, { base: 300, amp: 45, fill: '#8fbf88', shade: '#79ab72' }) + treeline(r, { base: 380, amp: 18, count: 70, size: 34, colors: ['#5b9a45', '#4f8c3c', '#68a650'] })),
    near: svg(W, H, bushes(r, { count: 26, y: 470, size: 70, colors: ['#3f7d31', '#4b8c38', '#356e2b'] }) + grassTufts(r, { count: 160, y: 430, height: 26, colors: ['#5c9d3e', '#6fb04b', '#4a8a33'] })),
    ground: meadow(r),
  }),
  menace_hills: (r) => ({
    sky: sky('#e46a3a', '#ffd49a', clouds(r, { count: 6, color: '#ffe3c4', opacity: 0.55, y: [60, 180] })),
    far: svg(W, H, mountains(r, { base: 230, amp: 85, fill: '#6b4a3e', shade: '#4f3530' }) + mountains(r, { base: 330, amp: 40, fill: '#8a6248', shade: '#6d4c39' })),
    near: svg(W, H, rocks(r, { count: 22, y: 440, size: 34, colors: ['#7a5c47', '#664b3b', '#8d6c52'] }) + grassTufts(r, { count: 90, y: 440, height: 20, colors: ['#a08a4a', '#8c7a3d', '#b39a55'] })),
    ground: ground(r, { base: '#9a7f4e', patches: { count: 16, colors: ['#7d6038', '#b09460', '#8a8a4a'] }, speckles: { count: 1100, size: 4, colors: ['#7a6440', '#b49a62', '#6e5a35', '#8f8a50'], blades: false } }),
  }),
  kwaioua_forest: (r) => ({
    // Deep forest: dark greens under the canopy.
    sky: sky('#2b5233', '#9cc49a', `<g fill="#1c3d22" opacity="0.72">${wrap((dx) => Array.from({ length: 14 }, (_, i) => `<ellipse cx="${dx + i * 150 + 40}" cy="${-20 + (i % 3) * 25}" rx="150" ry="120"/>`).join(''))}</g>` + clouds(r, { count: 3, color: '#e9ffe0', opacity: 0.25, y: [140, 220] })),
    far: svg(W, H, treeline(r, { base: 225, amp: 25, count: 64, size: 95, colors: ['#1d4220', '#234d26', '#183a1b'], trunk: '#1f170f' }) + treeline(r, { base: 330, amp: 20, count: 72, size: 72, colors: ['#2a5c29', '#22522a', '#2f6430'], trunk: '#2a1f14' })),
    near: svg(W, H, ferns(r, { count: 46, y: 420, size: 82, colors: ['#1e4c1d', '#285a24', '#163c17'] }) + bushes(r, { count: 20, y: 480, size: 84, colors: ['#123512', '#1a4218', '#0f2e10'] })),
    ground: ground(r, { base: '#2e4823', patches: { count: 20, colors: ['#4a3820', '#223d19', '#54452a'] }, speckles: { count: 1600, size: 5, colors: ['#5a4428', '#3b682b', '#6b5530', '#1f3c1a'], blades: true } }),
  }),
  wastelands: (r) => ({
    sky: sky('#a9b0ba', '#eceef0', clouds(r, { count: 12, color: '#f6f6f6', opacity: 0.7, size: 1.3 })),
    far: svg(W, H, mountains(r, { base: 210, amp: 95, fill: '#7d808a', shade: '#5f636d', snow: '#f4f7fb', snowLine: 210 }) + mountains(r, { base: 340, amp: 30, fill: '#8f8676', shade: '#776f60' })),
    near: svg(W, H, rocks(r, { count: 26, y: 440, size: 30, colors: ['#7a756c', '#8c877c', '#6a655c'] }) + grassTufts(r, { count: 70, y: 450, height: 18, colors: ['#9a8f70', '#857a5c'] })),
    ground: ground(r, { base: '#8a8170', patches: { count: 14, colors: ['#e9ecef', '#a29a88', '#6f685a'] }, patchOpacity: 0.5, speckles: { count: 900, size: 4, colors: ['#6f685a', '#a59d8a', '#5f594d'], blades: false } }),
  }),
  caete: (r) => ({
    sky: sky('#7fae98', '#dcefe3', clouds(r, { count: 7, color: '#ffffff', opacity: 0.45, y: [140, 240], size: 1.6 })),
    far: svg(W, H, treeline(r, { base: 220, amp: 30, count: 55, size: 110, colors: ['#1f4a2a', '#255632', '#1b3f25'], trunk: '#1f1810' })
      + `<rect y="250" width="${W}" height="140" fill="url(#mist)"/>` + treeline(r, { base: 350, amp: 18, count: 70, size: 70, colors: ['#2e6b3a', '#2a5f35'], trunk: '#2a1f14' }), vgrad('mist', [[0, '#e6f3ec', 0], [0.5, '#e6f3ec', 0.55], [1, '#e6f3ec', 0]])),
    near: svg(W, H, ferns(r, { count: 46, y: 410, size: 95, colors: ['#1f5a2c', '#2a6a33', '#194a24'] }) + bushes(r, { count: 14, y: 490, size: 90, colors: ['#163f1f', '#1f4f27'] })),
    ground: ground(r, { base: '#4a3b26', patches: { count: 20, colors: ['#2f4f26', '#5d4a2e', '#3a5a2c'] }, speckles: { count: 1300, size: 5, colors: ['#3d5f2c', '#6a5434', '#2c4a22'], blades: true } }),
  }),
  forest_ruins: (r) => ({
    sky: sky('#78aee0', '#e2f0fb', clouds(r, { count: 8 })),
    far: svg(W, H, treeline(r, { base: 260, amp: 25, count: 60, size: 80, colors: ['#3f7a3a', '#356b33', '#4a8540'] }) + ruins(r, { count: 9, y: 400, size: 110 })),
    near: svg(W, H, rocks(r, { count: 14, y: 450, size: 30, colors: ['#8e8e80', '#a2a294', '#7a7a6c'] }) + ferns(r, { count: 18, y: 440, size: 60, colors: ['#3d7a34', '#4a8a3c'] }) + grassTufts(r, { count: 100, y: 440, height: 22, colors: ['#5a9a3e', '#4a8a33'] })),
    ground: ground(r, { base: '#5d8a3f', patches: { count: 12, colors: ['#9a9a8c', '#7d7d70', '#6b5a3a'] }, patchOpacity: 0.6, speckles: { count: 1200, size: 5, colors: ['#4d7f34', '#6f9f4b', '#8a8a7c'], blades: true } }),
  }),
  ipora_beach: (r) => ({
    sky: sky('#3fb2f5', '#e3f7ff', clouds(r, { count: 7, y: [40, 170] })),
    // Same sea gradient; crests and foam grow towards the shore, a wet band and lacy foam at the sand,
    // sun glitter and a sail far out.
    far: svg(W, H, mountains(r, { base: 292, amp: 10, fill: '#7fb07a', shade: null })
      + `<path d="${ridgePath(ridge(r, { base: 293, amp: 5, octaves: 2 }), H)}" fill="#9cc79a" opacity="0.6"/>`
      + `<rect y="290" width="${W}" height="${H - 290}" fill="url(#sea)"/>`
      + `<rect y="290" width="${W}" height="6" fill="#d8f4ff" opacity="0.55"/>`
      + Array.from({ length: 9 }, (_, row) => {
        const t = row / 8, yy = 304 + t * t * 128, amp = 1 + t * 3.5, len = 18 + t * 46, op = 0.25 + t * 0.5, w = 1 + t * 2.2;
        return `<g stroke="#ffffff" stroke-opacity="${op.toFixed(2)}" stroke-width="${w.toFixed(1)}" fill="none" stroke-linecap="round">${wrap((dx) => Array.from({ length: Math.round(26 - t * 12) }, () => { const x = range(r, 0, W) + dx, y = yy + range(r, -4, 4); return `<path d="M${x.toFixed(0)},${y.toFixed(1)} q${(len / 2).toFixed(0)},-${amp.toFixed(1)} ${len.toFixed(0)},0"/>`; }).join(''))}</g>`;
      }).join('')
      + `<g fill="#ffffff" opacity="0.8">${wrap((dx) => Array.from({ length: 60 }, () => { const x = 1150 + range(r, -160, 160) + dx, y = range(r, 300, 420); return `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${range(r, 2, 6).toFixed(1)}" ry="1"/>`; }).join(''))}</g>`
      + wrap((dx) => `<g transform="translate(${dx + 640},282)"><path d="M0,0 L22,0 L18,6 L4,6 Z" fill="#6b4a2e"/><path d="M11,-1 L11,-30 L24,-3 Z" fill="#ffffff"/><path d="M10,-3 L10,-22 L1,-3 Z" fill="#f2efe6"/></g>`)
      + `<path d="${ridgePath(ridge(r, { base: 436, amp: 9, octaves: 3 }), H)}" fill="#cdb67e"/>`
      + `<path d="${ridgePath(ridge(r, { base: 432, amp: 9, octaves: 3 }), H, 6).replace(/ Z$/, '').replace(/^M0,\d+ /, 'M').replace(/L\d+,${H} $/, '')}" stroke="#ffffff" stroke-width="5" fill="none" opacity="0.85" stroke-dasharray="26 6 9 5"/>`
      + `<path d="${ridgePath(ridge(r, { base: 446, amp: 12, octaves: 3 }), H)}" fill="#ecd9a2"/>`, vgrad('sea', [[0, '#2a95c4'], [1, '#86e0d8']])),
    near: svg(W, H, palms(r, { count: 8, y: 505, size: 230 }) + bushes(r, { count: 8, y: 505, size: 58, colors: ['#3f8a3a', '#4f9a44', '#357a30'] })),
    ground: ground(r, { base: '#e2cf98', patches: { count: 14, colors: ['#d4bd80', '#efe0b0', '#c9b27a'] }, speckles: { count: 1600, size: 3, colors: ['#c9b07a', '#f3e6bf', '#b89e6a'], blades: false } }),
  }),
  gods_bridge: (r) => ({
    // Sunset over the river: the arena stands on the bridge deck; the 3D river runs below (arena-scenery).
    sky: svg(W, H, `<rect width="${W}" height="${H}" fill="url(#sky)"/>`
      + `<circle cx="1150" cy="405" r="150" fill="#ffd27a" opacity="0.35" filter="url(#haze)"/>`
      + `<circle cx="1150" cy="405" r="62" fill="#ffe7a8" opacity="0.6" filter="url(#soft)"/><circle cx="1150" cy="405" r="44" fill="#fff4cf"/>`
      + clouds(r, { count: 6, y: [150, 330], color: '#f6a3a0', opacity: 0.55, size: 1.2 })
      + clouds(r, { count: 5, y: [60, 160], color: '#8a5a8f', opacity: 0.45, size: 1.4 }),
      vgrad('sky', [[0, '#241d4f'], [0.38, '#6b3a72'], [0.62, '#c2577a'], [0.8, '#f2884a'], [0.92, '#ffc777'], [1, '#ffd98f']]) + blur('soft', 6) + blur('haze', 30)),
    far: svg(W, H, mountains(r, { base: 285, amp: 30, fill: '#4a2f57', shade: '#3a2547' })
      + `<path d="${ridgePath(ridge(r, { base: 322, amp: 8, octaves: 3 }), H)}" fill="#33203f"/>`
      + bridge(r, { y: 282, span: 380, color: '#3e2a4c', height: 58 })
      + `<rect y="338" width="${W}" height="${H - 338}" fill="url(#river)"/>`
      + `<g stroke="#ffcf8a" stroke-opacity="0.45" stroke-width="2">${wrap((dx) => Array.from({ length: 40 }, () => { const x = range(r, 0, W) + dx, y = range(r, 344, 505); return `<path d="M${x},${y} h${range(r, 10, 40).toFixed(0)}"/>`; }).join(''))}</g>`,
      vgrad('river', [[0, '#e8a070'], [0.5, '#b0607a'], [1, '#5a3f72']])),
    near: svg(W, H, `<g stroke="#2a1d33" stroke-width="3" fill="none" stroke-linecap="round">${wrap((dx) => Array.from({ length: 9 }, () => { const x = range(r, 0, W) + dx, y = range(r, 40, 200), s = range(r, 8, 16); return `<path d="M${x - s},${y - s * 0.4} Q${x - s * 0.4},${y - s * 0.6} ${x},${y} Q${x + s * 0.4},${y - s * 0.6} ${x + s},${y - s * 0.4}"/>`; }).join(''))}</g>`),
    ground: deck(r),
  }),
};

// ---- build -------------------------------------------------------------------------
async function encode(svgText, file, alpha) {
  await sharp(Buffer.from(svgText)).webp({ quality: 82, alphaQuality: alpha ? 90 : 100, effort: 5 }).toFile(file);
}
/** The left and right pixel columns must match for a seamless scroll. */
async function assertWraps(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  let diff = 0;
  for (let y = 0; y < info.height; y++) for (let c = 0; c < info.channels; c++) {
    diff += Math.abs(data[(y * info.width) * info.channels + c] - data[(y * info.width + info.width - 1) * info.channels + c]);
  }
  const mean = diff / (info.height * info.channels);
  if (mean > 14) throw new Error(`${file} does not wrap (mean edge difference ${mean.toFixed(1)})`);
}

const wanted = process.argv.slice(2);
for (const [region, paint] of Object.entries(REGIONS)) {
  if (wanted.length && !wanted.includes(region)) continue;
  const layers = paint(rng(`arena:${region}`));
  const dir = path.join(OUT, region);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(layers)) {
    const file = path.join(dir, `${name}.webp`);
    await encode(text, file, name === 'far' || name === 'near');
    await assertWraps(file);
  }
  const sizes = Object.keys(layers).map((n) => `${n} ${(fs.statSync(path.join(dir, `${n}.webp`)).size / 1024).toFixed(0)} kB`);
  console.log(`${region}: ${sizes.join(', ')}`);
}
