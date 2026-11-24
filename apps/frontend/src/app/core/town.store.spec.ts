import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { TownRosterEntry } from '@nanommo/shared';
import { GameSocketService } from './game.socket.service';
import { CharacterStore, InventoryStore } from './game.store';
import { ServerClockService } from './server-clock.service';
import { TownStore } from './town.store';

const entry = (characterId: string, extra: Partial<TownRosterEntry> = {}): TownRosterEntry => ({
  characterId, name: characterId.toUpperCase(), level: 1, appearance: null, sex: null, heightCm: null, seed: 1, online: true,
  sleeping: null, wakeFrom: null, lastSeenAt: '2026-11-18T00:00:00.000Z', ...extra,
});

describe('TownStore', () => {
  let events: Map<string, Subject<any>>;
  let connection: Subject<string>;
  let socket: any;
  let clock: jasmine.SpyObj<ServerClockService>;
  let character: ReturnType<typeof signal<any>>;
  let store: TownStore;

  beforeEach(() => {
    events = new Map();
    connection = new Subject();
    socket = {
      connect: () => {},
      on: (event: string) => { const s = new Subject(); events.set(event, s); return s; },
      onConnectionState: () => connection,
      emit: jasmine.createSpy('emit').and.callFake(async (event: string) => {
        if (event === 'town:syncRoster') return { mapId: 'map_town', serverNow: 1, entries: [entry('hero')] };
        if (event === 'town:sleep') return { success: true, entry: entry('hero', { sleeping: { at: 5 } }) };
        if (event === 'town:wake') return { success: true, entry: entry('hero', { wakeFrom: { x: 1, z: 2, at: 6 } }) };
        return {};
      }),
    };
    clock = jasmine.createSpyObj('ServerClockService', ['now', 'seed', 'sync']);
    clock.sync.and.resolveTo();
    character = signal<any>({ id: 'hero', currentMapId: 'map_town' });
    TestBed.configureTestingModule({ providers: [
      TownStore,
      { provide: GameSocketService, useValue: socket },
      { provide: ServerClockService, useValue: clock },
      { provide: CharacterStore, useValue: { character } },
    ] });
    store = TestBed.inject(TownStore);
    store.start();
  });
  afterEach(() => store.stop());

  const ids = () => store.entries().map(e => e.characterId);

  it('applies roster → join → update(sleep) → leave in order', () => {
    events.get('town:roster')!.next({ mapId: 'map_town', serverNow: 1000, entries: [entry('hero'), entry('a')] });
    expect(store.mapId()).toBe('map_town');
    expect(ids()).toEqual(['hero', 'a']);
    expect(clock.seed).toHaveBeenCalledWith(1000);

    events.get('town:join')!.next({ mapId: 'map_town', entry: entry('b') });
    expect(ids()).toEqual(['hero', 'a', 'b']);

    events.get('town:update')!.next({ mapId: 'map_town', entry: entry('a', { sleeping: { at: 42 } }) });
    expect(store.entries().find(e => e.characterId === 'a')!.sleeping).toEqual({ at: 42 });

    events.get('town:leave')!.next({ mapId: 'map_town', characterId: 'a' });
    expect(ids()).toEqual(['hero', 'b']);
  });

  it('my own town:leave (trip start) closes my town and resyncs; my own town:join reopens it', async () => {
    events.get('town:roster')!.next({ mapId: 'map_town', serverNow: 1, entries: [entry('hero'), entry('a')] });
    socket.emit.calls.reset();
    socket.emit.and.callFake(async (event: string) => event === 'town:syncRoster' ? { mapId: null, serverNow: 2, entries: [] } : {});
    events.get('town:leave')!.next({ mapId: 'map_town', characterId: 'hero' });
    expect(store.mapId()).toBeNull();
    expect(store.isTown('map_town')).toBeFalse();
    expect(store.entries()).toEqual([]);
    socket.emit.and.callFake(async (event: string) => event === 'town:syncRoster' ? { mapId: 'map_town', serverNow: 3, entries: [entry('hero')] } : {});
    events.get('town:join')!.next({ mapId: 'map_town', entry: entry('hero') });
    await Promise.resolve(); await Promise.resolve();
    expect(socket.emit).toHaveBeenCalledWith('town:syncRoster', undefined);
    expect(store.mapId()).toBe('map_town');
  });

  it('ignores deltas for another mapId', () => {
    events.get('town:roster')!.next({ mapId: 'map_town', serverNow: 1, entries: [entry('hero')] });
    events.get('town:join')!.next({ mapId: 'map_aramaia_city', entry: entry('x') });
    events.get('town:update')!.next({ mapId: 'map_aramaia_city', entry: entry('hero', { sleeping: { at: 1 } }) });
    events.get('town:leave')!.next({ mapId: 'map_aramaia_city', characterId: 'hero' });
    expect(ids()).toEqual(['hero']);
    expect(store.entries()[0].sleeping).toBeNull();
  });

  it('isTown only for the town the server put us in', () => {
    expect(store.isTown('map_town')).toBeFalse();
    events.get('town:roster')!.next({ mapId: 'map_town', serverNow: 1, entries: [] });
    expect(store.isTown('map_town')).toBeTrue();
    expect(store.isTown('map_outpost')).toBeFalse();
    expect(store.isTown(null)).toBeFalse();
  });

  it('resyncs the roster and the clock when the socket connects', async () => {
    connection.next('connected');
    await Promise.resolve(); await Promise.resolve();
    expect(socket.emit).toHaveBeenCalledWith('town:syncRoster', undefined);
    expect(clock.sync).toHaveBeenCalled();
    expect(store.mapId()).toBe('map_town');
  });

  it('sleep() and wake() apply the authoritative entry', async () => {
    events.get('town:roster')!.next({ mapId: 'map_town', serverNow: 1, entries: [entry('hero')] });
    await store.sleep();
    expect(store.self()!.sleeping).toEqual({ at: 5 });
    await store.wake();
    expect(store.self()!.sleeping).toBeNull();
    expect(store.self()!.wakeFrom).toEqual({ x: 1, z: 2, at: 6 });
  });

  it('sleep() rejects with the server error code', async () => {
    socket.emit.and.resolveTo({ success: false, error: 'NOT_IN_TOWN' });
    await expectAsync(store.sleep()).toBeRejectedWithError('NOT_IN_TOWN');
  });
});

