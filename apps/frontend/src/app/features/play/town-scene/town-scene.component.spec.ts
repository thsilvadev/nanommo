import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { TownRosterEntry, TownSceneDef } from '@nanommo/shared';
import { CharacterStore } from '../../../core/game.store';
import { PartyStore } from '../../../core/party.store';
import { ServerClockService } from '../../../core/server-clock.service';
import { TownStore } from '../../../core/town.store';
import { CatalogService } from '../../../core/catalog.service';
import { TownSceneComponent } from './town-scene.component';
import { TOWN_SCENE_ENV, type TownSceneRuntimeHandle, type TownSceneRuntimeInit } from './town-scene.types';
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

  beforeEach(() => {
    init = null;
    runtime = jasmine.createSpyObj<TownSceneRuntimeHandle>('runtime', ['setCharacters', 'setSelection', 'setActive', 'pick', 'pan', 'zoom', 'resize', 'dispose', 'screenPositionOf']);
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
        { provide: TownStore, useValue: { entries, mapId: signal('map_town') } },
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
});
