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
import type { ArenaFrameSource, ArenaRuntimeHandle } from './arena-runtime';
import { SOLO_V2_ENTRY } from './fixtures/solo-v2.fixture';

describe('ArenaSceneComponent', () => {
  const START = Date.parse(SOLO_V2_ENTRY.startAt);
  let now = START + 2 * 500 + 100;
  let source: ArenaFrameSource | null = null;
  let active = false;
  const fake: ArenaRuntimeHandle = {
    setSource: (s) => { source = s; }, setActive: (a) => { active = a; }, isRendering: () => active, renderOnce: () => undefined, actorCount: () => 2,
    screenAnchors: () => new Map([['char-self', { x: 100, y: 200, visible: true }], ['monster:mon_mutantbee:0', { x: 500, y: 210, visible: true }]]),
    resize: () => undefined, dispose: () => undefined,
  };

  async function mount(isActive = true) {
    TestBed.configureTestingModule({
      imports: [ArenaSceneComponent],
      providers: [
        { provide: ARENA_SCENE_ENV, useValue: { webglAvailable: () => true, createRuntime: async () => fake } },
        { provide: CharacterStore, useValue: { character: signal({ id: 'char-self', currentMapId: 'map_green_grounds_2', appearance: defaultAppearance(), sex: 'male', heightCm: 181, dominantHand: 'right', gatheringCycle: { cycleIndex: 3 } }) } },
        { provide: InventoryStore, useValue: { equipment: signal([{ slot: 'mainHand', itemId: 'equip_bow_t1' }]) } },
        { provide: BattleStore, useValue: { queue: signal([SOLO_V2_ENTRY]), lastResolved: signal(null) } },
        { provide: PartyStore, useValue: { party: signal(null), battle: signal(null), nextEncounterAt: signal(null), members: signal([]) } },
        { provide: CatalogService, useValue: { item: (id: string) => (id === 'equip_bow_t1' ? { weaponType: 'bow' } : undefined) } },
        { provide: ServerClockService, useValue: { now: () => now } },
        { provide: LocaleService, useValue: { t: (s: string) => s } },
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
  afterEach(() => { source = null; active = false; });

  it('renders one HUD per actor with HP and SP bars', async () => {
    const fixture = await mount();
    source!(now);
    fixture.componentInstance.refreshHud();
    fixture.detectChanges();
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
    fixture.detectChanges();
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

  it('the viewing character uses its own equipment and bow style', async () => {
    const fixture = await mount();
    const frame = source!(now)!;
    expect(frame.visuals.get('char-self')!.look!.mainHandType).toBe('bow');
    fixture.destroy();
  });
});
