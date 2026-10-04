
import { Injectable, signal } from '@angular/core';
import { GambitCatalog, ItemDefinition, MonsterDefinition, WeaponCurve } from './game.models';
@Injectable({providedIn:'root'})
export class CatalogService {
 readonly items=signal<ItemDefinition[]>([]);readonly monsters=signal<MonsterDefinition[]>([]);readonly gambits=signal<GambitCatalog>({meta:{},conditions:[],actions:[]});readonly weaponCurve=signal<WeaponCurve[]>([]);readonly skills=signal<any[]>([]);private loaded=false;
 async load(){if(this.loaded)return;this.loaded=true;const get=async<T>(p:string)=>fetch('/data/'+p).then(r=>r.json() as Promise<T>);const [i,m,g,w,s]=await Promise.all([get<any>('items.json'),get<any>('monsters.json'),get<GambitCatalog>('gambit_catalog.json'),get<WeaponCurve[]>('weapon_xp_curve.json'),get<any>('skill_trees.json')]);this.items.set([...(i.consumables??[]),...(i.equipment??[]),...(i.monsterParts??[])]);this.monsters.set(m.monsters??[]);this.gambits.set(g);this.weaponCurve.set(w);this.skills.set(Object.values(s.trees??{}).flat());}
 item(id:string){return this.items().find(x=>x.id===id);}
 equipmentStatLines(itemId:string,instanceData?:any){
  const item:any=this.item(itemId);if(item?.type!=='equipment')return [];
  const lines:any[]=[];const fixed=item.fixedStats??{};
  const labels:Record<string,string>={atk:'Attack',matk:'Magic ATK',def:'Defense',mdefPercent:'MDEF',maxHp:'Max HP',maxSp:'Max SP'};
  for(const key of ['atk','matk','def','mdefPercent','maxHp','maxSp']){const value=Number(fixed[key]??0);if(value)lines.push({label:labels[key],value:`+${value}${key==='mdefPercent'?'%':''}`});}
  for(const [key,value] of Object.entries(fixed.statBonus??{})){const n=Number(value);if(n)lines.push({label:key,value:`+${n}`});}
  const rolledAttribute=String(instanceData?.rolledAttribute??'');const rolledValue=Number(instanceData?.rolledValue??0);
  if(rolledAttribute&&rolledValue)lines.push({label:`${rolledAttribute} (rolled)`,value:`+${rolledValue}`});
  return lines;
 }
 itemIcon(id:string,framed=false){const item=this.item(id);const folder=item?.type==='equipment'?'equipment':item?.type==='monster_part'?'monster_parts':'consumables';const variant=framed?'svg':'svg-noframe';return `/assets/ui/items/${variant}/${folder}/${id}.svg`;} monster(id:string){return this.monsters().find(x=>x.id===id);}
}
