import { signal } from '@angular/core';
import { CharacterPageComponent } from './character-page.component';

describe('Mastery cumulative XP progress and authoritative refresh', () => {
  it('derives relative XP, Level 7 and available points from each server snapshot', async () => {
    let rows: any[] = [
      { weaponType: 'greatsword', level: 6, xp: 19_999, spentSkillPoints: 6, skillRanks: { heavy_swing: 5 } },
    ];
    const component: any = Object.create(CharacterPageComponent.prototype);
    component.api = { get: () => ({ toPromise: async () => rows }) };
    component.weaponLevels = signal<Record<string, number>>({});
    component.masteryRows = signal<Record<string, any>>({});
    component.selectedWeapon = signal('greatsword');
    await component.loadWeaponLevels();
    expect(component.masteryLevel()).toBe(6);
    expect(component.getXpAtCurrentLevel()).toBe(19_499);
    expect(component.getXpToNextLevel()).toBe(19_500);
    expect(component.availableMasteryPoints()).toBe(0);
    expect(component.masteryRows().greatsword.skillRanks).toEqual({ heavy_swing: 5 });

    // Simulate the authoritative /characters/weapon-proficiency response after
    // battle:resolved awards enough XP to cross the cumulative Level 7 boundary.
    rows = [{ weaponType: 'greatsword', level: 7, xp: 20_120, spentSkillPoints: 6, skillRanks: { heavy_swing: 5 } }];
    await component.loadWeaponLevels();
    expect(component.masteryLevel()).toBe(7);
    expect(component.getXpAtCurrentLevel()).toBe(120);
    expect(component.getXpToNextLevel()).toBe(15_000);
    expect(component.getTotalMasteryXp()).toBe(20_120);
    expect(component.availableMasteryPoints()).toBe(1);
    expect(component.weaponLevels().greatsword).toBe(7);
    expect(component.masteryRows().greatsword.skillRanks).toEqual({ heavy_swing: 5 }, 'server refresh preserves allocated ranks');

    rows = [{ weaponType: 'greatsword', level: 10, xp: 60_000, spentSkillPoints: 11, skillRanks: { heavy_swing: 5 } }];
    await component.loadWeaponLevels();
    expect(component.masteryLevel()).toBe(10);
    expect(component.getXpAtCurrentLevel()).toBe(0);
    expect(component.getXpToNextLevel()).toBe(0);
    expect(component.availableMasteryPoints()).toBe(0);
  });
});
