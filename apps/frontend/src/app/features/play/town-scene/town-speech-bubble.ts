/**
 * Speech bubble over a character's head when it speaks in chat while in town:
 * a small black (70 %) rounded rectangle with a little tail, pastel yellow
 * text in Alegreya Sans (OFL, self-hosted in /assets/fonts). Drawn once into a
 * canvas texture on a sprite; it pops in, holds for a time that grows with the
 * text, and fades out.
 */
import * as THREE from 'three';

export const BUBBLE_FONT_FAMILY = 'NanoBubble';
const BUBBLE_FONT_URL = '/assets/fonts/AlegreyaSans-Medium.ttf';
const FONT_STACK = `${BUBBLE_FONT_FAMILY}, "Alegreya Sans", Georgia, serif`;

/** Layout in logical pixels (the canvas is drawn at RES× for crisp text). */
const RES = 2;
const FONT_PX = 34;
const LINE_PX = 38;
const PAD_X = 16;
const PAD_Y = 10;
const MAX_TEXT_W = 440;
const MAX_LINES = 4;
const RADIUS = 9;
const TAIL_W = 16;
const TAIL_H = 9;
/** World units per logical pixel, the name plates' ratio (512 px → 3.4 u). */
export const BUBBLE_UNITS_PER_PX = 3.4 / 512;
/** Gap between the top of the name plate and the tail tip, in world units. */
const GAP = 0.06;

const POP_MS = 160;
const FADE_MS = 450;

/** How long a line of chat stays up: longer for longer text, 4–10 s. */
export function bubbleDurationMs(text: string): number {
  return Math.min(10_000, Math.max(4_000, 2_500 + text.length * 65));
}

let fontReady: Promise<void> | null = null;

/** Loads the bubble font once (page-wide); resolves even if it fails (falls back to Georgia). */
export function loadBubbleFont(): Promise<void> {
  if (fontReady) return fontReady;
  fontReady = (async () => {
    if (typeof FontFace === 'undefined' || !document.fonts) return;
    try {
      const face = new FontFace(BUBBLE_FONT_FAMILY, `url(${BUBBLE_FONT_URL})`, { weight: '500' });
      (document.fonts as unknown as { add(face: FontFace): void }).add(await face.load());
    } catch { /* fallback font */ }
  })();
  return fontReady;
}

/** Greedy word wrap to `maxW` (long words are cut), at most MAX_LINES lines, ellipsis if more. */
export function wrapBubbleText(text: string, measure: (s: string) => number, maxW = MAX_TEXT_W, maxLines = MAX_LINES): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let word of words) {
    if (measure(word) > maxW) {
      // An overlong word (a link, "kkkkkkkk…") starts its own line and is cut into pieces that fit.
      if (line) { lines.push(line); line = ''; }
      while (measure(word) > maxW) {
        let cut = word.length - 1;
        while (cut > 1 && measure(word.slice(0, cut)) > maxW) cut--;
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
    }
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxW) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && measure(last + '…') > maxW) last = last.slice(0, -1);
  kept[maxLines - 1] = last.trimEnd() + '…';
  return kept;
}

function drawBubble(text: string): { canvas: HTMLCanvasElement; w: number; h: number } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `500 ${FONT_PX}px ${FONT_STACK}`;
  ctx.font = font;
  const lines = wrapBubbleText(text, (s) => ctx.measureText(s).width);
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width), FONT_PX);
  const boxW = Math.ceil(textW + PAD_X * 2);
  const boxH = Math.ceil(lines.length * LINE_PX + PAD_Y * 2);
  const w = boxW, h = boxH + TAIL_H;
  canvas.width = w * RES; canvas.height = h * RES;
  ctx.scale(RES, RES);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.beginPath();
  ctx.roundRect(0, 0, boxW, boxH, RADIUS);
  ctx.fill();
  // Tail, its own path so it does not darken where it meets the box.
  ctx.beginPath();
  ctx.moveTo(w / 2 - TAIL_W / 2, boxH);
  ctx.lineTo(w / 2, h);
  ctx.lineTo(w / 2 + TAIL_W / 2, boxH);
  ctx.closePath();
  ctx.fill();
  ctx.font = font;
  ctx.fillStyle = '#fff3c4';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, PAD_Y + LINE_PX * (i + 0.5) + 1));
  return { canvas, w, h };
}

export class SpeechBubble {
  readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial;
  private readonly texture: THREE.CanvasTexture;
  private readonly size: [number, number];
  private readonly startedAt: number;
  private readonly durationMs: number;
  private scale = 1;

  constructor(readonly text: string, nowMs = performance.now()) {
    const { canvas, w, h } = drawBubble(text);
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, fog: false, opacity: 0 });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.name = 'speech-bubble';
    this.sprite.center.set(0.5, 0); // anchored at the tail tip
    this.sprite.renderOrder = 11;
    this.size = [w * BUBBLE_UNITS_PER_PX, h * BUBBLE_UNITS_PER_PX];
    this.startedAt = nowMs;
    this.durationMs = bubbleDurationMs(text);
    this.step(nowMs, 1, 0);
  }

  /**
   * Animates the bubble; false once it has faded out. `scale` grows with the
   * camera distance so the bubble keeps one size on screen at every zoom;
   * `plateTop` is where the plate ends above the character's origin.
   */
  step(nowMs: number, scale: number, plateTop: number): boolean {
    this.scale = scale;
    const t = nowMs - this.startedAt;
    if (t >= this.durationMs) return false;
    const pop = Math.min(1, Math.max(0, t / POP_MS));
    const fade = Math.min(1, (this.durationMs - t) / FADE_MS);
    // Ease-out-back pop: a hint of overshoot.
    const grow = pop >= 1 ? 1 : 1 + 2.2 * Math.pow(pop - 1, 3) + 1.2 * Math.pow(pop - 1, 2);
    const s = this.scale * (0.6 + 0.4 * grow);
    this.sprite.scale.set(this.size[0] * s, this.size[1] * s, 1);
    this.sprite.position.y = plateTop + GAP * this.scale;
    this.material.opacity = Math.min(pop * 1.5, 1) * fade;
    return true;
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.material.dispose();
  }
}
