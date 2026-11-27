import { skillRangeLabel } from './skill-range';

describe('skillRangeLabel', () => {
  it('reads the range the way the engine does', () => {
    expect(skillRangeLabel({ target: 'any', ranged: true, maxRange: 8, effect: { type: 'self_heal' } })).toBe('8');
    expect(skillRangeLabel({ target: 'foe', effect: { type: 'physical_damage' } })).toBe('1');
    expect(skillRangeLabel({ target: 'foe', ranged: true })).toBe('7');
    expect(skillRangeLabel({ target: 'self', effect: { type: 'defense_buff' } })).toBe('Self');
    expect(skillRangeLabel({ target: 'foe', ranged: true, maxRange: 8, effect: { type: 'blinkstrike' } })).toBe('Any');
    expect(skillRangeLabel(null)).toBeNull();
  });
});
