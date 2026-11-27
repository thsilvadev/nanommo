import { Subject, of, throwError } from 'rxjs';
import { GmTeleportStore } from './gm-teleport.store';

describe('GM world teleport mode', () => {
  it('uses only server-confirmed state and refreshes both on and off', async () => {
    let reply = { enabled: true };
    const api = { get: jasmine.createSpy('get').and.callFake(() => of(reply)) };
    const store = new GmTeleportStore(api as any);
    expect(store.enabled()).toBeFalse();
    await store.refreshFor('gm');
    expect(api.get).toHaveBeenCalledWith('/maps/gm-teleport-mode');
    expect(store.enabled()).toBeTrue();
    reply = { enabled: false };
    await store.refreshFor('gm');
    expect(store.enabled()).toBeFalse();
  });

  it('drops privileges on character changes and ignores a stale status response', async () => {
    const old = new Subject<any>();
    const api = { get: jasmine.createSpy('get').and.returnValues(old, of({ enabled: false })) };
    const store = new GmTeleportStore(api as any);
    const pending = store.refreshFor('old-gm');
    await store.refreshFor('new-player');
    old.next({ enabled: true });
    old.complete();
    await pending;
    expect(store.enabled()).toBeFalse();
  });

  it('disables the mode when status cannot be verified or the character logs out', async () => {
    const api = { get: jasmine.createSpy('get').and.returnValues(of({ enabled: true }), throwError(() => new Error('offline'))) };
    const store = new GmTeleportStore(api as any);
    await store.refreshFor('gm');
    expect(store.enabled()).toBeTrue();
    await store.refreshFor('gm');
    expect(store.enabled()).toBeFalse();
    await store.refreshFor(undefined);
    expect(store.enabled()).toBeFalse();
    expect(api.get.calls.count()).toBe(2);
  });
});
