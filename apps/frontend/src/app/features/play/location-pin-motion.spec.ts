import { signal } from '@angular/core';
import { MapBoard } from './components';

describe('MapBoard Traveling location pin', () => {
  const maps = [
    { id: 'west', type: 'grind', coordinates: { x: -1, y: 0 } },
    { id: 'origin', type: 'grind', coordinates: { x: 0, y: 0 } },
    { id: 'east', type: 'grind', coordinates: { x: 1, y: 0 } },
    { id: 'south', type: 'grind', coordinates: { x: 0, y: -1 } },
    { id: 'north', type: 'grind', coordinates: { x: 0, y: 1 } },
    { id: 'turn-north', type: 'grind', coordinates: { x: 1, y: 1 } },
  ];

  function harness(currentMapId: string, routeMapIds: string[], segmentIndex: number, progressPercent: number, arrivalFrom: string | null = null) {
    const board: any = Object.create(MapBoard.prototype);
    board.maps = maps;
    board.character = { character: signal({
      id: 'character-1',
      currentMapId,
      status: 'grinding',
      travelIntent: { kind: 'route', routeMapIds, segmentIndex, segmentProgress: 0 },
    }) };
    board.activityProgress = jasmine.createSpy('activityProgress').and.returnValue(progressPercent);
    board.pinArrivalFromMapId = signal(arrivalFrom);
    return board;
  }

  it('moves east between the exact entry and exit edges using the Traveling gauge progress', () => {
    const route = ['origin', 'east'];
    const start = harness('origin', route, 0, 0).locationPinPosition();
    const middle = harness('origin', route, 0, 50).locationPinPosition();
    const end = harness('origin', route, 0, 100).locationPinPosition();
    expect(start).toEqual({ x: 7 * 153, y: 6 * 153 + 153 / 2 });
    expect(middle).toEqual({ x: 7 * 153 + 153 / 2, y: 6 * 153 + 153 / 2 });
    expect(end).toEqual({ x: 8 * 153, y: 6 * 153 + 153 / 2 });
    const board = harness('origin', route, 0, 50);
    board.locationPinPosition();
    expect(board.activityProgress).toHaveBeenCalled();
  });

  it('moves west, north and south on the corresponding straight cardinal axis', () => {
    const westStart = harness('east', ['east', 'origin'], 0, 0).locationPinPosition();
    const westEnd = harness('east', ['east', 'origin'], 0, 100).locationPinPosition();
    expect(westStart).toEqual({ x: 9 * 153, y: 6 * 153 + 153 / 2 });
    expect(westEnd).toEqual({ x: 8 * 153, y: 6 * 153 + 153 / 2 });

    const northStart = harness('origin', ['origin', 'north'], 0, 0).locationPinPosition();
    const northEnd = harness('origin', ['origin', 'north'], 0, 100).locationPinPosition();
    expect(northStart).toEqual({ x: 7 * 153 + 153 / 2, y: 7 * 153 });
    expect(northEnd).toEqual({ x: 7 * 153 + 153 / 2, y: 6 * 153 });

    const southStart = harness('origin', ['origin', 'south'], 0, 0).locationPinPosition();
    const southEnd = harness('origin', ['origin', 'south'], 0, 100).locationPinPosition();
    expect(southStart).toEqual({ x: 7 * 153 + 153 / 2, y: 6 * 153 });
    expect(southEnd).toEqual({ x: 7 * 153 + 153 / 2, y: 7 * 153 });
  });

  it('uses the incoming edge on intermediate maps and preserves the shared edge across a segment handoff', () => {
    const route = [
      maps.find(map => map.id === 'origin')!,
      maps.find(map => map.id === 'east')!,
      maps.find(map => map.id === 'turn-north')!,
    ];
    const inEast = harness('east', route.map(map => map.id), 1, 0).locationPinPosition();
    expect(inEast).toEqual({ x: 8 * 153, y: 6 * 153 + 153 / 2 });

    const centerEast = harness('east', route.map(map => map.id), 1, 50).locationPinPosition();
    expect(centerEast).toEqual({ x: 8 * 153 + 153 / 2, y: 6 * 153 + 153 / 2 });

    const outEast = harness('east', route.map(map => map.id), 1, 100).locationPinPosition();
    expect(outEast).toEqual({ x: 8 * 153 + 153 / 2, y: 6 * 153 });

    const inNorth = harness('turn-north', route.map(map => map.id), 2, 0, 'east').locationPinPosition();
    expect(inNorth).toEqual(outEast);
  });

  it('keeps destination pin and route after battle/segment updates even when a stale suppression key exists', () => {
    const requestedAt = '2026-10-22T12:00:00.000Z';
    const board: any = Object.create(MapBoard.prototype);
    board.maps = maps;
    board.character = { character: signal({
      id: 'character-1',
      currentMapId: 'east',
      status: 'grinding',
      travelIntent: {
        kind: 'route',
        destinationMapId: 'turn-north',
        requestedAt,
        routeMapIds: ['origin', 'east', 'turn-north'],
        segmentIndex: 1,
        segmentProgress: 0,
        waitingForBattle: false,
      },
      pendingMapTransition: null,
    }) };
    board.destinationMapId = signal('turn-north');
    board.routeOriginMapId = signal('origin');
    board.mapTransitionPending = signal(false);
    board.destinationRequestedAt = requestedAt;
    board.destinationTransitionWasDeferred = true;
    board.transitionOriginMapId = 'origin';
    board.suppressedPendingTransitionKeys = new Set([`turn-north|${requestedAt}`]);
    board.transitionPoll = null;
    board.startTransitionPoll = jasmine.createSpy('startTransitionPoll');
    board.stopTransitionPoll = jasmine.createSpy('stopTransitionPoll');

    board.reconcileDestinationPreview(board.character.character());

    expect(board.destinationMapId()).toBe('turn-north');
    expect(board.routeOriginMapId()).toBe('east');
    expect(board.destinationRoute()).toEqual([
      { x: 8 * 153 + 153 / 2, y: 6 * 153 + 153 / 2 },
      { x: 8 * 153 + 153 / 2, y: 5 * 153 + 153 / 2 },
    ]);
    expect(board.stopTransitionPoll).not.toHaveBeenCalled();
  });

  it('reconstructs a destination/path from the live server route if the local preview was cleared', () => {
    const board: any = Object.create(MapBoard.prototype);
    board.maps = maps;
    board.character = { character: signal({
      id: 'character-1', currentMapId: 'east', status: 'grinding',
      travelIntent: { kind: 'route', destinationMapId: 'turn-north', routeMapIds: ['origin', 'east', 'turn-north'], segmentIndex: 1, segmentProgress: 0 },
      pendingMapTransition: null,
    }) };
    board.destinationMapId = signal(null);
    board.routeOriginMapId = signal(null);
    expect(board.displayDestinationMapId()).toBe('turn-north');
    expect(board.destinationRoute()).toEqual([
      { x: 8 * 153 + 76.5, y: 6 * 153 + 76.5 },
      { x: 8 * 153 + 76.5, y: 5 * 153 + 76.5 },
    ]);
  });

  it('raises the visual marker by 7px only while traversing a route, not when settled', () => {
    const moving = harness('origin', ['origin', 'east'], 0, 25);
    expect(moving.locationPinRenderY()).toBe(moving.locationPinPosition().y - 7);

    const settled: any = Object.create(MapBoard.prototype);
    settled.maps = maps;
    settled.character = { character: signal({ id: 'character-1', currentMapId: 'origin', status: 'grinding', travelIntent: null }) };
    settled.pinArrivalFromMapId = signal(null);
    expect(settled.locationPinRenderY()).toBe(settled.locationPinPosition().y);
  });

  it('keeps the pin at the entry edge after final arrival when there is no active route', () => {
    const board: any = Object.create(MapBoard.prototype);
    board.maps = maps;
    board.character = { character: signal({ id: 'character-1', currentMapId: 'east', status: 'grinding', travelIntent: null }) };
    board.pinArrivalFromMapId = signal('origin');
    expect(board.locationPinPosition()).toEqual({ x: 8 * 153, y: 6 * 153 + 153 / 2 });
  });

  it('falls back to the tile center without a valid route or remembered arrival direction', () => {
    const board = harness('origin', ['origin'], 0, 0);
    expect(board.locationPinPosition()).toEqual({ x: 7 * 153 + 153 / 2, y: 6 * 153 + 153 / 2 });
  });
});
