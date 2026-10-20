import { signal } from '@angular/core';
import { MapBoard } from './components';

describe('world map destination-route reconciliation', () => {
  function harness() {
    const board: any = Object.create(MapBoard.prototype);
    board.destinationMapId = signal<string | null>(null);
    board.routeOriginMapId = signal<string | null>(null);
    board.mapTransitionPending = signal(false);
    board.transitionOriginMapId = null;
    board.transitionPoll = null;
    board.suppressedPendingDestinationMapId = null;
    board.startTransitionPoll = jasmine.createSpy('startTransitionPoll');
    board.reconcileDestinationPreview = (MapBoard.prototype as any).reconcileDestinationPreview.bind(board);
    return board;
  }

  it('does not recreate a destination preview from stale intent after arrival on a Grind map', () => {
    const board = harness();
    const arrivedCharacter = {
      currentMapId: 'map_grind_a',
      status: 'grinding',
      pendingMapTransition: { destinationMapId: 'map_grind_a', reason: 'map_request' },
    };

    // The local preview was already cleared, but a later realtime character snapshot
    // still carries the completed intent.
    board.reconcileDestinationPreview(arrivedCharacter);
    expect(board.destinationMapId()).toBeNull();
    expect(board.routeOriginMapId()).toBeNull();
    expect(board.mapTransitionPending()).toBeFalse();
    expect(board.suppressedPendingDestinationMapId).toBe('map_grind_a');

    board.reconcileDestinationPreview(arrivedCharacter);
    expect(board.destinationMapId()).toBeNull();
    expect(board.routeOriginMapId()).toBeNull();
    expect(board.mapTransitionPending()).toBeFalse();
    expect(board.startTransitionPoll).not.toHaveBeenCalled();
  });

  it('does not resurrect a Grind route after an authoritative fallback to Town', () => {
    const board = harness();
    board.destinationMapId.set('map_grind_b');
    board.routeOriginMapId.set('map_grind_a');
    board.mapTransitionPending.set(true);
    board.transitionOriginMapId = 'map_grind_a';
    const townFallback = {
      currentMapId: 'map_town',
      status: 'town',
      pendingMapTransition: { destinationMapId: 'map_grind_b', reason: 'map_request' },
    };

    board.reconcileDestinationPreview(townFallback);
    expect(board.destinationMapId()).toBeNull();
    expect(board.mapTransitionPending()).toBeFalse();
    expect(board.suppressedPendingDestinationMapId).toBe('map_grind_b');

    board.reconcileDestinationPreview(townFallback);
    expect(board.destinationMapId()).toBeNull();
    expect(board.mapTransitionPending()).toBeFalse();
    expect(board.startTransitionPoll).not.toHaveBeenCalled();
  });

  it('keeps the destination route while a deferred transition is still pending at the origin', () => {
    const board = harness();
    board.routeOriginMapId.set('map_grind_a');
    board.transitionOriginMapId = 'map_grind_a';
    const inTransit = {
      currentMapId: 'map_grind_a',
      status: 'grinding',
      pendingMapTransition: { destinationMapId: 'map_grind_b', reason: 'map_request' },
    };

    board.reconcileDestinationPreview(inTransit);

    expect(board.destinationMapId()).toBe('map_grind_b');
    expect(board.routeOriginMapId()).toBe('map_grind_a');
    expect(board.mapTransitionPending()).toBeTrue();
    expect(board.startTransitionPoll).toHaveBeenCalled();
  });
});
