import { ComponentFixture, TestBed } from '@angular/core/testing';
import { APPEARANCE_TRAITS, defaultAppearance, type AppearanceCatalog, type HandWeaponType } from '@nanommo/shared';
import { CHARACTER_VIEWER_ENV, CharacterViewerComponent, type CharacterViewerEnv } from './character-viewer.component';
import type { CharacterRigHandle } from './character-viewer.types';
import type { AnimationState } from '../character-animation/animation-state';

const ASSETS = '/assets/character/';

function env(overrides: Partial<CharacterViewerEnv> = {}): CharacterViewerEnv {
  return { assetBase: ASSETS, webglAvailable: () => true, ...overrides };
}

async function create(overrides: Partial<CharacterViewerEnv> = {}, inputs: Record<string, unknown> = {}) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [CharacterViewerComponent],
    providers: [{ provide: CHARACTER_VIEWER_ENV, useValue: env(overrides) }],
  }).compileComponents();
  const fixture = TestBed.createComponent(CharacterViewerComponent);
  const events = { failed: 0, loaded: 0 };
  fixture.componentInstance.failed.subscribe(() => { events.failed += 1; });
  fixture.componentInstance.loaded.subscribe(() => { events.loaded += 1; });
  const all = { sex: 'male', heightCm: 181, appearance: defaultAppearance(), ...inputs };
  for (const [name, value] of Object.entries(all)) fixture.componentRef.setInput(name, value);
  fixture.detectChanges();
  return { fixture, events };
}

/** Waits until the viewer reports loaded or failed (it loads real GLB files in the browser). */
async function settle(fixture: ComponentFixture<CharacterViewerComponent>, events: { failed: number; loaded: number }, target?: { failed?: number; loaded?: number }) {
  const want = target ?? { failed: events.failed + 0, loaded: events.loaded + 0 };
  const start = Date.now();
  for (;;) {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const done = target
      ? events.failed >= (want.failed ?? 0) && events.loaded >= (want.loaded ?? 0)
      : events.failed + events.loaded > 0;
    if (done && fixture.componentInstance.state() !== 'loading') return;
    if (Date.now() - start > 15000) throw new Error(`viewer did not settle: ${JSON.stringify(events)} state=${fixture.componentInstance.state()}`);
  }
}

function weaponNames(fixture: ComponentFixture<CharacterViewerComponent>, bone: 'hand_r' | 'hand_l'): string[] {
  const rig = fixture.componentInstance.rig()!;
  return rig.bone(bone).children.map((child) => child.name).filter((name) => name.startsWith('weapon:'));
}

