/**
 * Fog of war, pre-rendered.
 *
 * Each hidden map cell draws two cloud layers (map-board.css: four radial
 * gradients, an elliptic clip and `filter: blur(15px / 22px)`), animated with
 * slow transforms. With ~150 hidden cells that is ~300 blurred layers the
 * browser re-blurs on every frame (in Firefox it also kept the animations on
 * the main thread): ~40% of a CPU core while the map was open.
 *
 * Here the very same gradients, clip and blur are painted once into two images.
 * The cells then animate plain images, which the compositor moves for free.
 * Measured against the CSS version: max 7/255 per channel, mean 0.5.
 * When `ctx.filter` is not supported (Safari < 18) this returns null and the
 * CSS version stays.
 */
export interface FogSprite { url: string; insetPx: number }
export interface FogSprites { front: FogSprite; back: FogSprite }

/** Side of a map cell in px (map-board.css). */
export const FOG_CELL_PX = 153;

interface Lobe { at: [number, number]; stops: Array<[number, string]> }
/** Same as `.fog-cell::before/::after` background (first lobe painted on top). */
const LOBES: Lobe[] = [
  { at: [0.25, 0.35], stops: [[0, 'rgba(255,255,255,0.97)'], [0.13, 'rgba(255,255,255,0.97)'], [0.25, 'rgba(225,225,226,0.86)'], [0.53, 'rgba(225,225,226,0)']] },
  { at: [0.72, 0.30], stops: [[0, 'rgba(243,243,243,0.94)'], [0.16, 'rgba(243,243,243,0.94)'], [0.29, 'rgba(255,255,255,0.78)'], [0.56, 'rgba(255,255,255,0)']] },
  { at: [0.65, 0.75], stops: [[0, 'rgba(125,125,125,0.96)'], [0.17, 'rgba(125,125,125,0.96)'], [0.31, 'rgba(212,226,255,0.8)'], [0.58, 'rgba(212,226,255,0)']] },
  { at: [0.18, 0.78], stops: [[0, 'rgba(247,250,255,0.9)'], [0.14, 'rgba(247,250,255,0.9)'], [0.48, 'rgba(247,250,255,0)']] },
];

/**
 * One layer: a square box `cell × (1 + 2·insetFrac)` (the CSS `inset: -insetFrac`),
 * clipped to its inscribed ellipse (`border-radius: 50%`), blurred by `blur` px.
 * The image is padded by 3·blur on each side, where the blur bleeds.
 */
function bakeLayer(cell: number, insetFrac: number, blur: number): FogSprite {
  const side = cell * (1 + 2 * insetFrac);
  const pad = Math.ceil(blur * 3);
  const size = Math.ceil(side + 2 * pad);
  const raw = document.createElement('canvas');
  raw.width = raw.height = size;
  const r = raw.getContext('2d')!;
  r.save();
  r.beginPath();
  r.ellipse(pad + side / 2, pad + side / 2, side / 2, side / 2, 0, 0, Math.PI * 2);
  r.clip();
  for (const lobe of [...LOBES].reverse()) {
    const cx = lobe.at[0] * side, cy = lobe.at[1] * side;
    // CSS `ellipse` with the default `farthest-corner` size: the farthest-side ellipse
    // scaled by √2 so it passes through the farthest corner.
    const rx = Math.max(cx, side - cx) * Math.SQRT2;
    const ry = Math.max(cy, side - cy) * Math.SQRT2;
    r.save();
    r.translate(pad + cx, pad + cy);
    r.scale(1, ry / rx);
    const gradient = r.createRadialGradient(0, 0, 0, 0, 0, rx);
    for (const [offset, color] of lobe.stops) gradient.addColorStop(offset, color);
    r.fillStyle = gradient;
    r.fillRect(-pad - cx - 1, (-pad - cy - 1) * (rx / ry), size + 2, (size + 2) * (rx / ry));
    r.restore();
  }
  r.restore();
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const o = out.getContext('2d')!;
  o.filter = `blur(${blur}px)`;
  o.drawImage(raw, 0, 0);
  return { url: blobUrl(out.toDataURL('image/png')), insetPx: -(cell * insetFrac + pad + (size - (side + 2 * pad)) / 2) };
}

/**
 * The PNG as a short `blob:` URL. As a data: URI (hundreds of kB of text) Firefox re-resolved it
 * for each of the ~300 fog pseudo-elements on every restyle of the map: ~20% of the main thread
 * while travelling (profile, 2026-11-23). Lives as long as the page, like the sprites.
 */
function blobUrl(dataUrl: string): string {
  const bytes = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
  return URL.createObjectURL(new Blob([buffer], { type: 'image/png' }));
}

/**
 * Declares the baked sprites once, in a stylesheet of their own (`.world.fog-baked` then uses
 * them). Never in the world's inline style: Angular rewrites that on every camera move, and each
 * rewrite re-parsed the images and restyled every fog cell. Returns false when the CSS fog stays.
 */
export function installFogStyles(): boolean {
  const fog = bakeFogSprites();
  if (!fog) return false;
  if (document.getElementById('nm-fog-sprites')) return true;
  const style = document.createElement('style');
  style.id = 'nm-fog-sprites';
  style.textContent = `app-map-board .world.fog-baked{--fog-front:url("${fog.front.url}");--fog-front-inset:${fog.front.insetPx}px;`
    + `--fog-back:url("${fog.back.url}");--fog-back-inset:${fog.back.insetPx}px}`;
  document.head.appendChild(style);
  return true;
}

let baked: FogSprites | null | undefined;

/** Both cloud layers, painted once per page; null when the browser cannot blur a canvas. */
export function bakeFogSprites(): FogSprites | null {
  if (baked !== undefined) return baked;
  try {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return (baked = null);
    probe.filter = 'blur(1px)';
    if (probe.filter !== 'blur(1px)') return (baked = null);
    baked = { front: bakeLayer(FOG_CELL_PX, 0.48, 15), back: bakeLayer(FOG_CELL_PX, 0.58, 22) };
  } catch {
    baked = null;
  }
  return baked;
}
