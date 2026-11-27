import { CatalogService } from './catalog.service';

describe('Equipment refinement tooltip breakdown', () => {
  let catalog: CatalogService;
  beforeEach(() => {
    catalog = new CatalogService({ t: (key: string) => key, locale: () => 'en-US', localized: (_: any, _key: string, fallback: any) => fallback } as any);
    catalog.items.set([
      { id: 'body', name: 'Armor', type: 'equipment', tier: 1, slot: 'body', fixedStats: { def: 4, mdefPercent: 2, maxHp: 10 } },
      { id: 'weapon', name: 'Sword', type: 'equipment', tier: 2, slot: 'mainHand', weaponType: 'sword', fixedStats: { atk: 21 } },
      { id: 'food', name: 'Food', type: 'food' },
    ] as any);
  });

  it('separates native values and refinement without refining unrelated or absent stats', () => {
    const lines = catalog.equipmentStatLines('body', { refinementLevel: 10 });
    expect(lines).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ label: 'Defense', value: '+4 (+30)' }),
      jasmine.objectContaining({ label: 'MDEF', value: '+2% (+30%)' }),
      jasmine.objectContaining({ label: 'Max HP', value: '+10' }),
    ]));
    expect(lines.some(line => line.label === 'Attack')).toBeFalse();
    expect(catalog.equipmentStatLines('body')[0].value).toBe('+4');
  });

  it('uses persisted crafted base values and keeps the +7 bonus rule', () => {
    for (const [level, total, expected] of [[6, 3, '+3'], [7, 5, '+3 (+2)'], [10, 11, '+3 (+8)'], [12, 15, '+3 (+12)']] as const) {
      const lines = catalog.equipmentStatLines('body', { refinementLevel: level, rolledAttribute: 'VIT', rolledValue: total, refinementBaseRolledValue: 3, craftedByProfession: 'blacksmithing' });
      expect(lines.find(line => line.label === 'vit')).toEqual(jasmine.objectContaining({ value: expected, rolledAttribute: true }));
      expect(lines.some(line => line.label.includes('(rolled)'))).toBeFalse();
    }
  });

  it('separates dropped rolls already containing refinement and preserves percentage units', () => {
    expect(catalog.equipmentStatLines('body', { refinementLevel: 10, rolledStat: 'evasion', rolledStatValue: 15, refinementBaseRolledStatValue: 3 })).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ label: 'Evasion', value: '+3 (+12)', rolledStat: true }),
    ]));
    expect(catalog.equipmentStatLines('body', { refinementLevel: 10, rolledStat: 'criticalPercent', rolledStatValue: 7, refinementBaseRolledStatValue: 3 })).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ label: 'Critical Chance', value: '+3% (+4%)', rolledStat: true }),
    ]));
  });

  it('does not invent original rolls for legacy items or discard a saved zero base', () => {
    expect(catalog.equipmentStatLines('body', { refinementLevel: 12, rolledAttribute: 'STR', rolledValue: 9 })).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ label: 'str', value: '+9' }),
    ]));
    expect(catalog.equipmentStatLines('body', { refinementLevel: 7, rolledStat: 'defense', rolledStatValue: 4, refinementBaseRolledStatValue: 0 })).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ label: 'Defense', value: '+0 (+4)', rolledStat: true }),
    ]));
  });

  it('preserves off-hand rounding while showing the original and effective native breakdown', () => {
    expect(catalog.equipmentStatLines('weapon', { refinementLevel: 1 }, 'offHand')[0]).toEqual(jasmine.objectContaining({ originalValue: '+21 (+5)', value: '+10 (+3)' }));
  });

  it('applies refinement title stages only to equipment and leaves grid tier classes alone', () => {
    const title = (id: string, level: number) => (catalog as any).itemTitleClass?.(id, { refinementLevel: level });
    expect(title('body', 9)).toBe('equipment-title tier-1');
    expect(title('body', 10)).toBe('equipment-title tier-1 refinement-10');
    expect(title('weapon', 11)).toBe('equipment-title tier-2 refinement-11');
    expect(title('weapon', 12)).toBe('equipment-title tier-2 refinement-12');
    expect(title('weapon', 99)).toBe('equipment-title tier-2 refinement-12');
    expect(title('food', 12)).toBe('');
    expect(title('unknown', 12)).toBe('');
    expect(catalog.itemTierClass('weapon')).toBe('tier-2');
  });
});
