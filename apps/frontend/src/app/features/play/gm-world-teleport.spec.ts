import { signal } from '@angular/core';
import { NEVER } from 'rxjs';
import { MapBoard } from './components';

describe('GM world map teleport clicks', () => {
  function board(enabled: boolean) {
    const b: any = Object.create(MapBoard.prototype);
    b.gmTeleport = { enabled: signal(enabled) };
    b.party = { party: () => ({ kind: 'manual', leaderCharacterId: 'other' }), teleport: jasmine.createSpy('partyTeleport') };
    b.maps = [{ id: 'far', type: 'grind', coordinates: { x: 6, y: 5 } }];
    b.character = { character: () => ({ id: 'gm', currentMapId: 'origin', savedTownMapId: 'far' }) };
    b.selected = signal(null);
    b.isRevealed = () => false;
    b.error = signal(null);
    b.mapTransitionPending = signal(false);
    b.routeOriginMapId = signal(null);
    b.destinationMapId = signal(null);
    b.mapRequestSequence = 0;
    b.lastRequestedAt = 0;
    b.api = { post: jasmine.createSpy('post').and.returnValue(NEVER) };
    return b;
  }

  it('lets an enabled GM click an undiscovered destination even as a party follower', () => {
    const b = board(true);
    b.onTileClick(new MouseEvent('click'), b.maps[0]);
    expect(b.selected()).toBe('far');
    expect(b.api.post).toHaveBeenCalledWith('/maps/far/gm-teleport', jasmine.any(Object));
    expect(b.party.teleport).not.toHaveBeenCalled();
  });

  it('keeps ordinary discovery and party travel restrictions when the cheat is off', () => {
    const b = board(false);
    b.onTileClick(new MouseEvent('click'), b.maps[0]);
    expect(b.selected()).toBeNull();
    expect(b.api.post).not.toHaveBeenCalled();
    b.isRevealed = () => true;
    b.enter('far');
    expect(b.api.post).not.toHaveBeenCalled();
  });

  it('uses the ordinary travel endpoint for a revealed destination when the cheat is off', () => {
    const b = board(false);
    b.party.party = () => null;
    b.isRevealed = () => true;
    b.onTileClick(new MouseEvent('click'), b.maps[0]);
    expect(b.api.post).toHaveBeenCalledWith('/maps/far/enter', jasmine.any(Object));
  });
});
