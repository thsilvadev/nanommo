import { computed, signal } from '@angular/core';
import { VendorStore, sellModalMaxQuantity } from './vendor.store';

describe('Vendor sell modal stack-scoped quantity', () => {
  it('limits All to the dragged stack instead of aggregating matching stacks', () => {
    // 80 potions are owned across four stacks of 20; only one row was dragged.
    expect(sellModalMaxQuantity(80, 20, true)).toBe(20);
  });

  it('caps the dragged quantity by the current owned total', () => {
    expect(sellModalMaxQuantity(12, 20, true)).toBe(12);
  });

  it('keeps non-stackable items limited to one', () => {
    expect(sellModalMaxQuantity(8, 8, false)).toBe(1);
  });

  it('preserves aggregate maximum when no selected stack quantity is supplied', () => {
    expect(sellModalMaxQuantity(80, undefined, true)).toBe(80);
  });
});


describe('Town NPC selection state', () => {
  function makeStore() {
    const store: any = Object.create(VendorStore.prototype);
    store.api = {
      get: jasmine.createSpy('get').and.returnValue({
        toPromise: () => Promise.resolve([
          { id: 'william', name: 'William', location: 'town', types: ['vendor'] },
          { id: 'father_marcelus', name: 'Father Marcelus', location: 'town', types: ['quest'] },
          { id: 'blacksmith_loren', name: 'Blacksmith Loren', location: 'town', types: ['vendor'] },
          { id: 'cecilia', name: 'Cecilia', location: 'town', types: ['quest'] },
          { id: 'storage', name: 'Storage', location: 'town', types: ['storage'] },
        ]),
      }),
    };
    store.character = {};
    store.inventory = {};
    store.catalog = {
      load: async () => {},
      townNpcsForMap: (mapId: string) => mapId === 'map_town' ? [
        { id: 'william', name: 'William', location: 'town', types: ['vendor'] },
        { id: 'father_marcelus', name: 'Father Marcelus', location: 'town', types: ['quest'] },
        { id: 'blacksmith_loren', name: 'Blacksmith Loren', location: 'town', types: ['vendor'] },
        { id: 'cecilia', name: 'Cecilia', location: 'town', types: ['quest'] },
        { id: 'storage', name: 'Storage', location: 'town', types: ['storage'] },
      ] : mapId === 'town_a' ? [{ id: 'town_a_vendor', name: 'Town A Vendor', location: 'town', types: ['vendor'] }] : mapId === 'town_b' ? [{ id: 'storage', name: 'Storage', location: 'town', types: ['storage'] }] : [],
    };
    store.npcs = signal<any[]>([
      { id: 'william', name: 'William', location: 'town', types: ['vendor'] },
      { id: 'father_marcelus', name: 'Father Marcelus', location: 'town', types: ['quest'] },
      { id: 'blacksmith_loren', name: 'Blacksmith Loren', location: 'town', types: ['vendor'] },
      { id: 'cecilia', name: 'Cecilia', location: 'town', types: ['quest'] },
      { id: 'storage', name: 'Storage', location: 'town', types: ['storage'] },
    ]);
    store.dialogue = signal<any>(null);
    store.selectedNpcId = signal('');
    store.stock = signal<any[]>([]);
    store.warehouse = signal<any[]>([]);
    store.modal = signal<any>(null);
    store.error = signal<any>(null);
    store.busy = signal(false);
    store.npcLoadSequence = 0;
    store.selectedNpc = computed(() => store.npcs().find((npc: any) => npc.id === store.selectedNpcId()) ?? null);
    return store;
  }

  it('does not automatically select the first NPC after loading the catalogue', async () => {
    const store = makeStore();
    await store.load();
    expect(store.selectedNpcId()).toBe('');
    expect(store.selectedNpc()).toBeNull();
    expect(store.stock()).toEqual([]);
    expect(store.dialogue()).toBeNull();
  });

  it('resets NPC-specific panel state when Town is entered again', () => {
    const store = makeStore();
    store.selectedNpcId.set('william');
    store.stock.set([{ itemId: 'pot_hp_small' }]);
    store.warehouse.set([{ itemId: 'equip_sword_t1' }]);
    store.dialogue.set({ npcId: 'william', npcText: 'stale' });
    store.modal.set({ mode: 'buy', itemId: 'pot_hp_small', quantity: 1, maxQuantity: 1, unitPrice: 10 });
    store.error.set('stale error');

    store.resetForTownEntry();

    expect(store.selectedNpcId()).toBe('');
    expect(store.stock()).toEqual([]);
    expect(store.warehouse()).toEqual([]);
    expect(store.dialogue()).toBeNull();
    expect(store.modal()).toBeNull();
    expect(store.error()).toBeNull();
    expect(store.npcs()).toEqual([], 'do not keep William as a fake fallback after a Town reset');
  });

  it('retries the catalogue for the newly settled Town when a response races with a map change', async () => {
    const store = makeStore();
    let currentCharacter: any = { currentMapId: 'town_a', status: 'town' };
    store.character = { character: () => currentCharacter };
    const requests: Array<(value: any[]) => void> = [];
    store.api.get.and.returnValue({ toPromise: () => new Promise(resolve => requests.push(resolve)) });

    const oldTownLoad = store.load();
    currentCharacter = { currentMapId: 'town_b', status: 'town' };
    requests[0]([{ id: 'stale_vendor', name: 'Stale Vendor', location: 'town', types: ['vendor'] }]);
    await oldTownLoad;
    expect(requests.length).toBe(2, 'the stale response should trigger a load for the current Town');

    const destinationNpc = [{ id: 'storage', name: 'Storage', location: 'town', types: ['storage'] }];
    requests[1](destinationNpc);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.npcs()).toEqual(destinationNpc);
  });

  it('ignores a Town NPC catalogue response from the previous Town after a map change', async () => {
    const store = makeStore();
    let currentCharacter: any = { currentMapId: 'town_a', status: 'town' };
    store.character = { character: () => currentCharacter };
    const requests: Array<(value: any[]) => void> = [];
    store.api.get.and.returnValue({ toPromise: () => new Promise(resolve => requests.push(resolve)) });

    const oldTownLoad = store.load();
    currentCharacter = { currentMapId: 'town_b', status: 'town' };
    store.resetForTownEntry();
    const destinationTownLoad = store.load();

    const destinationNpcs = [{ id: 'destination_vendor', name: 'Destination Vendor', location: 'town', types: ['vendor'] }];
    requests[1](destinationNpcs);
    await destinationTownLoad;
    requests[0]([{ id: 'stale_vendor', name: 'Stale Vendor', location: 'town', types: ['vendor'] }]);
    await oldTownLoad;

    expect(store.npcs()).toEqual(destinationNpcs);
    expect(store.selectedNpcId()).toBe('');
  });

  it('keeps the map-owned NPC list if the live endpoint incorrectly returns an empty array', async () => {
    const store = makeStore();
    store.character = { character: () => ({ currentMapId: 'town_b', status: 'town' }) };
    store.api.get.and.returnValue({ toPromise: () => Promise.resolve([]) });
    await store.load();
    expect(store.npcs()).toEqual([{ id: 'storage', name: 'Storage', location: 'town', types: ['storage'] }]);
    expect(store.error()).toContain('empty list');
  });

  it('keeps the canonical JSON NPC list visible if the live endpoint fails', async () => {
    const store = makeStore();
    store.character = { character: () => ({ currentMapId: 'town_b', status: 'town' }) };
    store.api.get.and.returnValue({ toPromise: () => Promise.reject({ error: { message: 'temporary API error' } }) });
    await store.load();
    expect(store.npcs()).toEqual([{ id: 'storage', name: 'Storage', location: 'town', types: ['storage'] }]);
    expect(store.error()).toBe('temporary API error');
  });

  it('ignores a stock response that arrives after a different NPC was selected', async () => {
    const store = makeStore();
    let resolveStock: (value: any[]) => void = () => {};
    store.api.get.and.returnValue({ toPromise: () => new Promise(resolve => { resolveStock = resolve; }) });
    store.selectedNpcId.set('william');
    const pending = store.loadStock('william');
    store.selectedNpcId.set('cecilia');
    resolveStock([{ itemId: 'pot_hp_small' }]);
    await pending;
    expect(store.stock()).toEqual([]);
  });
});
