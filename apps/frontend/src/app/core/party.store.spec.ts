import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { ApiService } from './api.service';
import { GameSocketService } from './game.socket.service';
import { PartyStore, PartyState } from './party.store';

describe('PartyStore authority', () => {
  let api: jasmine.SpyObj<ApiService>;
  let connection: Subject<string>;
  let events: Map<string, Subject<any>>;
  let store: PartyStore;
  const state = (revision: number): PartyState => ({
    party: { id: 'party', kind: 'manual', leaderCharacterId: 'hero', mapId: 'map', revision, members: [] },
    invites: [], actions: [], autoPartyEnabled: false, battle: null,
  });
  beforeEach(() => {
    api = jasmine.createSpyObj('ApiService', ['get', 'post', 'put', 'delete']);
    api.get.and.returnValue(of(state(1)));
    connection = new Subject(); events = new Map();
    TestBed.configureTestingModule({ providers: [
      PartyStore, { provide: ApiService, useValue: api },
      { provide: GameSocketService, useValue: { connect: () => {}, onConnectionState: () => connection,
        on: (event: string) => { const subject = new Subject(); events.set(event, subject); return subject; } } },
    ] });
    store = TestBed.inject(PartyStore);
  });
  afterEach(() => store.stop());
  it('rejects a lower revision party snapshot', () => {
    store.applySnapshot(state(5)); store.applySnapshot(state(2));
    expect(store.party()?.revision).toBe(5);
  });
  it('ignores an in-flight GET after an authoritative socket update', async () => {
    const old = new Subject<PartyState>(); api.get.and.returnValue(old);
    const loading = store.refresh(); store.applySnapshot(state(5));
    old.next(state(2)); old.complete(); await loading;
    expect(store.party()?.revision).toBe(5);
  });
  it('reloads persisted state after reconnection and party notifications', async () => {
    store.start(); await Promise.resolve();
    api.get.calls.reset(); connection.next('connected'); await Promise.resolve();
    expect(api.get).toHaveBeenCalledWith('/party');
    api.get.calls.reset(); events.get('party:actionUpdated')!.next({ revision: 2 }); await Promise.resolve();
    expect(api.get).toHaveBeenCalledWith('/party');
  });
  it('surfaces rejected requests without optimistic membership changes', async () => {
    store.applySnapshot(state(5));
    api.post.and.returnValue(new Subject());
    const response = new Subject(); api.post.and.returnValue(response);
    const inviting = store.invite({ candidateName: 'Traveler' });
    response.error({ error: { message: 'Party is full' } }); await inviting;
    expect(store.error()).toBe('Party is full'); expect(store.party()?.revision).toBe(5);
    expect(store.busy()).toBeFalse();
  });
  it('does not reload the previous session after stopping during a mutation', async () => {
    const response=new Subject(); api.post.and.returnValue(response);
    const inviting=store.invite({candidateName:'Traveler'}); store.stop();
    response.next({});response.complete();await inviting;
    expect(store.party()).toBeNull();expect(store.busy()).toBeFalse();
    expect(api.get).not.toHaveBeenCalled();
  });
});
