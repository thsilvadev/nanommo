import { TestBed } from '@angular/core/testing';
import { MonsterViewerComponent } from './monster-viewer.component';

describe('MonsterViewerComponent (live assets)', () => {
  it('shows a monster and keeps animating it', async () => {
    const fixture = TestBed.createComponent(MonsterViewerComponent);
    fixture.componentRef.setInput('monsterId', 'mon_direwolf');
    fixture.componentRef.setInput('animation', () => ({}));
    (fixture.nativeElement as HTMLElement).style.cssText = 'width:200px;height:200px';
    document.body.appendChild(fixture.nativeElement);
    const result = await new Promise<string>((resolve) => {
      fixture.componentInstance.loaded.subscribe(() => resolve('loaded'));
      fixture.componentInstance.failed.subscribe(() => resolve('failed'));
      fixture.detectChanges();
      setTimeout(() => resolve('timeout'), 20000);
    });
    expect(result).toBe('loaded');
    const c = fixture.componentInstance as any;
    const snap = () => { const out: number[] = []; c.root.traverse((o: any) => { if (o.isBone) out.push(...o.quaternion.toArray(), ...o.position.toArray()); }); return out.join(','); };
    await new Promise((r) => setTimeout(r, 300));
    const a = snap(); const f1 = c.renderer.info.render.frame;
    await new Promise((r) => setTimeout(r, 700));
    console.log('frames', f1, c.renderer.info.render.frame, 'pose changed', a !== snap());
    expect(c.renderer.info.render.frame).toBeGreaterThan(f1);
    expect(snap()).not.toBe(a);
  }, 30000);
});
