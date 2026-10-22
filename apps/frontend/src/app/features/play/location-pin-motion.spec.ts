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
