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

  it('does not add a replacement comparison to equipped-slot tooltips', () => {
    const lines = catalog.itemTooltipLines('body_equipped', { rolledStat: 'evasion', rolledStatValue: 10 }, 'body');
    expect(lines.some((line: any) => line.comparison || line.comparisonHeader)).toBeFalse();
  });
});
