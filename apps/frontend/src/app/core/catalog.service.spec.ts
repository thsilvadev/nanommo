import { CatalogService } from './catalog.service';
import { LocaleService } from './locale.service';

describe('CatalogService equipment comparison', () => {
  let catalog: CatalogService;

  beforeEach(() => {
    catalog = new CatalogService(new LocaleService());
    catalog.items.set([
      { id: 'body_equipped', name: 'Equipped Body', type: 'equipment', slot: 'body', fixedStats: { def: 18, statBonus: { STR: 1 } } },
      { id: 'body_candidate', name: 'Candidate Body', type: 'equipment', slot: 'body', fixedStats: { def: 8 } },
    ] as any);
    catalog.setEquippedEquipment([{ slot: 'body', itemId: 'body_equipped', instanceData: { rolledStat: 'evasion', rolledStatValue: 10 } }]);
  });

  it('shows green positive and red negative deltas against the equipped item', () => {
    const lines = catalog.itemTooltipLines('body_candidate', { rolledAttribute: 'AGI', rolledValue: 2 });
    const comparison = lines.filter((line: any) => line.comparison);

    expect(comparison).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ label: 'Defense', value: '-10', comparisonNegative: true }),
      jasmine.objectContaining({ label: 'AGI', value: '+2', comparisonPositive: true }),
      jasmine.objectContaining({ label: 'STR', value: '-1', comparisonNegative: true }),
      jasmine.objectContaining({ label: 'Evasion', value: '-10', comparisonNegative: true }),
    ]));
  });

  it('compares refined bows without inventing MATK, DEF or MDEF on an item that has no such base stats', () => {
    catalog.items.set([
      { id: 'equip_bow_t1', name: 'Worn Bow', type: 'equipment', slot: 'mainHand', weaponType: 'bow', fixedStats: { atk: 21 } },
      { id: 'equip_bow_t2', name: 'Reinforced Bow', type: 'equipment', slot: 'mainHand', weaponType: 'bow', fixedStats: { atk: 45 } },
    ] as any);
    catalog.setEquippedEquipment([{
      slot: 'mainHand',
      itemId: 'equip_bow_t1',
      instanceData: { refinementLevel: 6 },
    }]);

    const lines = catalog.itemTooltipLines('equip_bow_t2', { rolledStat: 'matk', rolledStatValue: 10 });
    const comparison = lines.filter((line: any) => line.comparison);

    expect(comparison).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ label: 'Attack', value: '-6', comparisonNegative: true }),
      jasmine.objectContaining({ label: 'Magic ATK', value: '+10', comparisonPositive: true }),
    ]));
    expect(comparison.some((line: any) => ['Defense', 'MDEF'].includes(line.label))).toBeFalse();
    expect(comparison.length).toBe(2);
  });

  it('keeps refinement on a present DEF stat without inventing absent MDEF', () => {
    catalog.items.set([
      { id: 'body_equipped', name: 'Equipped Body', type: 'equipment', slot: 'body', fixedStats: { def: 18 } },
      { id: 'body_candidate', name: 'Candidate Body', type: 'equipment', slot: 'body', fixedStats: { def: 8 } },
    ] as any);
    catalog.setEquippedEquipment([{ slot: 'body', itemId: 'body_equipped', instanceData: { refinementLevel: 6 } }]);

    const comparison = catalog.itemTooltipLines('body_candidate').filter((line: any) => line.comparison);
    expect(comparison).toEqual([jasmine.objectContaining({ label: 'Defense', value: '-28', comparisonNegative: true })]);
    expect(comparison.some((line: any) => line.label === 'MDEF')).toBeFalse();
  });

  it('does not add a replacement comparison to equipped-slot tooltips', () => {
    const lines = catalog.itemTooltipLines('body_equipped', { rolledStat: 'evasion', rolledStatValue: 10 }, 'body');
    expect(lines.some((line: any) => line.comparison || line.comparisonHeader)).toBeFalse();
  });
});
