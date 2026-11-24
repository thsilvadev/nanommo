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

  it('Kwaiouá Ranger holds the Yew Bow (T1) and draws it on Attack', async () => {
    const fixture = TestBed.createComponent(MonsterViewerComponent);
    let state: any = {};
    fixture.componentRef.setInput('monsterId', 'mon_kwaiouaranger');
    fixture.componentRef.setInput('animation', () => state);
    (fixture.nativeElement as HTMLElement).style.cssText = 'width:320px;height:320px';
    document.body.appendChild(fixture.nativeElement);
    const result = await new Promise<string>((resolve) => {
      fixture.componentInstance.loaded.subscribe(() => resolve('loaded'));
      fixture.componentInstance.failed.subscribe(() => resolve('failed'));
      fixture.detectChanges();
      setTimeout(() => resolve('timeout'), 25000);
    });
    expect(result).toBe('loaded');
    const c = fixture.componentInstance as any;
    expect(c.weapon?.type).toBe('bow');
    const hand = c.root.getObjectByName('hand_r');
    const bow = hand.children.find((o: any) => o.name === 'weapon:bow-wooden');
    expect(bow).toBeTruthy();
    // capture a frame right after it renders (the WebGL buffer is not preserved)
    const render = c.renderer.render.bind(c.renderer);
    let want: ((url: string) => void) | null = null;
    c.renderer.render = (scene: any, camera: any) => { render(scene, camera); if (want) { const w = want; want = null; w(c.renderer.domElement.toDataURL('image/png')); } };
    const frame = () => new Promise<string>((r) => { want = r; });
    const leftHand = () => { c.root.updateMatrixWorld(true); return c.root.getObjectByName('hand_l').getWorldPosition(bow.position.clone()); };
    await new Promise((r) => setTimeout(r, 300));
    const restShot = await frame();
    const rest = leftHand();
    // 55 % through a 1.5 s shot: string at full draw, arrow nocked
    const now = Date.now();
    state = { action: { clip: 'Attack', startedAtMs: now - 825, impactAtMs: now + 400, endsAtMs: now + 675 } };
    const drawShot = await frame();
    const drawn = leftHand();
    const arrow = bow.getObjectByName('bow:arrow');
    console.log('RANGER_REST ' + restShot);
    console.log('RANGER_DRAW ' + drawShot);
    expect(arrow?.visible).toBeTrue();
    expect(drawn.distanceTo(rest)).toBeGreaterThan(0.1);
    // after the shot the string rests and the arrow is gone
    state = {};
    await frame();
    expect(arrow.visible).toBeFalse();
  }, 40000);
});