describe('TownStore — Smashing Spree vases', () => {
  let events: Map<string, Subject<any>>;
  let socket: any;
  let clock: jasmine.SpyObj<ServerClockService>;
  let store: TownStore;
  let selfPos: [number, number] | null;
  let inventory: { load: jasmine.Spy };
  const vases = [{ id: 'v000', x: 10, z: 10, rot: 0, variant: 0 }, { id: 'v001', x: 20, z: 20, rot: 0, variant: 1 }];
  const hits = () => socket.emit.calls.allArgs().filter((a: any[]) => a[0] === 'town:hitVase');
  const moves = () => socket.emit.calls.allArgs().filter((a: any[]) => a[0] === 'town:move');

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(1_000_000));
    events = new Map();
    socket = {
      connect: () => {},
      on: (event: string) => { const s = new Subject(); events.set(event, s); return s; },
      onConnectionState: () => new Subject(),
      emit: jasmine.createSpy('emit').and.callFake(async (event: string) => {
        if (event === 'town:hitVase') return { success: true, vaseId: 'v000', prize: null };
        if (event === 'town:move') return { success: true, entry: entry('hero') };
        return {};
      }),
    };
    clock = jasmine.createSpyObj('ServerClockService', ['now', 'seed', 'sync']);
    clock.now.and.callFake(() => Date.now());
    clock.sync.and.resolveTo();
    inventory = { load: jasmine.createSpy('load').and.resolveTo() };
    TestBed.configureTestingModule({ providers: [
      TownStore,
      { provide: GameSocketService, useValue: socket },
      { provide: ServerClockService, useValue: clock },
      { provide: CharacterStore, useValue: { character: signal<any>({ id: 'hero', currentMapId: 'map_town' }) } },
      { provide: InventoryStore, useValue: inventory },
    ] });
    store = TestBed.inject(TownStore);
    store.start();
    selfPos = [10.5, 10];
    store.setSelfPosition(() => selfPos);
    events.get('town:roster')!.next({ mapId: 'map_town', serverNow: 1_000_000, entries: [entry('hero')], event: { eventKey: 'ss-1', mapId: 'map_town', endsAt: 1_120_000, vases } });
  });
  afterEach(() => { store.stop(); jasmine.clock().uninstall(); });

  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it('a roster snapshot with an event sets the live vases', () => {
    expect(store.vaseEvent()!.vases.map(v => v.id)).toEqual(['v000', 'v001']);
  });

  it('vaseBroken removes the vase and is re-emitted; ended clears the event', () => {
    const seen: any[] = [];
    store.vaseBreaks.subscribe(b => seen.push(b));
    events.get('town:event:vaseBroken')!.next({ mapId: 'map_town', eventKey: 'ss-1', vaseId: 'v001', byCharacterId: 'x', at: 1, prize: true });
    expect(store.vaseEvent()!.vases.map(v => v.id)).toEqual(['v000']);
    expect(seen).toEqual([jasmine.objectContaining({ vaseId: 'v001', byCharacterId: 'x', prize: true })]);
    events.get('town:event:ended')!.next({ mapId: 'map_town', eventKey: 'ss-1', reason: 'timeout' });
    expect(store.vaseEvent()).toBeNull();
  });

  it('town:event:vases for another town is ignored', () => {
    events.get('town:event:vases')!.next({ mapId: 'map_outpost', eventKey: 'ss-2', endsAt: 2_000_000, vases: [] });
    expect(store.vaseEvent()!.eventKey).toBe('ss-1');
  });

  it('the event clears itself when endsAt passes', () => {
    jasmine.clock().tick(120_001);
    expect(store.vaseEvent()).toBeNull();
  });

  it('in range: hits immediately without moving', async () => {
    await store.breakVase('v000');
    await flush();
    expect(hits()).toEqual([['town:hitVase', { vaseId: 'v000' }]]);
    expect(moves().length).toBe(0);
  });

  it('out of range: walks to the vase, then hits once on arrival', async () => {
    selfPos = [14, 10];
    await store.breakVase('v000');
    await flush();
    expect(moves()).toEqual([['town:move', { vaseId: 'v000' }]]);
    expect(hits().length).toBe(0);
    jasmine.clock().tick(500);
    await flush();
    expect(hits().length).toBe(0);
    selfPos = [10.6, 10];
    jasmine.clock().tick(150);
    await flush();
    jasmine.clock().tick(150);
    await flush();
    expect(hits()).toEqual([['town:hitVase', { vaseId: 'v000' }]]);
  });

  it('a second hit within 1000 ms waits for the cooldown', async () => {
    await store.breakVase('v000');
    await flush();
    socket.emit.and.callFake(async (event: string) => event === 'town:hitVase' ? { success: true, vaseId: 'v001', prize: null } : { success: true, entry: entry('hero') });
    selfPos = [20.3, 20];
    await store.breakVase('v001');
    await flush();
    expect(hits().length).toBe(1);
    jasmine.clock().tick(1100);
    await flush();
    expect(hits().length).toBe(2);
    expect(hits()[1]).toEqual(['town:hitVase', { vaseId: 'v001' }]);
  });

  it('a ground click cancels a pending hit', async () => {
    selfPos = [14, 10];
    await store.breakVase('v000');
    await store.moveTo({ x: 1, z: 1 });
    selfPos = [10.2, 10];
    jasmine.clock().tick(2000);
    await flush();
    expect(hits().length).toBe(0);
  });

  it('a prize that went to the bag reloads the inventory', async () => {
    socket.emit.and.callFake(async (event: string) => event === 'town:hitVase' ? { success: true, vaseId: 'v000', prize: { itemId: 'mega_elixir', quantity: 20, via: 'bag' } } : {});
    await store.breakVase('v000');
    await flush();
    expect(inventory.load).toHaveBeenCalled();
  });
});
