import { battleEventText, battleEventTone } from './battle-event-text';

describe('battle movement text', () => {
  const text = (event: any) => battleEventText(event, 'thiagoarcher', 'Bandit', id => id);

  it('names the caster and pushed target for shared Violent Shot events', () => {
    expect(text({ action: 'move', payload: { type: 'move', from: { row: 0, column: 1 }, to: { row: 0, column: 7 }, reason: 'push' } }))
      .toBe('thiagoarcher pushes Bandit for ( 6 ) spaces -->.');
  });

  it('uses the same active wording for solo and historical push events', () => {
    expect(text({ action: 'move', fromPosition: 1, toPosition: 7, spacesMoved: 6, reason: 'violent_shot_push', sourceSkillId: 'violent_shot' }))
      .toBe('thiagoarcher pushes Bandit for ( 6 ) spaces -->.');
  });

  it('uses the actual displacement direction and singular for one space', () => {
    expect(text({ action: 'move', payload: { from: { column: 5 }, to: { column: 4 }, reason: 'push' } }))
      .toBe('thiagoarcher pushes Bandit for ( 1 ) space <--.');
  });

  it('keeps ordinary approach movement as movement rather than a push', () => {
    expect(text({ action: 'move', fromPosition: 1, toPosition: 2, spacesMoved: 1, reason: 'approach_out_of_range_action' }))
      .toBe('thiagoarcher moves ( 1 ) space →.');
  });

  it('a Heavy Swing splash reads as an extra hit of that skill', () => {
    const splash = { action: 'splash', actor: 'character', payload: { type: 'action', skillId: 'heavy_swing', damage: 240, hit: true } };
    expect(battleEventText(splash, 'Hero', 'Slime', (id) => (id === 'heavy_swing' ? 'Heavy Swing' : id))).toBe("Hero's Heavy Swing also hits Slime for 240 damage.");
    expect(battleEventTone(splash)).toBe('outgoing');
  });
});

