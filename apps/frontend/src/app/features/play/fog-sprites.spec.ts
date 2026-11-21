import { FOG_CELL_PX, bakeFogSprites } from './fog-sprites';

describe('bakeFogSprites', () => {
  it('paints both cloud layers once per page, sized to cover the CSS box plus the blur bleed', async () => {
    const fog = bakeFogSprites();
    if (!fog) { pending('this browser cannot blur a canvas (CSS fog stays)'); return; }
    expect(bakeFogSprites()).toBe(fog);
    for (const [layer, insetFrac, blur] of [[fog.front, 0.48, 15], [fog.back, 0.58, 22]] as const) {
      expect(layer.url.startsWith('data:image/png')).toBeTrue();
      // The image covers the CSS box (inset -insetFrac) plus 3·blur on each side.
      expect(-layer.insetPx).toBeGreaterThanOrEqual(FOG_CELL_PX * insetFrac + 3 * blur - 1);
      expect(-layer.insetPx).toBeLessThanOrEqual(FOG_CELL_PX * insetFrac + 3 * blur + 1);
      const image = new Image();
      image.src = layer.url;
      await image.decode();
      const side = FOG_CELL_PX - 2 * layer.insetPx;
      expect(Math.abs(image.width - side)).toBeLessThanOrEqual(1);
      // A soft cloud: opaque-ish in the middle, fully transparent at the corners.
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      expect(ctx.getImageData(image.width >> 1, image.height >> 1, 1, 1).data[3]).toBeGreaterThan(150);
      expect(ctx.getImageData(1, 1, 1, 1).data[3]).toBe(0);
    }
  });

  it('global styles swap the blurred CSS layers for the baked images (and hide the map in the town view)', () => {
    const fog = bakeFogSprites();
    if (!fog) { pending('this browser cannot blur a canvas (CSS fog stays)'); return; }
    const board = document.createElement('app-map-board');
    board.innerHTML = '<div class="world fog-baked"><div class="fog-cell"></div></div>';
    const world = board.firstElementChild as HTMLElement;
    world.style.setProperty('--fog-front', `url("${fog.front.url}")`);
    world.style.setProperty('--fog-front-inset', `${fog.front.insetPx}px`);
    document.body.appendChild(board);
    const cell = world.firstElementChild as HTMLElement;
    const before = getComputedStyle(cell, '::before');
    expect(before.filter).toBe('none');
    expect(before.backgroundImage.startsWith('url("data:image/png')).toBeTrue();
    expect(before.top).toBe(`${fog.front.insetPx}px`);
    world.classList.add('world--hidden');
    expect(getComputedStyle(world).display).toBe('none');
    board.remove();
  });
});

