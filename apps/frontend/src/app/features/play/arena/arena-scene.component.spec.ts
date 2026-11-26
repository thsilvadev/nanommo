import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { defaultAppearance } from '@nanommo/shared';
import { BattleStore, CharacterStore, InventoryStore } from '../../../core/game.store';
import { CatalogService } from '../../../core/catalog.service';
import { LocaleService } from '../../../core/locale.service';
import { PartyStore } from '../../../core/party.store';
import { ServerClockService } from '../../../core/server-clock.service';
import { ArenaFeedbackOwner } from './arena-feedback-owner.service';
import { ARENA_SCENE_ENV, ArenaSceneComponent } from './arena-scene.component';
import { ArenaMonsterWarmup } from './arena-monster-warmup.service';
import type { ArenaFrameSource, ArenaRuntimeHandle } from './arena-runtime';
import { SOLO_V2_ENTRY } from './fixtures/solo-v2.fixture';

describe('ArenaSceneComponent', () => {
  const START = Date.parse(SOLO_V2_ENTRY.startAt);
  let now = START + 2 * 500 + 100;
  let source: ArenaFrameSource | null = null;
  let active = false;
  let lost: (() => void) | null = null;
  let characterState: ReturnType<typeof signal<any>>;
  let warmed: string[][] = [];
  const wanted = signal<string[]>(['mon_mutantbee']);
  const fake: ArenaRuntimeHandle = {
    setSource: (s) => { source = s; }, setActive: (a) => { active = a; }, isRendering: () => active, renderOnce: () => undefined, actorCount: () => 2,
    screenAnchors: () => new Map([['char-self', { x: 100, y: 200, visible: true }], ['monster:mon_mutantbee:0', { x: 500, y: 210, visible: true }]]),
    resize: () => undefined, dispose: () => undefined,
    warmMonsters: async (ids) => { warmed.push(ids); },
    sceneryReady: () => sceneryReady,
    setView: (v) => { views.push(v); },
  };
  let views: Array<{ focusId: string | null; selfId: string; zoom: number; yawDeg: number; pitchDeg: number }> = [];
  let sceneryReady = true;

  async function mount(isActive = true) {
    TestBed.configureTestingModule({
      imports: [ArenaSceneComponent],
      providers: [
        { provide: ARENA_SCENE_ENV, useValue: { webglAvailable: () => true, createRuntime: async (_: HTMLElement, init: { onContextLost: () => void }) => { lost = init.onContextLost; return fake; } } },
        { provide: CharacterStore, useValue: { character: (characterState = signal<any>({ id: 'char-self', currentMapId: 'map_green_grounds_2', appearance: defaultAppearance(), sex: 'male', heightCm: 181, dominantHand: 'right', gatheringCycle: { cycleIndex: 3 } })) } },
        { provide: InventoryStore, useValue: { equipment: signal([{ slot: 'mainHand', itemId: 'equip_bow_t1' }]) } },
        { provide: BattleStore, useValue: { queue: signal([SOLO_V2_ENTRY]), lastResolved: signal(null) } },
        { provide: PartyStore, useValue: { party: signal(null), battle: signal(null), nextEncounterAt: signal(null), members: signal([]) } },
        { provide: CatalogService, useValue: { item: (id: string) => (id === 'equip_bow_t1' ? { weaponType: 'bow' } : undefined) } },
        { provide: ServerClockService, useValue: { now: () => now } },
        { provide: LocaleService, useValue: { t: (s: string) => s } },
        { provide: ArenaMonsterWarmup, useValue: { wanted } },
      ],
    });
    const fixture = TestBed.createComponent(ArenaSceneComponent);
    fixture.componentRef.setInput('active', isActive);
    fixture.componentRef.setInput('mapId', 'map_green_grounds_2');
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    return fixture;
  }
  afterEach(() => { source = null; active = false; warmed = []; wanted.set(['mon_mutantbee']); });

  it('the arena uploads the wanted species once it exists, and again when they change', async () => {
    const fixture = await mount();
    expect(warmed).toEqual([['mon_mutantbee']]);
    wanted.set(['mon_mutantbee', 'mon_slime']);
    TestBed.flushEffects();
    expect(warmed[warmed.length - 1]).toEqual(['mon_mutantbee', 'mon_slime']);
    fixture.destroy();
  });

  it('renders one HUD per actor with HP and SP bars, straight to the DOM (no change detection at 30 Hz)', async () => {
    const fixture = await mount();
    source!(now);
    fixture.componentInstance.refreshHud();
    const huds = fixture.nativeElement.querySelectorAll('.arena-hud');
    expect(huds.length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.arena-bar--hp').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.arena-hud-name').textContent).toContain('Archer');
    fixture.destroy();
  });

  it('floating number appears for a damage event in the arena and not in the panel', async () => {
    const fixture = await mount();
    source!(now);
    fixture.componentInstance.refreshHud();
    expect(fixture.nativeElement.querySelectorAll('.arena-number').length).toBeGreaterThan(0);
    expect(TestBed.inject(ArenaFeedbackOwner).arenaVisible()).toBeTrue();
    fixture.destroy();
    expect(TestBed.inject(ArenaFeedbackOwner).arenaVisible()).toBeFalse();
  });

  it('hidden arena: render loop off and the panels keep the numbers', async () => {
    const fixture = await mount(false);
    expect(active).toBeFalse();
    expect(TestBed.inject(ArenaFeedbackOwner).arenaVisible()).toBeFalse();
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    expect(active).toBeTrue();
    expect(TestBed.inject(ArenaFeedbackOwner).arenaVisible()).toBeTrue();
    fixture.destroy();
  });

  it('a lost WebGL context hands the numbers back to the side panels', async () => {
    const fixture = await mount();
    expect(TestBed.inject(ArenaFeedbackOwner).arenaVisible()).toBeTrue();
    lost!();
    expect(fixture.componentInstance.failed()).toBeTrue();
    expect(TestBed.inject(ArenaFeedbackOwner).arenaVisible()).toBeFalse();
    expect(active).toBeFalse();
    fixture.destroy();
  });

  it('the viewing character uses its own equipment and bow style', async () => {
    const fixture = await mount();
    const frame = source!(now)!;
    expect(frame.visuals.get('char-self')!.look!.mainHandType).toBe('bow');
    fixture.destroy();
  });

  it('a completed gather kneels the character; a map change (which also starts a new cycle) does not', async () => {
    const fixture = await mount();
    const component = fixture.componentInstance;
    characterState.update((c: any) => ({ ...c, currentMapId: 'map_green_grounds_3', gatheringCycle: { cycleIndex: 4 } }));
    fixture.detectChanges();
    expect(component.inputs(now).gatherAtMs).withContext('map change').toBeNull();
    characterState.update((c: any) => ({ ...c, gatheringCycle: { cycleIndex: 5 } }));
    fixture.detectChanges();
    expect(component.inputs(now).gatherAtMs).withContext('gather on the same map').toBe(now);
    fixture.destroy();
  });

  it('a map change whitens the arena and swaps the scene at the peak', async () => {
    const fixture = await mount();
    const component = fixture.componentInstance;
    characterState.update((c: any) => ({ ...c, currentMapId: 'map_ipora_beach_1' }));
    fixture.componentRef.setInput('mapId', 'map_ipora_beach_1');
    fixture.detectChanges();
    const at = now;
    expect(component.inputs(at + 250).mapId).toBe('map_green_grounds_2');
    now = at + 250;
    source!(now);
    component.refreshHud();
    expect(fixture.nativeElement.querySelector('.arena-flash').style.opacity).toBe('0.5');
    expect(component.inputs(at + 600).mapId).toBe('map_ipora_beach_1');
    now = at;
    fixture.destroy();
  });

  it('the white holds until the new region has loaded, then clears', async () => {
    const fixture = await mount();
    const component = fixture.componentInstance;
    const flash = () => fixture.nativeElement.querySelector('.arena-flash').style.opacity;
    sceneryReady = false;
    characterState.update((c: any) => ({ ...c, currentMapId: 'map_ipora_beach_1' }));
    fixture.componentRef.setInput('mapId', 'map_ipora_beach_1');
    fixture.detectChanges();
    const at = now;
    now = at + 3000; source!(now); component.refreshHud();
    expect(flash()).withContext('still loading: full white').toBe('1');
    sceneryReady = true;
    now = at + 3100; source!(now); component.refreshHud();
    now = at + 3350; source!(now); component.refreshHud();
    expect(flash()).withContext('loaded: clearing').toBe('0.5');
    now = at + 3700; source!(now); component.refreshHud();
    expect(flash()).toBe('0');
    now = at; sceneryReady = true;
    fixture.destroy();
  });

  it('the mouse wheel zooms on my character; a number key centres on that living fighter', async () => {
    const fixture = await mount();
    const component = fixture.componentInstance;
    source!(now); component.refreshHud();
    views = [];
    const stage = fixture.nativeElement.querySelector('.arena-stage') as HTMLElement;
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    expect(views.at(-1)).toEqual(jasmine.objectContaining({ focusId: null, selfId: 'char-self' }));
    expect(views.at(-1)!.zoom).toBeGreaterThan(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2' }));
    expect(views.at(-1)!.focusId).toBe('monster:mon_mutantbee:0');
    for (let i = 0; i < 10; i++) stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    expect(views.at(-1)).toEqual(jasmine.objectContaining({ focusId: null, zoom: 0 }));
    // Typing in the chat is not a camera command.
    const input = document.createElement('input'); document.body.appendChild(input);
    const count = views.length;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true }));
    expect(views.length).toBe(count);
    input.remove();
    fixture.destroy();
  });

  it('click and drag turns the camera around the centred character; zooming all the way out resets it', async () => {
    const fixture = await mount();
    const component = fixture.componentInstance;
    source!(now); component.refreshHud();
    views = [];
    const stage = fixture.nativeElement.querySelector('.arena-stage') as HTMLElement;
    const pointer = (type: string, x: number, y: number) => stage.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }));
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 160, 120); // right and down: the camera turns left and rises
    pointer('pointerup', 160, 120);
    const turned = views.at(-1)!;
    expect(turned.yawDeg).toBeLessThan(0);
    expect(turned.pitchDeg).toBeGreaterThan(12);
    expect(turned.zoom).withContext('dragging centres the character').toBeGreaterThan(0);
    expect(turned.focusId).toBeNull();
    pointer('pointermove', 400, 400);
    expect(views.at(-1)).toEqual(turned);
    for (let i = 0; i < 10; i++) stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    expect(views.at(-1)).toEqual(jasmine.objectContaining({ zoom: 0, yawDeg: 0, pitchDeg: 12 }));
    fixture.destroy();
  });
});

