import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { TownRosterEntry } from '@nanommo/shared';
import { GameSocketService } from './game.socket.service';
import { CharacterStore } from './game.store';
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
