import { MapBoard } from '../components';
import { WorldViewState } from './world-view-state.service';

describe('MapBoard arena view', () => {
  function board(webgl = true, state = new WorldViewState()) {
    const b: any = Object.create(MapBoard.prototype);
    b.worldView = state;
    b.webgl = webgl;
    return b;
  }

  it('switching to the arena is instant (no fade)', () => {
    const b = board();
    b.setArenaMode('arena');
    expect(b.worldView.arenaChoice()).toBe('arena');
    b.setArenaMode('map');
    expect(b.worldView.arenaChoice()).toBe('map');
  });

  it('arriving at the destination grind map opens the arena', () => {
    const b = board();
    b.trackArenaPlace({ inTown: false, traveling: true, isGrind: true });
    b.trackArenaPlace({ inTown: false, traveling: true, isGrind: true });
    expect(b.worldView.arenaChoice()).toBeNull();
    b.trackArenaPlace({ inTown: false, traveling: false, isGrind: true });
    expect(b.worldView.arenaChoice()).toBe('arena');
  });

  it('without WebGL arriving never opens the arena', () => {
    const b = board(false);
    b.trackArenaPlace({ inTown: false, traveling: true, isGrind: true });
    b.trackArenaPlace({ inTown: false, traveling: false, isGrind: true });
    expect(b.worldView.arenaChoice()).toBeNull();
  });

  it('entering a town forgets the arena at once', () => {
    const b = board();
    b.worldView.arenaChoice.set('arena');
    b.trackArenaPlace({ inTown: false, traveling: true, isGrind: true });
    b.trackArenaPlace({ inTown: true, traveling: false, isGrind: false });
    expect(b.worldView.arenaChoice()).toBeNull();
  });

  it('coming back from another page (/character) shows the arena again', () => {
    const state = new WorldViewState();
    const first = board(true, state);
    first.trackArenaPlace({ inTown: false, traveling: false, isGrind: true });
    first.setArenaMode('arena');
    // MapBoard is destroyed by the navigation and a new one is created on the way back.
    const second = board(true, state);
    second.trackArenaPlace({ inTown: false, traveling: false, isGrind: true });
    expect(second.worldView.arenaChoice()).toBe('arena');
  });

  it('a trip that ends while on another page still opens the arena on the way back', () => {
    const state = new WorldViewState();
    board(true, state).trackArenaPlace({ inTown: false, traveling: true, isGrind: true });
    const back = board(true, state);
    back.trackArenaPlace({ inTown: false, traveling: false, isGrind: true });
    expect(back.worldView.arenaChoice()).toBe('arena');
  });
});

describe('WorldViewState', () => {
  it('another character starts from the map view', () => {
    const state = new WorldViewState();
    state.forCharacter('a');
    state.arenaChoice.set('arena');
    state.forCharacter('a');
    expect(state.arenaChoice()).toBe('arena');
    state.forCharacter('b');
    expect(state.arenaChoice()).toBeNull();
  });
});
