import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ApiService } from './api.service';
import { Character, InventoryItem } from './game.models';
import { BattleStore, CharacterStore, InventoryStore } from './game.store';
import { GameSocketService } from './game.socket.service';

const character = (hp: number, sp: number): Character => ({
  id: 'char-1', userId: 'user-1', name: 'Tester', dominantHand: 'right', level: 1, xp: 0, xpToNext: 10,
  unspentAttributePoints: 0, attributeBonuses: {}, str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5,
  gold: 0, soulTokens: 0, hpCurrent: hp, spCurrent: sp, maxHp: 100, maxSp: 50, attack: 10, magicAttack: 0,
  defense: 0, attackSpeed: 1, castTimeReduction: 10, evasion: 5, accuracy: 5,
  hpRegenPerTenTicks: 3, spRegenPerTenTicks: 3, criticalChance: 1,
  hungry: false, foodBuffExpiresAt: new Date(Date.now()+3600000).toISOString(), diet: [], dietLevels: {}, autoFeed: false, status: 'grinding', currentMapId: 'map_lv_1',
  lastSeenAt: new Date().toISOString(), createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(), stateVersion: 1,
});

const item = (quantity: number): InventoryItem => ({
  id: 'item-1', characterId: 'char-1', location: 'inventory', slotIndex: 0,
  itemId: 'pot_hp_small', quantity,
});

