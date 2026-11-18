import { SharedBattlePanelComponent } from './shared-battle-panel.component';

describe('shared public target details',()=>{
  it('uses public monster identity and snapshot stats for portrait details',()=>{
    const panel:any=Object.create(SharedBattlePanelComponent.prototype);
    // The deliberately limited public API shape has no private engine definitions.
    panel.party={battle:()=>({snapshot:{actors:[{id:'foe',name:'Treant',kind:'monster',team:'b',definitionId:'mon_flamingtreant',snapshot:{hp:70,sp:12,maxHp:100,maxSp:30,atk:25,matk:9,def:7,mdefPercent:15,accuracy:90,evasion:2,critChance:4}}]}})};
    panel.catalog={monster:()=>({drops:[{itemId:'bark',chance:0.25}]}),itemName:()=> 'Bark'};
    const target=panel.dropTables()[0];
    expect(target.src).toBe('/assets/monsters/mon_flamingtreant.svg');
    expect(target.stats.find((row:any)=>row.label==='ATK').value).toBe('25');
    expect(target.stats.find((row:any)=>row.label==='MDEF').value).toBe('15%');
    expect(target.drops).toEqual([{name:'Bark',percent:25}]);
    expect(panel.eventTone({actorId:'foe',action:'regen',payload:{hpGain:5}})).toBe('foe-regen');
  });
});
