import { ComponentFixture, TestBed } from '@angular/core/testing';
import { APPEARANCE_TRAITS, defaultAppearance, type AppearanceCatalog, type HandWeaponType } from '@nanommo/shared';
import { CHARACTER_VIEWER_ENV, CharacterViewerComponent, type CharacterViewerEnv } from './character-viewer.component';

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

  it('plays Idle and ships the five named clips', async () => {
    const created = await create();
    fixture = created.fixture;
    await settle(fixture, created.events);
    const rig = fixture.componentInstance.rig()!;
    expect(rig.clipNames().sort()).toEqual(['Attack', 'Damage', 'Dead', 'Idle', 'Walk']);
    expect(rig.playingClip()).toBe('Idle');
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
    for (const sex of ['male', 'female'] as const) {
      const count = Math.max(...APPEARANCE_TRAITS.map((trait) => catalog[sex][trait].length));
      for (let index = 0; index < count; index++) {
        const appearance = defaultAppearance();
        for (const trait of APPEARANCE_TRAITS) appearance[trait] = Math.min(index, catalog[sex][trait].length - 1);
        fixture.componentRef.setInput('sex', sex);
        fixture.componentRef.setInput('appearance', appearance);
        await settle(fixture, created.events, { loaded: ++loaded });
      }
    }
    expect(created.events.failed).toBe(0);
  });

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