describe('realtime resource synchronization', () => {
  let api: jasmine.SpyObj<ApiService>;

  let gameSocketEvents: Map<string, Subject<any>>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'put', 'delete']);
    gameSocketEvents = new Map<string, Subject<any>>();
    const socket = {
      on: (event: string) => {
        let subject = gameSocketEvents.get(event);
        if (!subject) { subject = new Subject<any>(); gameSocketEvents.set(event, subject); }
        return subject.asObservable();
      },
      onConnectionState: () => new Subject<any>().asObservable(),
    };
    TestBed.configureTestingModule({providers: [
      CharacterStore,
      InventoryStore,
      BattleStore,
      {provide: GameSocketService, useValue: socket},
      {provide: ApiService, useValue: api},
    ]});
  });

  it('discards an old Character HTTP response after a newer realtime snapshot', async () => {
    const response = new Subject<Character | null>();
    api.get.and.returnValue(response.asObservable() as any);
    const store = TestBed.inject(CharacterStore);
    store.applyRealtimeSnapshot(character(70, 35), 200);

    const load = store.load();
    response.next(character(40, 20));
    response.complete();
    await load;

    expect(store.character()?.hpCurrent).toBe(70);
    expect(store.character()?.spCurrent).toBe(35);
  });

  it('shares one in-flight /characters request between load and diet refresh', async () => {
    const response = new Subject<Character | null>();
    api.get.and.returnValue(response.asObservable() as any);
    const store = TestBed.inject(CharacterStore);

    const load = store.load();
    const refresh = store.refreshDiet();
    expect(api.get).toHaveBeenCalledTimes(1);

    response.next(character(50, 25));
    response.complete();
    await Promise.all([load, refresh]);

    expect(store.character()?.hpCurrent).toBe(50);
    expect(store.character()?.spCurrent).toBe(25);
  });

  it('refreshes a persisted stance from a same-revision Character GET', async () => {
    const response = new Subject<Character | null>();
    api.get.and.returnValue(response.asObservable() as any);
    const store = TestBed.inject(CharacterStore);
    store.applyRealtimeSnapshot({...character(70, 35), lastGrindStance: 'hunting'}, 200);

    const load = store.load();
    response.next({...character(70, 35), lastGrindStance: 'gathering', stateVersion: 200});
    response.complete();
    await load;

    expect(store.character()?.lastGrindStance).toBe('gathering');
  });

  it('merges the persisted stance from an older-revision GET without replacing newer Character state', async () => {
    const response = new Subject<Character | null>();
    api.get.and.returnValue(response.asObservable() as any);
    const store = TestBed.inject(CharacterStore);
    store.applyRealtimeSnapshot({...character(70, 35), lastGrindStance: 'hunting'}, 200);

    const load = store.load();
    response.next({...character(40, 20), lastGrindStance: 'gathering', stateVersion: 199});
    response.complete();
    await load;

    expect(store.character()?.lastGrindStance).toBe('gathering');
    expect(store.character()?.hpCurrent).toBe(70);
    expect(store.character()?.spCurrent).toBe(35);
  });

  it('keeps the server-confirmed Gathering stance against a newer but older-timestamp socket snapshot', () => {
    const store = TestBed.inject(CharacterStore);
    store.applyRealtimeSnapshot({
      ...character(70, 35), lastGrindStance: 'hunting',
      updatedAt: '2026-10-21T17:00:00.000Z', stateVersion: 200,
    }, 200);

    // Stance can change without stateVersion moving past a concurrent update.
    store.applyConfirmedStance('gathering', {
      ...character(70, 35), lastGrindStance: 'gathering',
      updatedAt: '2026-10-21T17:01:00.000Z', stateVersion: 199,
    });

    // This snapshot has a higher resource revision but was built before the stance change.
    store.applyRealtimeSnapshot({
      ...character(20, 10), lastGrindStance: 'hunting',
      updatedAt: '2026-10-21T17:00:30.000Z', stateVersion: 201,
    }, 201);

    expect(store.character()?.lastGrindStance).toBe('gathering');
    expect(store.character()?.stateVersion).toBe(201);
    expect(store.character()?.hpCurrent).toBe(20);
  });

  it('ignores a stale full-Character patch after a newer realtime snapshot', () => {
    const store = TestBed.inject(CharacterStore);
    store.applyRealtimeSnapshot({
      ...character(70, 35), lastGrindStance: 'gathering', stateVersion: 202,
    }, 202);

    store.applyPatch({
      ...character(20, 10), lastGrindStance: 'hunting', stateVersion: 201,
    });

    expect(store.character()?.lastGrindStance).toBe('gathering');
    expect(store.character()?.stateVersion).toBe(202);
    expect(store.character()?.hpCurrent).toBe(70);
  });

  it('advances the revision watermark for an accepted attribute mutation response', async () => {
    const response = new Subject<Character>();
    api.post.and.returnValue(response.asObservable() as any);
    const store = TestBed.inject(CharacterStore);
    store.applyRealtimeSnapshot({
      ...character(70, 35), lastGrindStance: 'hunting', stateVersion: 200,
    }, 200);

    const mutation = store.spend({str: 1});
    response.next({
      ...character(70, 35), lastGrindStance: 'gathering', stateVersion: 201,
    });
    response.complete();
    await mutation;

    store.applyRealtimeSnapshot({
      ...character(20, 10), lastGrindStance: 'hunting', stateVersion: 200,
    }, 200);

    expect(store.character()?.lastGrindStance).toBe('gathering');
    expect(store.character()?.stateVersion).toBe(201);
    expect(store.character()?.hpCurrent).toBe(70);
  });

  it('discards an old Inventory HTTP response after a newer realtime snapshot', async () => {
    const inventoryResponse = new Subject<{items: InventoryItem[]; stateVersion: number}>();
    const equipmentResponse = new Subject<any[]>();
    api.get.and.callFake((endpoint: string) =>
      (endpoint === '/inventory' ? inventoryResponse : equipmentResponse).asObservable() as any,
    );
    const store = TestBed.inject(InventoryStore);
    store.applyRealtimeSnapshot([item(17)], 200);

    const load = store.load();
    inventoryResponse.next({items: [item(9)], stateVersion: 199});
    inventoryResponse.complete();
    equipmentResponse.next([]);
    equipmentResponse.complete();
    await load;

    expect(store.items()[0].quantity).toBe(17);
  });

  it('ignores an older realtime Character snapshot and accepts a newer one', () => {
    const store = TestBed.inject(CharacterStore);
    store.applyRealtimeSnapshot(character(70, 35), 200);
    store.applyRealtimeSnapshot(character(20, 10), 199);
    expect(store.character()?.hpCurrent).toBe(70);
    expect(store.character()?.spCurrent).toBe(35);

    store.applyRealtimeSnapshot(character(60, 30), 201);
    expect(store.character()?.hpCurrent).toBe(60);
    expect(store.character()?.spCurrent).toBe(30);
  });

  it('keeps Inventory monotonic across battle-resolved -> searching -> next update', () => {
    const store = TestBed.inject(InventoryStore);
    store.applyRealtimeSnapshot([item(18)], 300);
    expect(store.items()[0].quantity).toBe(18);

    store.applyRealtimeSnapshot([item(12)], 299);
    expect(store.items()[0].quantity).toBe(18);

    store.applyRealtimeSnapshot([item(16)], 301);
    expect(store.items()[0].quantity).toBe(16);
  });

  it('does not let an older in-flight queue GET overwrite a newer realtime queue update', async () => {
    const oldResponse = new Subject<any[]>();
    api.get.and.returnValue(oldResponse.asObservable() as any);
    const characterStore = TestBed.inject(CharacterStore);
    const inventoryStore = TestBed.inject(InventoryStore);
    const battleStore = TestBed.inject(BattleStore);
    battleStore.bindEvents(characterStore, inventoryStore);
    const load = battleStore.load();

    const nextBattle = {
      id: 'battle-next', characterId: 'char-1', sequenceIndex: 2,
      mapId: 'map_lv_1', monsterId: 'mon_slime',
      startAt: new Date(Date.now() + 2000).toISOString(), endAt: new Date(Date.now() + 10000).toISOString(),
      outcome: 'win', log: {}, xpGain: 10, goldGain: 0, drops: [], itemsConsumed: [],
      hpAfter: 30, spAfter: 15, resolved: false, seedUsed: 'seed-next',
    };
    gameSocketEvents.get('battle:queueUpdated')!.next({entries: [nextBattle]});
    oldResponse.next([{
      ...nextBattle, id: 'battle-dead-field-bat', sequenceIndex: 1, monsterId: 'mon_fieldbat',
      startAt: new Date(Date.now() - 10000).toISOString(), endAt: new Date(Date.now() - 1).toISOString(),
      log: {durationTicks: 10, header: {monsterSnapshot: {hp: 81}}, events: [{tick: 10, action: 'attack', hpRemaining: {monster: 0}}]},
    }]);
    oldResponse.complete();
    await load;
    expect(battleStore.active()?.id).toBe('battle-next');
  });

  it('never projects an old map battle as active after the Character settles in Town', () => {
    const characterStore = TestBed.inject(CharacterStore);
    const inventoryStore = TestBed.inject(InventoryStore);
    const battleStore = TestBed.inject(BattleStore);
    characterStore.applyRealtimeSnapshot(character(824, 50), 10);
    battleStore.bindEvents(characterStore, inventoryStore);
    const staleBattle = {
      id: 'battle-old-map', characterId: 'char-1', sequenceIndex: 0,
      mapId: 'map_lv_1', monsterId: 'mon_slime',
      startAt: new Date(Date.now() - 1000).toISOString(), endAt: new Date(Date.now() + 10000).toISOString(),
      outcome: 'loss', log: { header: { characterSnapshot: { hp: 158, sp: 20 } }, events: [{ tick: 1, action: 'status_damage', target: 'character', damage: 3, hpRemaining: { character: 155 } }] },
      hpAfter: 152, spAfter: 20, resolved: false, seedUsed: 'stale',
    };
    gameSocketEvents.get('battle:queueUpdated')!.next({entries: [staleBattle]});
    expect(battleStore.active()?.id).toBe('battle-old-map');

    characterStore.applyRealtimeSnapshot({
      ...character(824, 50), status: 'town', currentMapId: 'map_town', stateVersion: 11,
    }, 11);

    expect(battleStore.active()).toBeNull();
    expect(battleStore.currentBattleCharacterResources()).toBeNull();
    battleStore.ngOnDestroy();
  });

  it('removes a battle from the visible queue as soon as battle:resolved arrives and ignores stale re-adds', () => {
    const characterStore = TestBed.inject(CharacterStore);
    const inventoryStore = TestBed.inject(InventoryStore);
    const battleStore = TestBed.inject(BattleStore);
    battleStore.bindEvents(characterStore, inventoryStore);
    const dead = {
      id: 'battle-dead', characterId: 'char-1', sequenceIndex: 1,
      mapId: 'map_lv_1', monsterId: 'mon_fieldbat',
      startAt: new Date(Date.now() - 10000).toISOString(), endAt: new Date(Date.now() - 1).toISOString(),
      outcome: 'win', log: {}, xpGain: 10, goldGain: 0, drops: [], itemsConsumed: [],
      hpAfter: 40, spAfter: 15, resolved: false, seedUsed: 'old',
    };
    const next = {...dead, id: 'battle-next', sequenceIndex: 2, monsterId: 'mon_slime',
      startAt: new Date(Date.now() + 2000).toISOString(), endAt: new Date(Date.now() + 10000).toISOString()};
    gameSocketEvents.get('battle:queueUpdated')!.next({entries: [dead, next]});
    gameSocketEvents.get('battle:resolved')!.next({
      entryId: 'battle-dead', outcome: 'win', xpGain: 10, goldGain: 0, drops: [],
      stateRevision: 2, characterAfter: character(40, 15), inventoryAfter: [item(1)],
    });
    expect(battleStore.active()?.id).toBe('battle-next');
    gameSocketEvents.get('battle:queueUpdated')!.next({entries: [dead, next]});
    expect(battleStore.active()?.id).toBe('battle-next');
  });

  it('shows a travel encounter when queueUpdated carries the authoritative source-map snapshot', () => {
    const characterStore = TestBed.inject(CharacterStore);
    const inventoryStore = TestBed.inject(InventoryStore);
    const battleStore = TestBed.inject(BattleStore);
    characterStore.applyRealtimeSnapshot({
      ...character(824, 50), status: 'town', currentMapId: 'map_town', stateVersion: 10,
    }, 10);
    battleStore.bindEvents(characterStore, inventoryStore);

    const startedAt = new Date(Date.now() - 1000).toISOString();
    const endsAt = new Date(Date.now() + 14000).toISOString();
    gameSocketEvents.get('battle:queueUpdated')!.next({
      entries: [{
        id: 'travel-encounter', characterId: 'char-1', sequenceIndex: 0,
        mapId: 'map_lv_1', monsterId: 'mon_slime',
        startAt: startedAt, endAt: endsAt, outcome: 'loss', log: {},
        xpGain: 0, goldGain: 0, drops: [], itemsConsumed: [],
        hpAfter: 0, spAfter: 0, resolved: false, seedUsed: 'travel-seed',
      }],
      stateRevision: 11,
      characterAfter: {
        ...character(824, 50), status: 'grinding', currentMapId: 'map_lv_1',
        travelIntent: { kind: 'route', waitingForBattle: true, segmentProgress: 0.99 },
        stateVersion: 11,
      },
      inventoryAfter: [item(1)],
    });

    expect(characterStore.character()?.travelIntent?.waitingForBattle).toBeTrue();
    expect(battleStore.active()?.id).toBe('travel-encounter');
    battleStore.ngOnDestroy();
  });

  it('applies the authoritative Character and Inventory snapshot from queueUpdated before searching', () => {
    const characterStore = TestBed.inject(CharacterStore);
    const inventoryStore = TestBed.inject(InventoryStore);
    const battleStore = TestBed.inject(BattleStore);
    characterStore.applyRealtimeSnapshot(character(40, 20), 10);
    inventoryStore.applyRealtimeSnapshot([item(9)], 10);
    battleStore.bindEvents(characterStore, inventoryStore);

    gameSocketEvents.get('battle:queueUpdated')!.next({
      entries: [{
        id: 'battle-next', characterId: 'char-1', sequenceIndex: 2,
        mapId: 'map_lv_1', monsterId: 'mon_slime',
        startAt: new Date(Date.now() + 2000).toISOString(), endAt: new Date(Date.now() + 10000).toISOString(),
        outcome: 'win', log: {}, xpGain: 10, goldGain: 0, drops: [], itemsConsumed: [],
        hpAfter: 30, spAfter: 15, resolved: false, seedUsed: 'seed',
      }],
      stateRevision: 11,
      characterAfter: character(70, 35),
      inventoryAfter: [item(18)],
    });

    expect(characterStore.character()?.hpCurrent).toBe(70);
    expect(characterStore.character()?.spCurrent).toBe(35);
    expect(inventoryStore.items()[0].quantity).toBe(18);
  });

  it('recovers a missing realtime battle queue while the character is grinding', () => {
    const response = new Subject<any[]>();
    api.get.and.returnValue(response.asObservable() as any);
    const characterStore = TestBed.inject(CharacterStore);
    const inventoryStore = TestBed.inject(InventoryStore);
    const battleStore = TestBed.inject(BattleStore);
    characterStore.applyRealtimeSnapshot(character(40, 20), 10);
    battleStore.bindEvents(characterStore, inventoryStore);
    const missedBattle = {
      id: 'battle-recovered', characterId: 'char-1', sequenceIndex: 0,
      mapId: 'map_lv_1', monsterId: 'mon_venomviper',
      startAt: new Date(Date.now() - 1000).toISOString(), endAt: new Date(Date.now() + 20000).toISOString(),
      outcome: 'loss', log: {}, xpGain: 0, goldGain: 0, drops: [], itemsConsumed: [],
      hpAfter: 0, spAfter: 0, resolved: false, seedUsed: 'seed-recovered',
    };

    (battleStore as any).reconcileMissingBattleQueue();
    response.next([missedBattle]);
    response.complete();

    expect(battleStore.active()?.id).toBe('battle-recovered');
    battleStore.ngOnDestroy();
  });
});
