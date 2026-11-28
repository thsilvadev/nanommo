import { TestBed } from '@angular/core/testing';
import { NpcPortraitComponent } from './npc-portrait.component';
import { createNpcPortrait } from './npc-portrait-runtime';
import { NPC_VISUALS } from './npc-visuals';

describe('NPC portraits (live town assets)', () => {
  for (const id of Object.keys(NPC_VISUALS)) {
    it(`renders ${id} inside the portrait and releases its canvas`, async () => {
      const host = document.createElement('div');
      host.style.cssText = 'width:167px;height:199px';
      document.body.appendChild(host);
      let portrait: { dispose(): void } | undefined;
      try {
        portrait = await createNpcPortrait(host, id);
        const canvas = host.querySelector('canvas')!;
        expect(canvas).toBeTruthy();
        const gl = canvas.getContext('webgl2')!;
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let count = 0, minX = w, maxX = 0, minY = h, maxY = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (pixels[(y * w + x) * 4 + 3] < 20) continue;
          count++;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        expect(count).toBeGreaterThan(w * h * 0.01);
        expect(minX).toBeGreaterThan(0);
        expect(maxX).toBeLessThan(w - 1);
        expect(minY).toBeGreaterThan(0);
        expect(maxY).toBeLessThan(h - 1);
      } finally {
        portrait?.dispose();
        expect(host.querySelector('canvas')).toBeNull();
        host.remove();
      }
    }, 30000);
  }

  it('clears readiness and the previous canvas when switching to an unavailable NPC', async () => {
    const fixture = TestBed.createComponent(NpcPortraitComponent);
    fixture.componentRef.setInput('npcId', 'mailbox');
    fixture.nativeElement.style.cssText = 'width:167px;height:199px';
    document.body.appendChild(fixture.nativeElement);
    try {
      const loaded = new Promise<void>(resolve => fixture.componentInstance.loaded.subscribe(() => resolve()));
      fixture.detectChanges();
      await loaded;
      expect(fixture.componentInstance.ready()).toBeTrue();
      expect(fixture.nativeElement.querySelectorAll('canvas').length).toBe(1);
      const failed = new Promise<void>(resolve => fixture.componentInstance.failed.subscribe(() => resolve()));
      fixture.componentRef.setInput('npcId', 'unknown-npc');
      fixture.detectChanges();
      await failed;
      expect(fixture.componentInstance.ready()).toBeFalse();
      expect(fixture.nativeElement.querySelector('canvas')).toBeNull();
    } finally { fixture.destroy(); }
  }, 30000);
});
