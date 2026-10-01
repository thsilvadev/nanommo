import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ApiService } from './api.service';
import { Character, InventoryItem } from './game.models';
import { CharacterStore, InventoryStore } from './game.store';

const character = (hp: number, sp: number): Character => ({
  id: 'char-1', userId: 'user-1', name: 'Tester', level: 1, xp: 0, xpToNext: 10,
  unspentAttributePoints: 0, str: 5, agi: 5, dex: 5, vit: 5, int: 5, sor: 5,
  gold: 0, hpCurrent: hp, spCurrent: sp, maxHp: 100, maxSp: 50, attack: 10,
  defense: 0, attackSpeed: 1, castSpeed: 1, evasion: 5, accuracy: 5,
  hpRegenPerTenTicks: 3, spRegenPerTenTicks: 3, criticalChance: 1,
  hungry: false, status: 'grinding', currentMapId: 'map_green_grounds',
  lastSeenAt: new Date().toISOString(), createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(), stateVersion: 1,
});

const item = (quantity: number): InventoryItem => ({
  id: 'item-1', characterId: 'char-1', location: 'inventory', slotIndex: 0,
  itemId: 'pot_hp_small', quantity,
});

describe('realtime resource synchronization', () => {
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'put', 'delete']);
    TestBed.configureTestingModule({providers: [
      CharacterStore,
      InventoryStore,
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
});
