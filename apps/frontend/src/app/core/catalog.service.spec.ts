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

  it('hands back the same frozen lines until the item, the gear or the locale changes (no DOM churn in templates)', () => {
    const instance = { rolledAttribute: 'AGI', rolledValue: 2 };
    const first = catalog.itemTooltipLines('body_candidate', instance);
    expect(catalog.itemTooltipLines('body_candidate', { ...instance })).toBe(first);
    expect(Object.isFrozen(first)).toBeTrue();
    expect(catalog.itemTooltipLines('body_candidate', { rolledAttribute: 'AGI', rolledValue: 3 })).not.toBe(first);
    catalog.setEquippedEquipment([]);
    const unequipped = catalog.itemTooltipLines('body_candidate', instance);
    expect(unequipped).not.toBe(first);
    expect(unequipped.some((line: any) => line.comparison)).toBeFalse();
  });

  it('rebuilds tooltip lines in the new language', () => {
    const locale = new LocaleService();
    locale.setLocale('en-US');
    const localized = new CatalogService(locale);
    localized.items.set([{ id: 'herb', name: 'Herb', type: 'material', description: 'A herb.' }] as any);
    const english = localized.itemTooltipLines('herb');
    locale.setLocale('pt-BR');
    const portuguese = localized.itemTooltipLines('herb');
    expect(portuguese).not.toBe(english);
    expect(portuguese[0].label).toBe(locale.t('Type'));
    locale.setLocale('en-US');
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

describe('Elemental affinity tooltips and replacement comparisons',()=>{
  let catalog:CatalogService;
  beforeEach(()=>{
    catalog=new CatalogService({t:(key:string)=>key,localized:(_item:any,_key:string,fallback:any)=>fallback,locale:()=> 'en-US'} as any);
    catalog.items.set([
      {id:'earth_boots',name:'Earth Boots',type:'equipment',slot:'shoes',fixedStats:{elementalAffinity:'earth'}},
      {id:'water_boots',name:'Water Boots',type:'equipment',slot:'shoes',fixedStats:{elementalAffinity:'water'}},
      {id:'plain_boots',name:'Plain Boots',type:'equipment',slot:'shoes',fixedStats:{}},
    ] as any);
    catalog.setEquippedEquipment([{slot:'shoes',itemId:'earth_boots'}]);
  });
  it('shows affinity and signed resistances without treating refinement or old instance immunity as another bonus',()=>{
    const lines=catalog.itemTooltipLines('earth_boots',{refinementLevel:5,elementalImmunity:'water'},'shoes');
    expect(lines).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({label:'Elemental Affinity',value:'Earth'}),
      jasmine.objectContaining({label:'Earth Resistance',value:'+50%'}),
      jasmine.objectContaining({label:'Fire Resistance',value:'-50%'}),
      jasmine.objectContaining({label:'Wind Resistance',value:'+25%'}),
    ]));
  });
  it('compares the entire resistance profile in percentage points when replacing an affinity',()=>{
    const lines=catalog.itemTooltipLines('water_boots').filter((row:any)=>row.comparison);
    expect(lines).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({label:'Earth Resistance',value:'-50 pp',comparisonNegative:true}),
      jasmine.objectContaining({label:'Water Resistance',value:'+50 pp',comparisonPositive:true}),
      jasmine.objectContaining({label:'Fire Resistance',value:'+75 pp',comparisonPositive:true}),
      jasmine.objectContaining({label:'Wind Resistance',value:'-75 pp',comparisonNegative:true}),
    ]));
  });
  it('shows both lost protection and removed vulnerability when replacing elemental boots with neutral boots',()=>{
    const lines=catalog.itemTooltipLines('plain_boots').filter((row:any)=>row.comparison);
    expect(lines).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({label:'Earth Resistance',value:'-50 pp',comparisonNegative:true}),
      jasmine.objectContaining({label:'Fire Resistance',value:'+50 pp',comparisonPositive:true}),
      jasmine.objectContaining({label:'Wind Resistance',value:'-25 pp',comparisonNegative:true}),
    ]));
  });
});
