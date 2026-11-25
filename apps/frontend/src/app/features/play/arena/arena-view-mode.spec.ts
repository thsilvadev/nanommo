import { arenaChoiceAfter, worldViewMode } from './arena-view-mode';

const grind = { inTown: false, mapId: 'map_green_grounds_0', townChoice: null, webgl: true };

describe('worldViewMode', () => {
  it('a grind map shows the map by default', () => {
    expect(worldViewMode({ ...grind, arenaChoice: null })).toBe('map');
  });
  it('a grind map shows the arena when chosen', () => {
    expect(worldViewMode({ ...grind, arenaChoice: 'arena' })).toBe('arena');
  });
  it('without WebGL the arena is never shown', () => {
    expect(worldViewMode({ ...grind, arenaChoice: 'arena', webgl: false })).toBe('map');
  });
  it('towns keep their own map/town rule and never show the arena', () => {
    expect(worldViewMode({ inTown: true, mapId: 'map_town', townChoice: null, arenaChoice: 'arena', webgl: true })).toBe('town');
    expect(worldViewMode({ inTown: true, mapId: 'map_town', townChoice: { mapId: 'map_town', mode: 'map' }, arenaChoice: 'arena', webgl: true })).toBe('map');
  });
});

describe('arenaChoiceAfter', () => {
  const at = (o: Partial<{ inTown: boolean; traveling: boolean; isGrind: boolean }>) => ({ inTown: false, traveling: false, isGrind: true, ...o });
  it('the arena choice persists across hops while traveling', () => {
    expect(arenaChoiceAfter(at({ traveling: true }), at({ traveling: true }), 'arena')).toBe('arena');
  });
  it('a battle on the way never switches the view', () => {
    expect(arenaChoiceAfter(at({ traveling: true }), at({ traveling: true }), null)).toBeNull();
  });
  it('arriving at the travel destination (a grind map) opens the arena', () => {
    expect(arenaChoiceAfter(at({ traveling: true }), at({ traveling: false }), null)).toBe('arena');
    expect(arenaChoiceAfter(at({ traveling: true }), at({ traveling: false }), 'map')).toBe('arena');
  });
  it('entering a town clears the choice', () => {
    expect(arenaChoiceAfter(at({ traveling: true }), at({ inTown: true, isGrind: false }), 'arena')).toBeNull();
  });
  it('login or a teleport onto a grind map opens the map', () => {
    expect(arenaChoiceAfter(null, at({}), null)).toBeNull();
    expect(arenaChoiceAfter(at({ inTown: true, isGrind: false }), at({}), null)).toBeNull();
  });
  it('a choice made while staying on a map sticks', () => {
    expect(arenaChoiceAfter(at({}), at({}), 'arena')).toBe('arena');
    expect(arenaChoiceAfter(at({}), at({}), 'map')).toBe('map');
  });
});
