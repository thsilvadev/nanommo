import { GambitEditorComponent } from '../gambit/gambit-editor.component';
import { CharacterPageComponent } from './character-page.component';
describe('Character elemental resistance stats',()=>{
  it('shows all six resistances, including vulnerabilities and zeroes, from the server',()=>{
    const component:any=Object.create(CharacterPageComponent.prototype);
    component.character={character:()=>({elementalAffinity:'earth',elementalResistances:{earth:50,water:0,fire:-50,wind:25,holy:0,shadow:0}})};
    component.locale={t:(key:string)=>key};
    expect(component.elementalResistanceRows().map((row:any)=>[row.element,row.value])).toEqual([['water',0],['earth',50],['fire',-50],['wind',25],['holy',0],['shadow',0]]);
  });
  it('defaults all six resistances to zero for a neutral character',()=>{
    const component:any=Object.create(CharacterPageComponent.prototype);component.character={character:()=>({})};component.locale={t:(key:string)=>key};
    expect(component.elementalResistanceRows().map((row:any)=>row.value)).toEqual([0,0,0,0,0,0]);
  });
});

describe('Legacy elemental Gambit editor migration',()=>{
  it('replaces retired element names with the six canonical choices without changing the action',()=>{
    const editor:any=Object.create(GambitEditorComponent.prototype);
    for(const [legacy,element] of [['light','holy'],['ice','water'],['lightning','wind']]){
      const line:any={conditions:[{id:'foe_element_weak',params:{element:legacy}}],action:{id:'attack'}};
      editor.migrateLegacyLine(line);expect(line.conditions[0].params.element).toBe(element);expect(line.action.id).toBe('attack');
    }
  });
});
