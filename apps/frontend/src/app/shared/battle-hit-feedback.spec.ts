import { damageFeedbackStyle, isFloatingDamageEvent } from './battle-hit-feedback';

describe('battle hit feedback event classification', () => {
  it('accepts only positive damage addressed to a combatant', () => {
    expect(isFloatingDamageEvent({ target: 'character', damage: 1 })).toBeTrue();
    expect(isFloatingDamageEvent({ target: 'monster', damage: 12 })).toBeTrue();
    expect(isFloatingDamageEvent({ target: 'character', damage: 0 })).toBeFalse();
    expect(isFloatingDamageEvent({ target: 'opponent', damage: 12 })).toBeFalse();
  });
  it('uses red for character damage and white for ordinary monster damage', () => {
    expect(damageFeedbackStyle({ target: 'character', damage: 10, action: 'attack' })).toBe('character-damage');
    expect(damageFeedbackStyle({ target: 'monster', damage: 10, action: 'attack' })).toBe('monster-damage');
  });
  it('emphasizes critical monster damage', () => {
    expect(damageFeedbackStyle({ target: 'monster', damage: 100, action: 'attack', crit: true })).toBe('critical');
    expect(damageFeedbackStyle({ target: 'monster', damage: 10, action: 'attack', crit: false })).toBe('monster-damage');
  });
  it('distinguishes poison, bleed, and other DoT', () => {
    expect(damageFeedbackStyle({ target: 'monster', damage: 5, action: 'status_damage', status: 'poison' })).toBe('poison');
    expect(damageFeedbackStyle({ target: 'monster', damage: 5, action: 'status_damage', status: 'bleed' })).toBe('bleed');
    expect(damageFeedbackStyle({ target: 'character', damage: 5, action: 'status_damage', status: 'burn' })).toBe('dot');
    expect(damageFeedbackStyle({ target: 'character', damage: 5, action: 'status_damage', status: 'generic_dot' })).toBe('dot');
  });
});
