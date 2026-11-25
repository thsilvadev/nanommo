import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CatalogService } from '../../../core/catalog.service';
import { BattleStore, CharacterStore } from '../../../core/game.store';
import { ARENA_MONSTER_WARMUP_ENV, ArenaMonsterWarmup, type ArenaMonsterWarmupEnv } from './arena-monster-warmup.service';

describe('ArenaMonsterWarmup', () => {
  const MAPS = [
    { id: 'map_a', coordinates: { x: 0, y: 0 }, monsters: [{ monsterId: 'mon_slime' }] },
    { id: 'map_b', coordinates: { x: 1, y: 0 }, monsters: [{ monsterId: 'mon_bat', raid: { candidates: [{ monsterId: 'mon_wolf' }] } }] },
    { id: 'map_c', coordinates: { x: 2, y: 0 }, monsters: [{ monsterId: 'mon_bear' }] },
    { id: 'map_d', coordinates: { x: 3, y: 0 }, monsters: [{ monsterId: 'mon_eel' }] },
  ];
  let calls: Array<['warm' | 'release', string[]]>;
  let warmGate: Array<() => void>;
  let gateWarm: boolean;
  let character: ReturnType<typeof signal<any>>;
  let queue: ReturnType<typeof signal<any[]>>;
  let maps: ReturnType<typeof signal<any[]>>;

  function service(): ArenaMonsterWarmup {
    TestBed.resetTestingModule();
    const env: ArenaMonsterWarmupEnv = {
      warm: (ids) => { calls.push(['warm', ids]); return gateWarm ? new Promise<void>((r) => warmGate.push(r)) : Promise.resolve(); },
      release: (ids) => { calls.push(['release', ids]); return 0; },
    };
    TestBed.configureTestingModule({ providers: [
      { provide: ARENA_MONSTER_WARMUP_ENV, useValue: env },
      { provide: CharacterStore, useValue: { character } },
      { provide: BattleStore, useValue: { queue } },
      { provide: CatalogService, useValue: { maps } },
    ] });
    return TestBed.inject(ArenaMonsterWarmup);
  }
  const settle = async () => { TestBed.flushEffects(); for (let i = 0; i < 5; i++) await Promise.resolve(); };

  beforeEach(() => {
    calls = []; warmGate = []; gateWarm = false;
    character = signal<any>({ id: 'c1', currentMapId: 'map_a' });
    queue = signal<any[]>([]);
    maps = signal<any[]>(MAPS);
  });

  it('the loading screen warms the map and its neighbours', async () => {
    const warmup = service();
    await warmup.preload();
    expect(calls[0]).toEqual(['warm', ['mon_bat', 'mon_slime', 'mon_wolf']]);
    expect(calls.filter(([k]) => k === 'warm').every(([, ids]) => ids.join() === 'mon_bat,mon_slime,mon_wolf')).toBeTrue();
  });

  it('a map change warms the new neighbours, then releases what is out of range', async () => {
    const warmup = service();
    await settle();
    calls = [];
    character.set({ id: 'c1', currentMapId: 'map_c' });
    await settle();
    const next = ['mon_bat', 'mon_bear', 'mon_eel', 'mon_wolf'];
    expect(warmup.wanted()).toEqual(next);
    expect(calls).toEqual([['warm', next], ['release', next]]);
  });

  it('species in the queue are kept', async () => {
    queue.set([{ id: 'e1', monsterId: 'mon_far', log: { header: { v2Input: { actors: [{ kind: 'character', id: 'c1' }, { kind: 'monster', definitionId: 'mon_raider' }] } } } }]);
    const warmup = service();
    await settle();
    expect(warmup.wanted()).toContain('mon_far');
    expect(warmup.wanted()).toContain('mon_raider');
    const releases = calls.filter(([k]) => k === 'release');
    expect(releases.length).toBeGreaterThan(0);
    expect(releases[releases.length - 1][1]).toContain('mon_far');
  });

  it('no map yet or no catalogue: preload still finishes, nothing released', async () => {
    character.set(null);
    const a = service();
    await expectAsync(a.preload(undefined, 50)).toBeResolved();
    await settle();
    maps.set([]);
    character.set({ id: 'c1', currentMapId: 'map_a' });
    const b = service();
    await expectAsync(b.preload(undefined, 50)).toBeResolved();
    await settle();
    expect(calls.filter(([k]) => k === 'release')).toEqual([]);
    expect(calls.filter(([k]) => k === 'warm')).toEqual([]);
  });

  it('a hop finished after a newer hop started does not release the newer set', async () => {
    service();
    await settle();
    gateWarm = true; calls = [];
    character.set({ id: 'c1', currentMapId: 'map_b' });
    await settle();
    character.set({ id: 'c1', currentMapId: 'map_d' });
    await settle();
    warmGate.forEach((open) => open());
    await settle();
    const releases = calls.filter(([k]) => k === 'release').map(([, ids]) => ids);
    expect(releases).toEqual([['mon_bear', 'mon_eel']]);
  });
});