describe('CharacterViewerComponent', () => {
  let fixture: ComponentFixture<CharacterViewerComponent> | undefined;
  afterEach(() => { fixture?.destroy(); fixture = undefined; });

  it('reports failure and creates no canvas when WebGL is unavailable', async () => {
    const created = await create({ webglAvailable: () => false });
    fixture = created.fixture;
    await settle(fixture, created.events);
    expect(created.events).toEqual({ failed: 1, loaded: 0 });
    expect(fixture.componentInstance.state()).toBe('failed');
    expect(fixture.nativeElement.querySelector('canvas')).toBeNull();
  });

  it('reports failure when an asset cannot be loaded, and retry() tries again', async () => {
    const requested: string[] = [];
    let fail = true;
    const created = await create({
      loadGltf: async (url, fallback) => { requested.push(url); if (fail) throw new Error('404'); return fallback(url); },
    });
    fixture = created.fixture;
    await settle(fixture, created.events);
    expect(created.events).toEqual({ failed: 1, loaded: 0 });
    expect(requested.some((url) => url.endsWith('body-male.glb'))).toBeTrue();
    expect(fixture.nativeElement.querySelector('canvas')).toBeNull();

    fail = false;
    requested.length = 0;
    fixture.componentInstance.retry();
    await settle(fixture, created.events, { loaded: 1 });
    expect(created.events).toEqual({ failed: 1, loaded: 1 });
    expect(requested.some((url) => url.endsWith('body-male.glb'))).toBeTrue();
    expect(fixture.nativeElement.querySelector('canvas')).not.toBeNull();
  });

  it('reports failure when the WebGL context is lost', async () => {
    const created = await create();
    fixture = created.fixture;
    await settle(fixture, created.events);
    expect(created.events).toEqual({ failed: 0, loaded: 1 });
    const canvas: HTMLCanvasElement = fixture.nativeElement.querySelector('canvas');
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fixture.detectChanges();
    expect(created.events.failed).toBe(1);
    expect(fixture.componentInstance.state()).toBe('failed');
    expect(fixture.nativeElement.querySelector('canvas')).toBeNull();
  });

  it('plays Idle and ships the named clips', async () => {
    const created = await create();
    fixture = created.fixture;
    await settle(fixture, created.events);
    const rig = fixture.componentInstance.rig()!;
    expect(rig.clipNames().sort()).toEqual(['Attack', 'CastLoop', 'CastStart', 'CombatIdle', 'Damage', 'Damage2', 'Dead', 'Idle', 'Walk']);
    expect(rig.playingClip()).toBe('Idle');
  });

  describe('animation', () => {
    async function ready() {
      const created = await create();
      fixture = created.fixture;
      await settle(fixture, created.events);
      const rig = fixture.componentInstance.rig()!;
      let now = 1_000_000;
      let state: AnimationState = { base: 'Idle' };
      rig.setAnimation(() => state, () => now);
      const frame = (advanceMs = 0) => { now += advanceMs; rig.renderNow(); };
      frame();
      return { rig, frame, set: (next: AnimationState) => { state = next; }, now: () => now, events: created.events };
    }
    const total = (rig: CharacterRigHandle, names: string[]) => names.reduce((sum, name) => sum + rig.clipWeight(name), 0);
    const ALL = ['Idle', 'Walk', 'CombatIdle', 'Attack', 'Dead', 'CastStart', 'CastLoop', 'Damage', 'Damage2'];

    it('plays the animation input from the first frame, and idles without one', async () => {
      const created = await create({}, { animation: () => ({ base: 'Walk' }) });
      fixture = created.fixture;
      await settle(fixture, created.events);
      const rig = fixture.componentInstance.rig()!;
      rig.renderNow();
      expect(rig.playingClip()).toBe('Walk');
      expect(rig.clipWeight('Walk')).toBeCloseTo(1, 5);

      fixture.componentRef.setInput('animation', null);
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 400));
      rig.renderNow();
      expect(rig.playingClip()).toBe('Idle');
    });

    it('crossfades between loops in about 0.2 s, weights always summing to one', async () => {
      const { rig, frame, set } = await ready();
      expect(rig.playingClip()).toBe('Idle');
      set({ base: 'Walk' });
      frame(100);
      expect(rig.clipWeight('Walk')).toBeGreaterThan(0.2);
      expect(rig.clipWeight('Idle')).toBeGreaterThan(0.2);
      expect(total(rig, ALL)).toBeCloseTo(1, 5);
      frame(150);
      expect(rig.playingClip()).toBe('Walk');
      expect(rig.clipWeight('Idle')).toBe(0);
    });

    it('positions a one-shot by absolute time and speed', async () => {
      const { rig, frame, set, now } = await ready();
      set({ base: 'CombatIdle', oneShot: { clip: 'Attack', startedAtMs: now() - 300, speed: 1.5 } });
      frame(400);
      expect(rig.playingClip()).toBe('Attack');
      expect(rig.clipTime('Attack')).toBeCloseTo(0.7 * 1.5, 3);
      expect(total(rig, ALL)).toBeCloseTo(1, 5);
    });

    it('joins the hands (CastStart), then holds them (CastLoop) until the cast ends', async () => {
      const { rig, frame, set, now } = await ready();
      const start = now();
      set({ base: 'CombatIdle', cast: { startedAtMs: start, endsAtMs: start + 3000 } });
      frame(300);
      expect(rig.playingClip()).toBe('CastStart');
      expect(rig.clipTime('CastStart')).toBeCloseTo(0.3, 3);
      frame(900);
      expect(rig.playingClip()).toBe('CastLoop');
      expect(rig.clipTime('CastLoop')).toBeCloseTo(1.2 - 0.533, 2);
    });

    it('blends Damage over an Attack without replacing it', async () => {
      const { rig, frame, set, now } = await ready();
      const start = now();
      set({ base: 'CombatIdle', oneShot: { clip: 'Attack', startedAtMs: start, speed: 1 }, hit: { clip: 'Damage', startedAtMs: start + 300 } });
      frame(300 + 333 / 2);
      expect(rig.playingClip()).toBe('Attack');
      expect(rig.clipWeight('Damage')).toBeGreaterThan(0.2);
      expect(total(rig, ALL)).toBeCloseTo(1, 5);
    });

    it('draws and looses with a bow instead of swinging the sword clip', async () => {
      const created = await create({}, { mainHandType: 'bow' });
      fixture = created.fixture;
      await settle(fixture, created.events);
      const rig = fixture.componentInstance.rig()!;
      const now = 2_000_000;
      const attackAt = (fraction: number): AnimationState => ({ base: 'CombatIdle', oneShot: { clip: 'Attack', startedAtMs: now - fraction * 1533, speed: 1 } });
      let state: AnimationState = { base: 'CombatIdle' };
      rig.setAnimation(() => state, () => now);
      rig.renderNow();
      const guardHand = rig.bonePosition('hand_r');
      state = attackAt(0.55);
      rig.renderNow();
      const head = rig.bonePosition('Head');
      const bowShoulder = rig.bonePosition('upperarm_r');
      const bowHand = rig.bonePosition('hand_r');
      const drawHand = rig.bonePosition('hand_l');
      expect(rig.clipWeight('Attack')).toBe(0);
      expect(bowHand[2] - bowShoulder[2]).withContext('bow arm reaches forward').toBeGreaterThan(0.35);
      expect(Math.hypot(drawHand[0] - head[0], drawHand[1] - head[1], drawHand[2] - head[2])).withContext('draw hand at the face').toBeLessThan(0.3);
      expect(rig.bowDrawn()).toBeGreaterThan(0.9);

      state = { base: 'CombatIdle' };
      rig.renderNow();
      expect(rig.bowDrawn()).toBe(0);
      rig.bonePosition('hand_r').forEach((v, i) => expect(v).withContext('back to the guard').toBeCloseTo(guardHand[i], 3));
    });

    it('mirrors the sword swing (and guard and cast) for a left-handed character', async () => {
      const created = await create({}, { mainHandType: 'sword', dominantHand: 'right' });
      fixture = created.fixture;
      await settle(fixture, created.events);
      const rig = fixture.componentInstance.rig()!;
      // Each pose is defined relative to the frame time; the clock jumps 2 s so crossfades complete.
      let now = 3_000_000;
      let make: (t: number) => AnimationState = () => ({ base: 'CombatIdle' });
      rig.setAnimation((t) => make(t), () => now);
      const swing = (t: number): AnimationState => ({ base: 'CombatIdle', oneShot: { clip: 'Attack', startedAtMs: t - 450, speed: 1 } });
      const cast = (t: number): AnimationState => ({ base: 'CombatIdle', cast: { startedAtMs: t - 1200, endsAtMs: t + 2000 } });
      const sample = (next: (t: number) => AnimationState) => {
        make = next;
        for (let i = 0; i < 3; i++) { now += 2000; rig.renderNow(); }
        return { r: rig.bonePosition('hand_r'), l: rig.bonePosition('hand_l') };
      };
      const guard = (): AnimationState => ({ base: 'CombatIdle' });
      const rightSwing = sample(swing), rightGuard = sample(guard), rightCast = sample(cast);

      fixture.componentRef.setInput('dominantHand', 'left');
      await settle(fixture, created.events, { loaded: 2 });
      const leftSwing = sample(swing), leftGuard = sample(guard), leftCast = sample(cast);
      const mirrored = (a: number[], b: number[]) => Math.hypot(a[0] + b[0], a[1] - b[1], a[2] - b[2]);
      expect(mirrored(leftSwing.l, rightSwing.r)).withContext('swinging hand').toBeLessThan(0.03);
      expect(mirrored(leftSwing.r, rightSwing.l)).withContext('other hand').toBeLessThan(0.03);
      expect(mirrored(leftGuard.l, rightGuard.r)).withContext('guard').toBeLessThan(0.03);
      expect(mirrored(leftCast.r, rightCast.l)).withContext('casting hand').toBeLessThan(0.03);
      expect(rig.playingClip()).toBe('CastLoop');
    });

    it('holds Dead on its last frame', async () => {
      const { rig, frame, set, now } = await ready();
      set({ base: 'CombatIdle', oneShot: { clip: 'Dead', startedAtMs: now(), speed: 1 } });
      frame(10_000);
      expect(rig.playingClip()).toBe('Dead');
      const end = rig.clipTime('Dead');
      expect(end).toBeCloseTo(2.4, 2);
      frame(5_000);
      expect(rig.clipTime('Dead')).toBe(end);
    });

    it('shows the right pose on the very first frame of a new body (opening mid-cast)', async () => {
      const { rig, frame, set, now, events } = await ready();
      set({ base: 'CombatIdle', cast: { startedAtMs: now() - 1500, endsAtMs: now() + 1500 } });
      fixture!.componentRef.setInput('sex', 'female');
      await settle(fixture!, events, { loaded: 2 });
      frame();
      expect(rig.playingClip()).toBe('CastLoop');
      expect(rig.clipWeight('CastLoop')).toBeCloseTo(1, 5);
    });
  });

  it('puts the main-hand item in the dominant hand and the off-hand item in the other', async () => {
    const created = await create({}, { dominantHand: 'left', mainHandType: 'sword', offHandType: 'shield' });
    fixture = created.fixture;
    await settle(fixture, created.events);
    expect(weaponNames(fixture, 'hand_l')).toEqual(['weapon:sword']);
    expect(weaponNames(fixture, 'hand_r')).toEqual(['weapon:shield']);

    fixture.componentRef.setInput('mainHandType', 'dagger');
    fixture.componentRef.setInput('offHandType', null);
    await settle(fixture, created.events, { loaded: 2 });
    expect(weaponNames(fixture, 'hand_l')).toEqual(['weapon:dagger']);
    expect(weaponNames(fixture, 'hand_r')).toEqual([]);

    fixture.componentRef.setInput('dominantHand', 'right');
    await settle(fixture, created.events, { loaded: 3 });
    expect(weaponNames(fixture, 'hand_r')).toEqual(['weapon:dagger']);
    expect(weaponNames(fixture, 'hand_l')).toEqual([]);
  });

  it('shows every weapon type, including the ones generated in code', async () => {
    const created = await create();
    fixture = created.fixture;
    await settle(fixture, created.events);
    const types: HandWeaponType[] = ['dagger', 'sword', 'greatsword', 'bow', 'staff', 'rod', 'shield', 'rune'];
    let loaded = 1;
    for (const type of types) {
      fixture.componentRef.setInput('mainHandType', type);
      await settle(fixture, created.events, { loaded: ++loaded });
      expect(weaponNames(fixture, 'hand_r')).toEqual([`weapon:${type}`]);
    }
    expect(created.events.failed).toBe(0);
  });

  describe('wearing equipment', () => {
    it('wears body, shoes and helmet as one Gear mesh, hides the covered body and the hair', async () => {
      const bare = await create();
      fixture = bare.fixture;
      await settle(fixture, bare.events);
      const fullBody = fixture.componentInstance.rig()!.bodyTriangles();
      fixture.destroy();
      const created = await create({}, { equipment: { body: 'equip_body_phys_t3', shoes: 'equip_shoes_fire_t3', head: 'equip_head_phys_t2' } });
      fixture = created.fixture;
      await settle(fixture, created.events);
      const rig = fixture.componentInstance.rig()!;
      expect(rig.gearVertexCount()).toBeGreaterThan(1000);
      expect(rig.bodyTriangles()).toBeLessThan(fullBody * 0.6);
      expect(rig.hairVisible()).toBeFalse();
      expect(created.events.failed).toBe(0);

      fixture.componentRef.setInput('equipment', null);
      await settle(fixture, created.events, { loaded: 2 });
      expect(rig.gearVertexCount()).toBe(0);
      expect(rig.bodyTriangles()).toBe(fullBody);
    });

    it('holds each item\'s own weapon model, in the dominant hand', async () => {
      const created = await create({}, { dominantHand: 'left', mainHandType: 'sword', offHandType: 'shield', equipment: { mainHand: 'equip_sword_t3', offHand: 'equip_shield_t2' } });
      fixture = created.fixture;
      await settle(fixture, created.events);
      expect(weaponNames(fixture, 'hand_l')).toEqual(['weapon:sword-golden']);
      expect(weaponNames(fixture, 'hand_r')).toEqual(['weapon:shield-heater']);
      // an item without a visual falls back to the type's model
      fixture.componentRef.setInput('equipment', { mainHand: 'equip_unknown' });
      await settle(fixture, created.events, { loaded: 2 });
      expect(weaponNames(fixture, 'hand_l')).toEqual(['weapon:sword']);
    });

    it('draws the string of an item bow', async () => {
      const created = await create({}, { mainHandType: 'bow', equipment: { mainHand: 'equip_bow_t3' } });
      fixture = created.fixture;
      await settle(fixture, created.events);
      expect(weaponNames(fixture, 'hand_r')).toEqual(['weapon:bow-evil']);
      const rig = fixture.componentInstance.rig()!;
      const now = 2_000_000;
      rig.setAnimation(() => ({ base: 'CombatIdle', oneShot: { clip: 'Attack', startedAtMs: now - 0.55 * 1533, speed: 1 } }), () => now);
      rig.renderNow();
      expect(rig.bowDrawn()).toBeGreaterThan(0.9);
    });
  });

  it('does not rebuild the model when a snapshot repeats the same inputs as new objects', async () => {
    const equipment = { body: 'equip_body_phys_t3', head: 'equip_head_phys_t2' };
    const created = await create({}, { equipment });
    fixture = created.fixture;
    await settle(fixture, created.events);
    const rig = fixture.componentInstance.rig()! as CharacterRigHandle & { apply: (config: unknown) => Promise<void> };
    const apply = spyOn(rig, 'apply').and.callThrough();
    // what the grind does on every battle snapshot: same values, fresh references
    for (let i = 0; i < 5; i++) {
      fixture.componentRef.setInput('appearance', { ...defaultAppearance() });
      fixture.componentRef.setInput('equipment', { ...equipment });
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(apply).not.toHaveBeenCalled();
    expect(created.events.loaded).toBe(1);

    fixture.componentRef.setInput('equipment', { body: 'equip_body_phys_t3' });
    await settle(fixture, created.events, { loaded: 2 });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('switches body with sex, scales with height and reuses the renderer', async () => {
    const created = await create({}, { heightCm: 181 });
    fixture = created.fixture;
    await settle(fixture, created.events);
    const canvas = fixture.nativeElement.querySelector('canvas');
    const rig = fixture.componentInstance.rig()!;
    expect(rig.modelScale()).toBeCloseTo(1, 5);

    fixture.componentRef.setInput('heightCm', 145);
    await settle(fixture, created.events, { loaded: 2 });
    expect(rig.modelScale()).toBeCloseTo(145 / 181, 5);

    fixture.componentRef.setInput('sex', 'female');
    fixture.componentRef.setInput('heightCm', 205);
    await settle(fixture, created.events, { loaded: 3 });
    expect(rig.modelScale()).toBeCloseTo(205 / 177, 5);
    expect(fixture.nativeElement.querySelector('canvas')).toBe(canvas, 'the same canvas/renderer is kept across input changes');
    expect(fixture.componentInstance.rig()).toBe(rig);
  });

  it('applies every option of every trait for both sexes without failing', async () => {
    const catalog: AppearanceCatalog = await (await fetch('/data/appearance_catalog.json')).json();
    const created = await create();
    fixture = created.fixture;
    await settle(fixture, created.events);
    let loaded = 1;
    let shown = JSON.stringify(['male', defaultAppearance()]);
    for (const sex of ['male', 'female'] as const) {
      const count = Math.max(...APPEARANCE_TRAITS.map((trait) => catalog[sex][trait].length));
      for (let index = 0; index < count; index++) {
        const appearance = defaultAppearance();
        for (const trait of APPEARANCE_TRAITS) appearance[trait] = Math.min(index, catalog[sex][trait].length - 1);
        // the viewer (rightly) does not rebuild for the look it already shows
        if (JSON.stringify([sex, appearance]) === shown) continue;
        shown = JSON.stringify([sex, appearance]);
        fixture.componentRef.setInput('sex', sex);
        fixture.componentRef.setInput('appearance', appearance);
        await settle(fixture, created.events, { loaded: ++loaded });
      }
    }
    expect(created.events.failed).toBe(0);
  }, 45_000); // Enumerates all looks with real GLBs and software WebGL.

  it('ships every asset the catalogue references', async () => {
    const catalog: AppearanceCatalog = await (await fetch('/data/appearance_catalog.json')).json();
    const assets = new Set<string>();
    for (const sex of ['male', 'female'] as const) {
      for (const trait of APPEARANCE_TRAITS) for (const option of catalog[sex][trait]) if (option.asset) assets.add(option.asset);
    }
    expect(assets.size).toBeGreaterThan(10);
    for (const asset of assets) {
      const response = await fetch(ASSETS + asset);
      expect(response.ok).withContext(asset).toBeTrue();
    }
  });

  it('releases the renderer and stops rendering on destroy', async () => {
    const created = await create();
    await settle(created.fixture, created.events);
    const rig = created.fixture.componentInstance.rig()!;
    const host: HTMLElement = created.fixture.nativeElement;
    expect(rig.isDisposed()).toBeFalse();
    created.fixture.destroy();
    expect(rig.isDisposed()).toBeTrue();
    expect(rig.isRendering()).toBeFalse();
    expect(host.querySelector('canvas')).toBeNull();
  });
});
