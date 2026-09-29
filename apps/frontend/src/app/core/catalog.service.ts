
import { Injectable, signal } from '@angular/core';
import { GambitCatalog, ItemDefinition, MonsterDefinition, WeaponCurve } from './game.models';
@Injectable({providedIn:'root'})
export class CatalogService {
 readonly items=signal<ItemDefinition[]>([]);readonly monsters=signal<MonsterDefinition[]>([]);readonly gambits=signal<GambitCatalog>({meta:{},conditions:[],actions:[]});readonly weaponCurve=signal<WeaponCurve[]>([]);private loaded=false;
 async load(){if(this.loaded)return;this.loaded=true;const get=async<T>(p:string)=>fetch('/data/'+p).then(r=>r.json() as Promise<T>);const [i,m,g,w]=await Promise.all([get<any>('items.json'),get<any>('monsters.json'),get<GambitCatalog>('gambit_catalog.json'),get<WeaponCurve[]>('weapon_xp_curve.json')]);this.items.set([...(i.consumables??[]),...(i.equipment??[]),...(i.monsterParts??[])]);this.monsters.set(m.monsters??[]);this.gambits.set(g);this.weaponCurve.set(w);}
 item(id:string){return this.items().find(x=>x.id===id);}
 itemIcon(id:string,framed=false){const item=this.item(id);const folder=item?.type==='equipment'?'equipment':item?.type==='monster_part'?'monster_parts':'consumables';const variant=framed?'svg':'svg-noframe';return `/assets/ui/items/${variant}/${folder}/${id}.svg`;} monster(id:string){return this.monsters().find(x=>x.id===id);}
}
