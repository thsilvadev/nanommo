import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { MapBoard } from './components';

describe('world map destination-route reconciliation', () => {
  function harness() {
    const board: any = Object.create(MapBoard.prototype);
    board.destinationMapId = signal<string | null>(null);
    board.routeOriginMapId = signal<string | null>(null);
    board.mapTransitionPending = signal(false);
    board.transitionOriginMapId = null;
    board.transitionPoll = null;
    board.transitionPollBusy = false;
    board.destinationRequestedAt = null;
    board.destinationTransitionWasDeferred = false;
    board.suppressedPendingTransitionKeys = new Set<string>();
    board.startTransitionPoll = jasmine.createSpy('startTransitionPoll');
    board.stopTransitionPoll = jasmine.createSpy('stopTransitionPoll');
    board.reconcileDestinationPreview = (MapBoard.prototype as any).reconcileDestinationPreview.bind(board);
    return board;
  }

  it('clears a Town-to-Town preview as soon as currentMapId reaches the destination', () => {
    const board = harness();
    board.destinationMapId.set('town_b');
    board.routeOriginMapId.set('town_a');
    board.destinationRequestedAt = '2026-10-19T20:00:00.000Z';

    board.reconcileDestinationPreview({
      currentMapId: 'town_b',
      status: 'town',
      pendingMapTransition: null,
    });

    expect(board.destinationMapId()).toBeNull();
    expect(board.routeOriginMapId()).toBeNull();
    expect(board.mapTransitionPending()).toBeFalse();
    expect(board.stopTransitionPoll).toHaveBeenCalled();
  });

  it('does not recreate a Grind route from the same stale pending intent after arrival', () => {
    const board = harness();
    board.destinationMapId.set('map_grind_a');
    board.routeOriginMapId.set('map_grind_b');
    board.destinationRequestedAt = '2026-10-19T20:00:00.000Z';
    const arrivedCharacter = {
      currentMapId: 'map_grind_a',
      status: 'grinding',
      pendingMapTransition: {
        destinationMapId: 'map_grind_a',
        reason: 'map_request',
        requestedAt: '2026-10-19T20:00:00.000Z',
      },
    };

    board.reconcileDestinationPreview(arrivedCharacter);
    expect(board.destinationMapId()).toBeNull();
    expect(board.routeOriginMapId()).toBeNull();
    expect(board.mapTransitionPending()).toBeFalse();

    board.reconcileDestinationPreview(arrivedCharacter);
    expect(board.destinationMapId()).toBeNull();
    expect(board.routeOriginMapId()).toBeNull();
    expect(board.mapTransitionPending()).toBeFalse();
    expect(board.startTransitionPoll).not.toHaveBeenCalled();
  });

  it('clears a completed redirect/fallback without assuming the destination is Town', () => {
    const board = harness();
    board.destinationMapId.set('map_grind_b');
    board.routeOriginMapId.set('map_grind_a');
    board.destinationRequestedAt = '2026-10-19T20:00:00.000Z';

    // An example future location type: the visual transition contract depends on map
    // identity, not Town/Grind status labels.
    board.reconcileDestinationPreview({
      currentMapId: 'sanctuary_1',
      status: 'sanctuary',
      pendingMapTransition: null,
    });

    expect(board.destinationMapId()).toBeNull();
    expect(board.routeOriginMapId()).toBeNull();
    expect(board.mapTransitionPending()).toBeFalse();
  });

  it('keeps the preview while the server confirms a deferred transition at the origin', () => {
    const board = harness();
    board.destinationMapId.set('map_grind_b');
    board.routeOriginMapId.set('map_grind_a');
    board.destinationRequestedAt = '2026-10-19T20:00:00.000Z';
    const inTransit = {
      currentMapId: 'map_grind_a',
      status: 'grinding',
      pendingMapTransition: {
        destinationMapId: 'map_grind_b',
        reason: 'map_request',
        requestedAt: '2026-10-19T20:00:00.000Z',
      },
    };

    board.reconcileDestinationPreview(inTransit);

    expect(board.destinationMapId()).toBe('map_grind_b');
    expect(board.routeOriginMapId()).toBe('map_grind_a');
    expect(board.mapTransitionPending()).toBeTrue();
    expect(board.startTransitionPoll).toHaveBeenCalled();
  });

  it('does not re-enable the pin or waiting state when a deferred response arrives after a newer arrival snapshot', () => {
    const board = harness();
    board.destinationMapId.set('town_b');
    board.routeOriginMapId.set('grind_a');
    board.destinationRequestedAt = '2026-10-19T20:00:00.000Z';
    board.destinationTransitionWasDeferred = true;

    // Race: a newer Character snapshot reports arrival even though this HTTP response
    // still says deferred and carries the old pending intent.
    board.reconcileDestinationPreview({
      currentMapId: 'town_b',
      status: 'town',
      pendingMapTransition: {
        destinationMapId: 'town_b',
        reason: 'map_request',
        requestedAt: '2026-10-19T20:00:00.000Z',
      },
    });

    expect(board.destinationMapId()).toBeNull();
    expect(board.mapTransitionPending()).toBeFalse();
    expect(board.destinationTransitionWasDeferred).toBeFalse();
    expect(board.stopTransitionPoll).toHaveBeenCalled();
  });

  it('adopts a newer pending destination but ignores an older pending snapshot', () => {
    const newerBoard = harness();
    newerBoard.destinationMapId.set('town_b');
    newerBoard.routeOriginMapId.set('town_a');
    newerBoard.destinationRequestedAt = '2026-10-19T20:00:00.000Z';
    newerBoard.reconcileDestinationPreview({
      currentMapId: 'town_a',
      status: 'town',
      pendingMapTransition: {
        destinationMapId: 'sanctuary_1',
        reason: 'map_request',
        requestedAt: '2026-10-19T20:00:01.000Z',
      },
    });
    expect(newerBoard.destinationMapId()).toBe('sanctuary_1');
    expect(newerBoard.routeOriginMapId()).toBe('town_a');

    const olderBoard = harness();
    olderBoard.destinationMapId.set('town_c');
    olderBoard.routeOriginMapId.set('town_a');
    olderBoard.destinationRequestedAt = '2026-10-19T20:00:01.000Z';
    olderBoard.reconcileDestinationPreview({
      currentMapId: 'town_a',
      status: 'town',
      pendingMapTransition: {
        destinationMapId: 'town_b',
        reason: 'map_request',
        requestedAt: '2026-10-19T20:00:00.000Z',
      },
    });
    expect(olderBoard.destinationMapId()).toBe('town_c');
    expect(olderBoard.routeOriginMapId()).toBe('town_a');
  });

  it('recognizes a deferred HTTP response that is older than an already-arrived Character state', () => {
    const board = harness();
    const requestedAt = '2026-10-19T20:00:00.000Z';
    const freshness = (MapBoard.prototype as any).mapIntentResponseFreshness.call(
      board,
      { currentMapId: 'town_b', status: 'town', pendingMapTransition: null },
      'grind_a',
      { currentMapId: 'grind_a', pendingMapTransition: { destinationMapId: 'town_b', requestedAt } },
      requestedAt,
      'town_b',
    );

    expect(freshness.newerRealtimeIntent).toBeFalse();
    expect(freshness.responseBehindLocation).toBeTrue();
  });

  it('recognizes a newer map intent received in realtime while an older request is in flight', () => {
    const board = harness();
    const freshness = (MapBoard.prototype as any).mapIntentResponseFreshness.call(
      board,
      {
        currentMapId: 'town_a',
        pendingMapTransition: {
          destinationMapId: 'sanctuary_1',
          requestedAt: '2026-10-19T20:00:02.000Z',
        },
      },
      'town_a',
      { currentMapId: 'town_a', pendingMapTransition: { destinationMapId: 'town_b', requestedAt: '2026-10-19T20:00:01.000Z' } },
      '2026-10-19T20:00:01.000Z',
      'town_b',
    );

    expect(freshness.newerRealtimeIntent).toBeTrue();
    expect(freshness.responseBehindLocation).toBeFalse();
  });

  const moveScenarios = [
    { origin: 'grind_a', originType: 'grind', originStatus: 'grinding', destination: 'town_b', destinationType: 'town', destinationStatus: 'town' },
    { origin: 'town_a', originType: 'town', originStatus: 'town', destination: 'grind_b', destinationType: 'grind', destinationStatus: 'grinding' },
    { origin: 'grind_a', originType: 'grind', originStatus: 'grinding', destination: 'grind_b', destinationType: 'grind', destinationStatus: 'grinding' },
    { origin: 'town_a', originType: 'town', originStatus: 'town', destination: 'town_b', destinationType: 'town', destinationStatus: 'town' },
  ];

  for (const scenario of moveScenarios) {
    it(`does not roll back ${scenario.originType} -> ${scenario.destinationType} when a deferred HTTP response arrives after arrival`, async () => {
      const board = harness();
      const response = new Subject<any>();
      let currentCharacter: any = {
        currentMapId: scenario.origin,
        status: scenario.originStatus,
        pendingMapTransition: null,
      };
      const applyPatch = jasmine.createSpy('applyPatch');
      board.character = {
        character: () => currentCharacter,
        applyPatch,
        load: jasmine.createSpy('load').and.resolveTo(undefined),
      };
      board.api = { post: jasmine.createSpy('post').and.returnValue(response) };
      board.battle = { load: jasmine.createSpy('load').and.resolveTo(undefined), beginGrindSession: jasmine.createSpy('beginGrindSession') };
      board.socket = { emit: jasmine.createSpy('emit').and.resolveTo(undefined) };
      board.maps = [
        { id: scenario.origin, type: scenario.originType, coordinates: { x: 0, y: 0 } },
        { id: scenario.destination, type: scenario.destinationType, coordinates: { x: 1, y: 0 } },
      ];
      board.error = signal<string | null>(null);
      board.mapRequestSequence = 0;
      board.latestMapRequestSequence = 0;
      board.lastRequestedAt = 0;
      board.rebuildDiscovery = jasmine.createSpy('rebuildDiscovery');
      board.centerOnCurrentMap = jasmine.createSpy('centerOnCurrentMap');

      (MapBoard.prototype as any).requestMapTransition.call(board, scenario.destination);

      // The actual transition commits before the older HTTP response says "deferred at origin".
      currentCharacter = {
        currentMapId: scenario.destination,
        status: scenario.destinationStatus,
        pendingMapTransition: null,
      };
      response.next({
        deferred: true,
        destinationMapId: scenario.destination,
        character: {
          currentMapId: scenario.origin,
          status: scenario.originStatus,
          pendingMapTransition: {
            destinationMapId: scenario.destination,
            reason: scenario.destinationType === 'town' ? 'town_request' : 'map_request',
            requestedAt: '2026-10-19T20:00:00.000Z',
          },
        },
      });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(applyPatch).not.toHaveBeenCalled();
      expect(currentCharacter.currentMapId).toBe(scenario.destination);
      expect(board.destinationMapId()).toBeNull();
      expect(board.routeOriginMapId()).toBeNull();
      expect(board.mapTransitionPending()).toBeFalse();
    });
  }
});
