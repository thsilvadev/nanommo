import { TestBed } from '@angular/core/testing';
import { NgZone, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { GameAudioService } from '../../../shared/game-audio.service';
import type { TownRosterEntry, TownSceneDef } from '@nanommo/shared';
import { CharacterStore } from '../../../core/game.store';
import { PartyStore } from '../../../core/party.store';
import { ServerClockService } from '../../../core/server-clock.service';
import { TownStore } from '../../../core/town.store';
import { CatalogService } from '../../../core/catalog.service';
import { TownSceneComponent } from './town-scene.component';
import { TOWN_SCENE_ENV, VASE_CONTACT_MS, type TownSceneRuntimeHandle, type TownSceneRuntimeInit } from './town-scene.types';
import { rankForRender, TOWN_RENDER_CAP } from './town-render-order';

const entry = (characterId: string, extra: Partial<TownRosterEntry> = {}): TownRosterEntry => ({
  characterId, name: characterId, level: 1, appearance: null, sex: 'male', heightCm: 175, seed: 1, online: false,
  sleeping: { at: 1 }, wakeFrom: null, lastSeenAt: '2026-11-01T00:00:00.000Z', ...extra,
});

describe('rankForRender', () => {
  it('caps at 100 with self, party, online, then offline by lastSeenAt desc', () => {
    expect(TOWN_RENDER_CAP).toBe(100);
    const list = Array.from({ length: 150 }, (_, i) => entry(`p${i}`, { lastSeenAt: new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString() }));
    list[40] = entry('p40', { online: true });
    const ranked = rankForRender(list, 'p149', new Set(['p10']));
    expect(ranked.length).toBe(100);
    expect(ranked.slice(0, 3).map(e => e.characterId)).toEqual(['p149', 'p10', 'p40']);
    expect(ranked[3].characterId).toBe('p148');
    expect(ranked.at(-1)!.characterId).toBe('p52');
  });
});

describe('TownSceneComponent', () => {
  let runtime: jasmine.SpyObj<TownSceneRuntimeHandle>;
  let init: TownSceneRuntimeInit | null;
  let entries: ReturnType<typeof signal<TownRosterEntry[]>>;
  let moveTo: jasmine.Spy;
  let breakVase: jasmine.Spy;
  let setSelfPosition: jasmine.Spy;
  let vaseEvent: ReturnType<typeof signal<any>>;
  let vaseBreaks: Subject<any>;
  let audio: jasmine.SpyObj<GameAudioService>;

  beforeEach(() => {
    breakVase = jasmine.createSpy('breakVase').and.resolveTo();
    setSelfPosition = jasmine.createSpy('setSelfPosition');
    vaseEvent = signal<any>(null);
    vaseBreaks = new Subject();
    audio = jasmine.createSpyObj<GameAudioService>('audio', ['playAt', 'play']);
    init = null;
    runtime = jasmine.createSpyObj<TownSceneRuntimeHandle>('runtime', ['setCharacters', 'setSelection', 'setActive', 'pick', 'groundPoint', 'markDestination', 'pan', 'zoom', 'resize', 'dispose', 'screenPositionOf', 'setVases', 'breakVase', 'selfPosition', 'setHoveredVase']);
    moveTo = jasmine.createSpy('moveTo').and.resolveTo();
    entries = signal<TownRosterEntry[]>([]);
    const def = { mapId: 'map_town', size: { w: 72, h: 72 }, npcSpots: { blacksmith_loren: { x: 1, z: 1, facing: 0 } } } as unknown as TownSceneDef;
    TestBed.configureTestingModule({
      imports: [TownSceneComponent],
      providers: [
        { provide: TOWN_SCENE_ENV, useValue: {
          webglAvailable: () => true,
          loadScene: async () => def,
          createRuntime: async (_host: HTMLElement, i: TownSceneRuntimeInit) => { init = i; return runtime; },
        } },
        { provide: TownStore, useValue: { entries, mapId: signal('map_town'), moveTo, breakVase, setSelfPosition, vaseEvent, vaseBreaks } },
        { provide: GameAudioService, useValue: audio },
        { provide: CharacterStore, useValue: { character: signal({ id: 'hero' }) } },
        { provide: PartyStore, useValue: { members: signal([]) } },
        { provide: ServerClockService, useValue: { now: () => 123 } },
        { provide: CatalogService, useValue: { npcCatalog: signal([{ id: 'blacksmith_loren', name: 'Loren' }]) } },
      ],
    });
  });

  async function create() {
    const fixture = TestBed.createComponent(TownSceneComponent);
    fixture.componentRef.setInput('mapId', 'map_town');
    fixture.detectChanges();
    for (let i = 0; i < 5 && !init; i++) await new Promise(r => setTimeout(r));
    fixture.detectChanges();
    return fixture;
  }

  it('creates the runtime (render loop, model loads) outside the Angular zone', async () => {
    let createdInZone: boolean | null = null;
    TestBed.overrideProvider(TOWN_SCENE_ENV, { useValue: {
      webglAvailable: () => true,
      loadScene: async () => ({ mapId: 'map_town', size: { w: 72, h: 72 }, npcSpots: {} }),
      createRuntime: async (_host: HTMLElement, i: TownSceneRuntimeInit) => { createdInZone = NgZone.isInAngularZone(); init = i; return runtime; },
    } });
    await TestBed.inject(NgZone).run(() => create());
    expect(createdInZone).toBeFalse();
  });

  it('pointermove over the scene is handled outside the Angular zone (hover alone never re-checks the app)', async () => {
    const fixture = await create();
    let movedInZone: boolean | null = null;
    runtime.pick.and.callFake(() => { movedInZone = NgZone.isInAngularZone(); return null; });
    const host: HTMLElement = fixture.nativeElement.querySelector('.town-scene');
    TestBed.inject(NgZone).run(() => host.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10, pointerId: 7, pointerType: 'mouse', bubbles: true })));
    expect(movedInZone).toBeFalse();
  });

  it('hands the runtime the scene, the server clock and the NPC names', async () => {
    await create();
    expect(init).not.toBeNull();
    expect(init!.def.mapId).toBe('map_town');
    expect(init!.now()).toBe(123);
    expect(init!.npcNames['blacksmith_loren']).toBe('Loren');
  });

  it('renders exactly 100 of 150 entries, always including the own character', async () => {
    entries.set([...Array.from({ length: 149 }, (_, i) => entry(`p${i}`)), entry('hero', { online: true, lastSeenAt: '2020-01-01T00:00:00.000Z' })]);
    const fixture = await create();
    fixture.detectChanges();
    const [rendered, selfId] = runtime.setCharacters.calls.mostRecent().args;
    expect(rendered.length).toBe(100);
    expect(rendered[0].characterId).toBe('hero');
    expect(selfId).toBe('hero');
  });

  it('a click on an NPC emits npcSelected', async () => {
    const fixture = await create();
    runtime.pick.and.returnValue({ kind: 'npc', id: 'blacksmith_loren' });
    const picked: string[] = [];
    fixture.componentInstance.npcSelected.subscribe(id => picked.push(id));
    const host: HTMLElement = fixture.nativeElement.querySelector('.town-scene');
    host.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointerup', { clientX: 102, clientY: 101, pointerId: 1, bubbles: true }));
    expect(picked).toEqual(['blacksmith_loren']);
    expect(moveTo).toHaveBeenCalledOnceWith({ npcId: 'blacksmith_loren' });
  });

  it('a click on empty ground marks the point and asks the server to walk there', async () => {
    const fixture = await create();
    runtime.pick.and.returnValue(null);
    runtime.groundPoint.and.returnValue([12.5, 30]);
    const host: HTMLElement = fixture.nativeElement.querySelector('.town-scene');
    host.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
    expect(runtime.markDestination).toHaveBeenCalledOnceWith(12.5, 30);
    expect(moveTo).toHaveBeenCalledOnceWith({ x: 12.5, z: 30 });
  });

  it('a click off the town ground (sky, outside the map) does nothing', async () => {
    const fixture = await create();
    runtime.pick.and.returnValue(null);
    runtime.groundPoint.and.returnValue(null);
    const host: HTMLElement = fixture.nativeElement.querySelector('.town-scene');
    host.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
    expect(moveTo).not.toHaveBeenCalled();
  });

  it('a click on a character emits characterSelected with the entry and the screen point', async () => {
    entries.set([entry('ana', { online: true })]);
    const fixture = await create();
    runtime.pick.and.returnValue({ kind: 'character', id: 'ana' });
    const picked: any[] = [];
    fixture.componentInstance.characterSelected.subscribe(e => picked.push(e));
    const host: HTMLElement = fixture.nativeElement.querySelector('.town-scene');
    const box = host.getBoundingClientRect();
    host.dispatchEvent(new PointerEvent('pointerdown', { clientX: box.left + 50, clientY: box.top + 40, pointerId: 1, bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointerup', { clientX: box.left + 50, clientY: box.top + 40, pointerId: 1, bubbles: true }));
    expect(picked.length).toBe(1);
    expect(picked[0].entry.characterId).toBe('ana');
    expect(picked[0].screen).toEqual([50, 40]);
  });

  it('a 20 px drag that ends over a character pans and never selects it', async () => {
    entries.set([entry('ana', { online: true })]);
    const fixture = await create();
    runtime.pick.and.returnValue({ kind: 'character', id: 'ana' });
    const picked: any[] = [];
    fixture.componentInstance.characterSelected.subscribe(e => picked.push(e));
    fixture.componentInstance.npcSelected.subscribe(e => picked.push(e));
    const host: HTMLElement = fixture.nativeElement.querySelector('.town-scene');
    host.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
    for (let x = 104; x <= 120; x += 4) host.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: 100, pointerId: 1, bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointerup', { clientX: 120, clientY: 100, pointerId: 1, bubbles: true }));
    expect(picked).toEqual([]);
    expect(runtime.pick).not.toHaveBeenCalled();
    expect(runtime.pan).toHaveBeenCalled();
  });

  it('a drag that returns to its start is still a drag (path length counts)', async () => {
    const fixture = await create();
    runtime.pick.and.returnValue({ kind: 'npc', id: 'blacksmith_loren' });
    const picked: string[] = [];
    fixture.componentInstance.npcSelected.subscribe(id => picked.push(id));
    const host: HTMLElement = fixture.nativeElement.querySelector('.town-scene');
    host.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointermove', { clientX: 115, clientY: 100, pointerId: 1, bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
    expect(picked).toEqual([]);
  });

  it('hovering another player or an NPC shows a pointer cursor; myself and empty ground do not', async () => {
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement.querySelector('.town-scene');
    const hover = (hit: any) => {
      runtime.pick.and.returnValue(hit);
      host.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 60, pointerId: 1, pointerType: 'mouse', bubbles: true }));
      fixture.detectChanges();
      return host.classList.contains('town-scene--pickable');
    };
    expect(hover({ kind: 'character', id: 'ana' })).toBeTrue();
    expect(hover({ kind: 'npc', id: 'blacksmith_loren' })).toBeTrue();
    expect(hover({ kind: 'character', id: 'hero' })).toBeFalse();
    expect(hover(null)).toBeFalse();
  });

  it('hidden behind the map view: keeps its runtime and only pauses it', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('active', false);
    fixture.detectChanges();
    expect(runtime.setActive).toHaveBeenCalledWith(false);
    expect(runtime.dispose).not.toHaveBeenCalled();
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    expect(runtime.setActive).toHaveBeenCalledWith(true);
  });

  it('passes the selection (blue ring) to the runtime', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('selection', { kind: 'character', id: 'ana' });
    fixture.detectChanges();
    expect(runtime.setSelection).toHaveBeenCalledWith({ kind: 'character', id: 'ana' });
    fixture.componentRef.setInput('selection', { kind: 'npc', id: 'blacksmith_loren' });
    fixture.detectChanges();
    expect(runtime.setSelection).toHaveBeenCalledWith({ kind: 'npc', id: 'blacksmith_loren' });
  });

  it('disposes the runtime when destroyed', async () => {
    const fixture = await create();
    fixture.destroy();
    expect(runtime.dispose).toHaveBeenCalled();
  });

  it('a click on a vase asks the store to break it (no ground walk)', async () => {
    const fixture = await create();
    runtime.pick.and.returnValue({ kind: 'vase', id: 'v007' });
    const host: HTMLElement = fixture.nativeElement.querySelector('.town-scene');
    host.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
    expect(breakVase).toHaveBeenCalledOnceWith('v007');
    expect(moveTo).not.toHaveBeenCalled();
    expect(runtime.markDestination).not.toHaveBeenCalled();
  });

  it('feeds the live vases to the runtime and gives the store the self position', async () => {
    await create();
    const vases = [{ id: 'v000', x: 1, z: 2, rot: 0, variant: 0 }];
    vaseEvent.set({ eventKey: 'ss-1', endsAt: 999, vases });
    TestBed.flushEffects();
    expect(runtime.setVases).toHaveBeenCalledWith(vases);
    expect(setSelfPosition).toHaveBeenCalled();
    runtime.selfPosition.and.returnValue([4, 5]);
    const provider = setSelfPosition.calls.mostRecent().args[0];
    expect(provider()).toEqual([4, 5]);
    vaseEvent.set(null);
    TestBed.flushEffects();
    expect(runtime.setVases).toHaveBeenCalledWith(null);
  });

  it('a vase break plays the effect and a shatter that is quieter far away', async () => {
    await create();
    jasmine.clock().install();
    try {
    runtime.breakVase.and.returnValue([10, 0]);
    runtime.selfPosition.and.returnValue([0, 0]);
    vaseBreaks.next({ mapId: 'map_town', eventKey: 'ss-1', vaseId: 'v001', byCharacterId: 'ana', at: 1, prize: true });
    expect(runtime.breakVase).toHaveBeenCalledOnceWith('v001', 'ana', true);
    expect(audio.playAt).not.toHaveBeenCalled();
    jasmine.clock().tick(VASE_CONTACT_MS);
    const near = audio.playAt.calls.mostRecent().args;
    expect(near[0]).toBe('pot_shatter');
    expect(near[1].volume).toBeCloseTo(0.5, 2);
    expect(near[1].rate).toBeGreaterThanOrEqual(0.92);
    expect(near[1].rate).toBeLessThanOrEqual(1.08);
    runtime.breakVase.and.returnValue([40, 0]);
    vaseBreaks.next({ mapId: 'map_town', eventKey: 'ss-1', vaseId: 'v002', byCharacterId: 'ana', at: 2, prize: false });
    jasmine.clock().tick(VASE_CONTACT_MS);
    expect(audio.playAt.calls.mostRecent().args[1].volume).toBeCloseTo(0.15, 2);
    runtime.breakVase.and.returnValue(null);
    const calls = audio.playAt.calls.count();
    vaseBreaks.next({ mapId: 'map_town', eventKey: 'ss-1', vaseId: 'gone', byCharacterId: 'ana', at: 3, prize: false });
    jasmine.clock().tick(VASE_CONTACT_MS);
    expect(audio.playAt.calls.count()).toBe(calls);
    } finally { jasmine.clock().uninstall(); }
  });

  it('hovering a vase shows the pointer and highlights it', async () => {
    const fixture = await create();
    runtime.pick.and.returnValue({ kind: 'vase', id: 'v003' });
    const host: HTMLElement = fixture.nativeElement.querySelector('.town-scene');
    host.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50, pointerId: 2, bubbles: true }));
    expect(fixture.componentInstance.hovering()).toBeTrue();
    expect(runtime.setHoveredVase).toHaveBeenCalledWith('v003');
  });
});
