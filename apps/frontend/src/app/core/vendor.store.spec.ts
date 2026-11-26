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
  // load() now awaits the canonical catalogue before it requests /town/npcs.
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  function makeStore() {
    const store: any = Object.create(VendorStore.prototype);
    store.api = {
      get: jasmine.createSpy('get').and.returnValue({
        toPromise: () => Promise.resolve([
          { id: 'william', name: 'William', location: 'town', types: ['vendor'] },
          { id: 'father_marcelus', name: 'Father Marcelus', location: 'town', types: ['dialogue'] },
          { id: 'blacksmith_loren', name: 'Blacksmith Loren', location: 'town', types: ['vendor'] },
          { id: 'cecilia', name: 'Cecilia', location: 'town', types: [], greeting: 'Fate has brought us together.' },
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
        { id: 'father_marcelus', name: 'Father Marcelus', location: 'town', types: ['dialogue'] },
        { id: 'blacksmith_loren', name: 'Blacksmith Loren', location: 'town', types: ['vendor'] },
        { id: 'cecilia', name: 'Cecilia', location: 'town', types: [], greeting: 'Fate has brought us together.' },
        { id: 'storage', name: 'Storage', location: 'town', types: ['storage'] },
      ] : mapId === 'town_a' ? [{ id: 'town_a_vendor', name: 'Town A Vendor', location: 'town', types: ['vendor'] }] : mapId === 'town_b' ? [{ id: 'storage', name: 'Storage', location: 'town', types: ['storage'] }] : [],
    };
    store.npcs = signal<any[]>([
      { id: 'william', name: 'William', location: 'town', types: ['vendor'] },
      { id: 'father_marcelus', name: 'Father Marcelus', location: 'town', types: ['dialogue'] },
      { id: 'blacksmith_loren', name: 'Blacksmith Loren', location: 'town', types: ['vendor'] },
      { id: 'cecilia', name: 'Cecilia', location: 'town', types: [], greeting: 'Fate has brought us together.' },
      { id: 'storage', name: 'Storage', location: 'town', types: ['storage'] },
    ]);
    store.dialogue = signal<any>(null);
    store.questInteraction = signal<any>(null);
    store.questSpeechOverride = signal<any>(null);
    store.questBusy = signal(false);
    store.questInteractionResolved = signal(false);
    store.questInteractionLoading = signal(false);
    store.questInteractionRequestSequence = 0;
    store.selectedNpcId = signal('');
    store.stock = signal<any[]>([]);
    store.warehouse = signal<any[]>([]);
    store.modal = signal<any>(null);
    store.error = signal<any>(null);
    store.busy = signal(false);
    store.npcLoadSequence = 0;
    // State and collaborators the store gained after these tests were written
    // (Town panel reset, quest discovery acknowledgements, mailbox indicators).
    store.cookingModal = signal(false);
    store.mailboxSendConfirm = signal(false);
    store.respecConfirm = signal(false);
    store.availableQuestNotifications = signal<any[]>([]);
    store.notifications = { acknowledge: jasmine.createSpy('acknowledge').and.returnValue(Promise.resolve()) };
    store.refreshMailboxInbox = jasmine.createSpy('refreshMailboxInbox').and.returnValue(Promise.resolve());
    store.audio = { play: jasmine.createSpy('play') };
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
    store.questInteraction.set({ kind: 'active', npcText: 'stale quest' });
    store.modal.set({ mode: 'buy', itemId: 'pot_hp_small', quantity: 1, maxQuantity: 1, unitPrice: 10 });
    store.error.set('stale error');

    store.resetForTownEntry();

    expect(store.selectedNpcId()).toBe('');
    expect(store.stock()).toEqual([]);
    expect(store.warehouse()).toEqual([]);
    expect(store.dialogue()).toBeNull();
    expect(store.questInteraction()).toBeNull();
    expect(store.modal()).toBeNull();
    expect(store.error()).toBeNull();
    expect(store.npcs()).toEqual([], 'do not keep William as a fake fallback after a Town reset');
  });

  it('hides an active quest action after speaking once, while preserving other NPC actions', async () => {
    const store = makeStore();
    const clickedAction = {
      type: 'active', questId: 'forest_tears', instanceId: 'instance-1',
      interaction: { kind: 'active', questId: 'forest_tears', instanceId: 'instance-1', action: 'close', npcText: { locales: { 'pt-BR': 'Volte com as lágrimas.', 'en-US': 'Come back with the tears.' } } },
    };
    const otherAction = { type: 'offer', questId: 'another_quest', buttonText: 'Another quest' };
    const initial = { kind: 'select', npcId: 'paje_piata', actions: [clickedAction, otherAction] };
    store.questInteraction.set(initial);

    await store.chooseQuestInteraction(clickedAction);

    expect(store.questSpeechOverride()).toBe(clickedAction.interaction);
    expect(store.questInteraction().kind).toBe('select');
    expect(store.questInteraction().actions).toEqual([otherAction]);

    // Returning to this NPC performs a fresh interaction request, restoring the action.
    store.api.get.and.returnValue({ toPromise: () => Promise.resolve(initial) });
    store.selectedNpcId.set('paje_piata');
    store.questSpeechOverride.set(null);
    store.questInteraction.set(null);
    await store.loadQuestActions('paje_piata');
    expect(store.questInteraction().actions).toEqual([clickedAction, otherAction]);
    expect(store.questSpeechOverride()).toBeNull();
  });

  it('keeps Cecilia’s idle greeting hidden until the quest interaction response resolves', async () => {
    const store = makeStore();
    let resolveInteraction: (value: any) => void = () => {};
    store.api.get.and.callFake((path: string) => ({
      toPromise: () => path.includes('/quests/npc/')
        ? new Promise(resolve => { resolveInteraction = resolve; })
        : Promise.resolve(null),
    } as any));
    store.selectedNpcId.set('cecilia');

    const pending = store.loadSelectedNpc();
    expect(store.questInteractionLoading()).toBeTrue();
    expect(store.questInteractionResolved()).toBeFalse();
    expect(store.selectedNpc()?.greeting).toBe('Fate has brought us together.');

    resolveInteraction({ kind: 'active', title: 'A Lucky Ring', npcText: 'Bring the requested items.' });
    await pending;

    expect(store.questInteractionResolved()).toBeTrue();
    expect(store.questInteraction()?.title).toBe('A Lucky Ring');
    expect(store.questInteractionLoading()).toBeFalse();
  });

  it('retries the catalogue for the newly settled Town when a response races with a map change', async () => {
    const store = makeStore();
    let currentCharacter: any = { currentMapId: 'town_a', status: 'town' };
    store.character = { character: () => currentCharacter };
    const requests: Array<(value: any[]) => void> = [];
    store.api.get.and.callFake((path: string) => ({
      toPromise: () => path === '/town/npcs' ? new Promise(resolve => requests.push(resolve)) : Promise.resolve([]),
    }));

    const oldTownLoad = store.load();
    await flush();
    currentCharacter = { currentMapId: 'town_b', status: 'town' };
    requests[0]([{ id: 'stale_vendor', name: 'Stale Vendor', location: 'town', types: ['vendor'] }]);
    await oldTownLoad;
    await flush();
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
    store.api.get.and.callFake((path: string) => ({
      toPromise: () => path === '/town/npcs' ? new Promise(resolve => requests.push(resolve)) : Promise.resolve([]),
    }));

    const oldTownLoad = store.load();
    await flush();
    currentCharacter = { currentMapId: 'town_b', status: 'town' };
    store.resetForTownEntry();
    const destinationTownLoad = store.load();
    await flush();

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

describe('Quest turn-in with a full bag', () => {
  const full = { error: { code: 'QUEST_REWARD_NO_SPACE', message: 'Free up space to receive your reward.' } };
  function makeStore() {
    const store: any = Object.create(VendorStore.prototype);
    store.api = { post: jasmine.createSpy('post').and.returnValue({ toPromise: () => Promise.reject(full) }) };
    store.notices = { error: jasmine.createSpy('error') };
    store.locale = { t: (text: string) => `t(${text})` };
    store.questBusy = signal(false); store.error = signal<string | null>(null); store.notifications = { acknowledge: async () => undefined };
    store.questSpeechOverride = signal(null); store.questInteraction = signal(null);
    return store;
  }
  it('the turn-in button shows the red "free up space" notice (chat and screen)', async () => {
    const store = makeStore();
    await store.turnInQuest('instance-1');
    expect(store.notices.error).toHaveBeenCalledWith('t(QUEST_REWARD_NO_SPACE)');
    expect(store.error()).toBe('t(QUEST_REWARD_NO_SPACE)');
  });
  it('turning in from the NPC dialogue shows it too', async () => {
    const store = makeStore();
    store.questInteraction.set({ kind: 'active', action: 'turn_in', instanceId: 'instance-1' });
    await store.chooseQuestInteraction();
    expect(store.notices.error).toHaveBeenCalledWith('t(QUEST_REWARD_NO_SPACE)');
  });
});
