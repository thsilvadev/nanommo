
import { Injectable, signal } from '@angular/core';
import { GambitCatalog, ItemDefinition, MonsterDefinition, WeaponCurve } from './game.models';
@Injectable({providedIn:'root'})
export class CatalogService {
 readonly items=signal<ItemDefinition[]>([]);readonly monsters=signal<MonsterDefinition[]>([]);readonly maps=signal<any[]>([]);readonly gambits=signal<GambitCatalog>({meta:{},conditions:[],actions:[]});readonly weaponCurve=signal<WeaponCurve[]>([]);readonly skills=signal<any[]>([]);readonly statusEffects=signal<any[]>([]);readonly npcCatalog=signal<any[]>([]);readonly npcVendor=signal<any|null>(null);private loadPromise:Promise<void>|null=null;
 async load():Promise<void>{if(this.loadPromise)return this.loadPromise;const pending=(async()=>{const get=async<T>(p:string)=>fetch('/data/'+p).then(r=>{if(!r.ok)throw new Error('Unable to load catalogue '+p);return r.json() as Promise<T>});const [i,m,mp,g,w,s,se,npcs,vendor]=await Promise.all([get<any>('items.json'),get<any>('monsters.json'),get<any>('maps.json'),get<GambitCatalog>('gambit_catalog.json'),get<WeaponCurve[]>('weapon_xp_curve.json'),get<any>('skill_trees.json'),get<any>('status_effects.json'),get<any>('npc_catalog.json'),get<any>('npc_vendor.json')]);this.items.set([...(i.consumables??[]),...(i.equipment??[]),...(i.monsterParts??[]),...(i.materials??[])]);this.monsters.set(m.monsters??[]);this.maps.set(mp.maps??[]);this.gambits.set(g);this.weaponCurve.set(w);this.skills.set([...Object.values(s.trees??{}).flat(),...(s.monsterSkills??[]).map((skill:any)=>({...skill,category:'monster'}))]);this.statusEffects.set(se.statusEffects??[]);this.npcCatalog.set(npcs.npcs??[]);this.npcVendor.set(vendor??null);})();this.loadPromise=pending.catch(error=>{this.loadPromise=null;throw error});return this.loadPromise;}
 statusEffect(id:string){return this.statusEffects().find(x=>x.id===id);}
 item(id:string){return this.items().find(x=>x.id===id);}
 itemTooltipLines(itemId:string,instanceData?:any,equippedSlot?:string){
  const d:any=this.item(itemId);if(!d)return [];
  if(d.type==='equipment'){
   const lines=this.equipmentStatLines(itemId,instanceData,equippedSlot);
   if(String(d.weaponType??'').toLowerCase()==='bow')lines.push({label:'',value:'Bows reduce precision by a half',warning:true});
   return lines;
  }
  const hidden=d.type==='consumable'?new Set(['vendorSells','stackable','maxStack','sellPriceToVendor']):d.type==='monster_part'||d.type==='material'?new Set(['usableFor','sellPriceToVendor','stackable','maxStack','droppedBy']):new Set<string>();
  const keys=Object.keys(d);const stop=Math.max(0,keys.indexOf('tier'));const visible=stop>0?keys.slice(0,stop):keys;
  return visible.filter(k=>k!=='id'&&k!=='name'&&!hidden.has(k)&&d[k]!==undefined&&d[k]!==null&&d[k]!=='').map(k=>({label:k==='effect'?'Effect':k.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase()),value:k==='effect'?this.formatItemEffect(d[k]):typeof d[k]==='object'?JSON.stringify(d[k]):String(d[k])}));
 }
 formatItemEffect(effect:any){if(!effect)return '';if(effect.status){const status=String(effect.status).replace(/_/g,' ');return `Cures ${status}.`;}if(effect.type==='heal_hp')return `Restores ${Number(effect.amount)||0} HP.`;if(effect.type==='heal_sp')return `Restores ${Number(effect.amount)||0} SP.`;if(effect.type==='food_buff'){
 const lines:string[]=[];
 const hp=Number(effect.hpRegenPerTenTicks??0);const sp=Number(effect.spRegenPerTenTicks??0);
 if(hp)lines.push('HP Regen: +'+hp+' / 10 ticks');
 if(sp)lines.push('SP Regen: +'+sp+' / 10 ticks');
 const duration=Number(effect.durationSeconds)||0;
 if(duration)lines.push('Duration: '+this.formatDuration(duration));
 return lines.join(' · ');
}return String(effect.type??'').replace(/_/g,' ').replace(/^./,x=>x.toUpperCase())+'.';}
 formatDuration(seconds:number){
  const s=Math.max(0,Math.round(seconds));const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);const sec=s%60;
  return h>0?`${h}h ${String(m).padStart(2,'0')}m`:m>0?`${m}m`:`${sec}s`;
 }
 equipmentStatLines(itemId:string,instanceData?:any,equippedSlot?:string){
  const item:any=this.item(itemId);if(item?.type!=='equipment')return [];
  const lines:any[]=[];const fixed=item.fixedStats??{};
  const labels:Record<string,string>={atk:'Attack',matk:'Magic ATK',def:'Defense',mdefPercent:'MDEF',maxHp:'Max HP',maxSp:'Max SP'};
  for(const key of ['atk','matk','def','mdefPercent','maxHp','maxSp']){
   const value=Number(fixed[key]??0);if(!value)continue;
   if(key==='atk'&&equippedSlot==='offHand'&&item.weaponType&&!['shield','rune'].includes(String(item.weaponType))){lines.push({label:labels[key],originalValue:'+'+value,value:'+'+Math.floor(value/2)});}
   else lines.push({label:labels[key],value:'+'+value+(key==='mdefPercent'?'%':'')});
  }
  for(const [key,value] of Object.entries(fixed.statBonus??{})){const n=Number(value);if(n)lines.push({label:key,value:`+${n}`});}
  const rolledAttribute=String(instanceData?.rolledAttribute??'');const rolledValue=Number(instanceData?.rolledValue??0);
  if(rolledAttribute&&rolledValue)lines.push({label:`${rolledAttribute} (rolled)`,value:`+${rolledValue}`});
  return lines;
 }
 townNpcsForMap(mapId:string){
  const map=this.maps().find(row=>row.id===mapId);
  const catalogue=this.npcCatalog();
  const vendor=this.npcVendor();
  const ids:string[]=Array.isArray(map?.npcIds)?map.npcIds:(mapId==='map_town'?[String(vendor?.id??'william'),...catalogue.map(row=>String(row.id))]:[]);
  return ids.map(id=>{
   if(id===vendor?.id)return {id:vendor.id,name:vendor.name,location:vendor.location,types:['vendor'],greeting:vendor.greeting??vendor.vendor?.greeting};
   const npc=catalogue.find(row=>row.id===id&&row.location==='town');
   return npc?{id:npc.id,name:npc.name,location:npc.location,types:Array.isArray(npc.types)?npc.types:[],greeting:npc.greeting??npc.vendor?.greeting,monologue:npc.monologue}:null;
  }).filter((npc):npc is NonNullable<typeof npc>=>npc!==null);
 }
 itemIcon(id:string,framed=false){const item=this.item(id);const folder=item?.type==='equipment'?'equipment':item?.type==='monster_part'?'monster_parts':item?.type==='material'?'materials':'consumables';const variant=framed?'svg':'svg-noframe';return `/assets/ui/items/${variant}/${folder}/${id}.svg`;} mapList(){return this.maps()} monster(id:string){return this.monsters().find(x=>x.id===id);}
}
