
import { Injectable, signal } from '@angular/core';
import { GambitCatalog, ItemDefinition, MonsterDefinition, WeaponCurve } from './game.models';
import { LocaleService } from './locale.service';
@Injectable({providedIn:'root'})
export class CatalogService {
 constructor(private readonly locale: LocaleService){}
 readonly items=signal<ItemDefinition[]>([]);readonly equippedEquipment=signal<any[]>([]);readonly monsters=signal<MonsterDefinition[]>([]);readonly maps=signal<any[]>([]);readonly gambits=signal<GambitCatalog>({meta:{},conditions:[],actions:[]});readonly weaponCurve=signal<WeaponCurve[]>([]);readonly skills=signal<any[]>([]);readonly statusEffects=signal<any[]>([]);readonly npcCatalog=signal<any[]>([]);readonly npcVendor=signal<any|null>(null);private loadPromise:Promise<void>|null=null;
 async load():Promise<void>{if(this.loadPromise)return this.loadPromise;const pending=(async()=>{const get=async<T>(p:string)=>fetch('/data/'+p).then(r=>{if(!r.ok)throw new Error('Unable to load catalogue '+p);return r.json() as Promise<T>});const [i,m,mp,g,w,s,se,npcs,vendor]=await Promise.all([get<any>('items.json'),get<any>('monsters.json'),get<any>('maps.json'),get<GambitCatalog>('gambit_catalog.json'),get<WeaponCurve[]>('weapon_xp_curve.json'),get<any>('skill_trees.json'),get<any>('status_effects.json'),get<any>('npc_catalog.json'),get<any>('npc_vendor.json')]);this.items.set([...(i.consumables??[]),...(i.equipment??[]),...(i.monsterParts??[]),...(i.materials??[])]);this.monsters.set(m.monsters??[]);this.maps.set(mp.maps??[]);this.gambits.set(g);this.weaponCurve.set(w);this.skills.set([...Object.values(s.trees??{}).flat(),...(s.monsterSkills??[]).map((skill:any)=>({...skill,category:'monster'}))]);this.statusEffects.set(se.statusEffects??[]);this.npcCatalog.set(npcs.npcs??[]);this.npcVendor.set(vendor??null);})();this.loadPromise=pending.catch(error=>{this.loadPromise=null;throw error});return this.loadPromise;}
 setEquippedEquipment(rows:any[]){this.equippedEquipment.set(rows??[]);}
 statusEffect(id:string){return this.statusEffects().find(x=>x.id===id);}
 item(id:string){return this.items().find(x=>x.id===id);}
 itemName(id:string,instanceData?:any){const item:any=this.item(id);if(!item)return id;const name=this.locale.localized(item,'name',item.name)||id;const level=Math.max(0,Math.min(12,Math.floor(Number(instanceData?.refinementLevel??0))));return level?name+' +'+level:name;}
 itemTypeLabel(idOrType:string){
  const item:any=this.item(idOrType);const type=String(item?.type??idOrType??'');
  const labels:Record<string,string>={equipment:'Equipment',monster_part:'Monster Part',material:'Material',consumable:'Consumable',food:'Consumable'};
  return this.locale.t(labels[type]??'Item');
 }
 itemTooltipLines(itemId:string,instanceData?:any,equippedSlot?:string){
  const d:any=this.item(itemId);if(!d)return [];
  const category={label:this.locale.t('Type'),value:this.itemTypeLabel(d.type)};
  const description=this.locale.localized(d,'description',d.description);
  const descriptionLine=description?{label:'',value:description}:null;
  if(d.type==='equipment'){
   const lines=this.equipmentStatLines(itemId,instanceData,equippedSlot);
   if(String(d.weaponType??'').toLowerCase()==='bow')lines.push({label:'',value:'Bows reduce precision by a half',warning:true});
   if(!equippedSlot)lines.push(...this.equipmentComparisonLines(itemId,instanceData));
   return [category,...(descriptionLine?[descriptionLine]:[]),...lines];
  }
  const hidden=d.type==='consumable'||d.type==='food'?new Set(['vendorSells','stackable','maxStack','sellPriceToVendor','alchemyCategory']):d.type==='monster_part'||d.type==='material'?new Set(['usableFor','sellPriceToVendor','stackable','maxStack','droppedBy']):new Set<string>();
  const keys=Object.keys(d);const stop=Math.max(0,keys.indexOf('tier'));const visible=stop>0?keys.slice(0,stop):keys;
  const details=visible.filter(k=>!['id','name','type','description','locales'].includes(k)&&!hidden.has(k)&&d[k]!==undefined&&d[k]!==null&&d[k]!=='').map(k=>({label:k==='effect'?this.locale.t('Effect'):k.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase()),value:k==='effect'?this.formatItemEffect(d[k]):typeof d[k]==='object'?JSON.stringify(d[k]):String(d[k])}));
  return [category,...(descriptionLine?[descriptionLine]:[]),...details];
 }
 formatItemEffect(effect:any){if(!effect)return '';if(effect.type==='apply_status'&&effect.status){const status=String(effect.status).replace(/_/g,' ');return `Applies ${status} for ${Number(effect.durationSeconds??0)} seconds.`;}if(effect.type==='revive_full_cleanse')return 'Revives you upon death with full HP/SP and removes all active status effects.';if(effect.type==='cure_status'&&effect.status){const status=String(effect.status).replace(/_/g,' ');return `Cures ${status}.`;}if(effect.type==='heal_hp')return `Restores ${Number(effect.amount)||0} HP.`;if(effect.type==='heal_sp')return `Restores ${Number(effect.amount)||0} SP.`;if(effect.type==='heal_hp_sp')return `Restores ${Number(effect.hpAmount)||0} HP and ${Number(effect.spAmount)||0} SP.`;if(effect.type==='food_buff'){
 const lines:string[]=[];
 const hp=Number(effect.hpRegenPerTenTicks??0);const sp=Number(effect.spRegenPerTenTicks??0);
 if(hp)lines.push('HP Regen: +'+hp+' / 10 seconds');
 if(sp)lines.push('SP Regen: +'+sp+' / 10 ticks');
 const duration=Number(effect.durationSeconds)||0;
 if(duration)lines.push('Duration: '+this.formatDuration(duration));
 return lines.join(' · ');
}return String(effect.type??'').replace(/_/g,' ').replace(/^./,x=>x.toUpperCase())+'.';}
 formatDuration(seconds:number){
  const s=Math.max(0,Math.round(seconds));const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);const sec=s%60;
  return h>0?`${h}h ${String(m).padStart(2,'0')}m`:m>0?`${m}m`:`${sec}s`;
 }
 private equipmentComparisonLines(itemId:string,instanceData?:any){
  const item:any=this.item(itemId);if(item?.type!=='equipment')return [];
  const rows=this.equippedEquipment();
  const candidateSlot=String(item.slot??'');
  const comparisonSlot=candidateSlot==='accessory'
    ? (rows.some(row=>row.slot==='accessoryLeft')?'accessoryLeft':rows.some(row=>row.slot==='accessoryRight')?'accessoryRight':'')
    : candidateSlot;
  if(!comparisonSlot)return [];
  const equipped=rows.find(row=>row.slot===comparisonSlot);
  if(!equipped)return [];
  const current:any=this.item(equipped.itemId);if(current?.type!=='equipment')return [];
  const values=(definition:any,data:any,slot:string)=>{
   const result:Record<string,number>={};
   const fixed=definition.fixedStats??{};
   const refine=Math.max(0,Math.min(12,Math.floor(Number(data?.refinementLevel??0))));
   const add=(key:string,value:number)=>{if(Number.isFinite(value)&&value!==0)result[key]=(result[key]??0)+value;};
   const refinedFixed:Record<string,number>={};
   for(const key of ['atk','matk','def','mdefPercent']){
    const base=fixed[key];
    // Match effectiveItemDefinition(): a refinement bonus exists only when the
    // catalogue item actually owns a non-zero base value for that direct stat.
    if(base===undefined||base===null||!Number.isFinite(Number(base))||Number(base)===0)continue;
    const refinementGain=definition.slot==='mainHand'&&!!definition.weaponType&&(key==='atk'||key==='matk')?5:3;
    refinedFixed[key]=Number(base)+refinementGain*refine;
   }
   for(const key of ['def','mdefPercent','maxHp','maxSp','moveSpeed'])add(key,Number(refinedFixed[key]??fixed[key]??0));
   if(slot==='mainHand'||slot==='offHand'){
    let attack=Number(refinedFixed['atk']??0);
    if(slot==='offHand')attack=Math.floor(attack/2);
    add('atk',attack);
   }
   if(slot==='mainHand')add('matk',Number(refinedFixed['matk']??0));
   for(const [key,value] of Object.entries(fixed.statBonus??{})){
    const normalized=String(key).toUpperCase()==='SOR'?'LUK':String(key).toUpperCase();
    add(normalized,Number(value));
   }
   const attr=String(data?.rolledAttribute??'').toUpperCase();
   const attrKey=attr==='SOR'?'LUK':attr;
   add(attrKey,Number(data?.rolledValue??0));
   const stat=String(data?.rolledStat??'');
   const statValue=Number(data?.rolledStatValue??0);
   const statKey:Record<string,string>={hp:'maxHp',sp:'maxSp',defense:'def',criticalPercent:'criticalChance',atkSpeed:'attackSpeed',castTimeReduction:'castTimeReduction',accuracy:'accuracy',evasion:'evasion',atk:'atk',matk:'matk'};
   if(stat&&statValue){
    const key=statKey[stat]??stat;
    let value=statValue;
    if(key==='atk'&&slot==='offHand'&&definition.weaponType&&!['shield','rune'].includes(String(definition.weaponType)))value=Math.floor(value/2);
    if(key!=='matk'||slot==='mainHand')add(key,value);
   }
   return result;
  };
  const candidate=values(item,instanceData,comparisonSlot);const previous=values(current,equipped.instanceData,comparisonSlot);
  const labels:Record<string,string>={atk:'Attack',matk:'Magic ATK',def:'Defense',mdefPercent:'MDEF',maxHp:'Max HP',maxSp:'Max SP',moveSpeed:'Move Speed',STR:'STR',AGI:'AGI',DEX:'DEX',VIT:'VIT',INT:'INT',LUK:'LUK',accuracy:'Accuracy',evasion:'Evasion',criticalChance:'Critical Chance',attackSpeed:'Attack Speed',castTimeReduction:'Cast Time Reduction'};
  const keys=[...new Set([...Object.keys(candidate),...Object.keys(previous)])];
  const changes=keys.map(key=>({key,delta:(candidate[key]??0)-(previous[key]??0)})).filter(row=>row.delta!==0);
  if(!changes.length)return [];
  return [{label:'',value:'Compared with equipped '+(comparisonSlot==='accessoryLeft'||comparisonSlot==='accessoryRight'?'Accessory':comparisonSlot),comparisonHeader:true},...changes.map(({key,delta})=>({label:labels[key]??key,value:`${delta>0?'+':''}${delta}${key==='mdefPercent'||key==='criticalChance'?'%':''}`,comparison:true,comparisonPositive:delta>0,comparisonNegative:delta<0}))];
 }

 equipmentStatLines(itemId:string,instanceData?:any,equippedSlot?:string){
  const item:any=this.item(itemId);if(item?.type!=='equipment')return [];
  const lines:any[]=[];const fixed=item.fixedStats??{};const refine=Math.max(0,Math.min(12,Math.floor(Number(instanceData?.refinementLevel??0))));
  const labels:Record<string,string>={atk:'Attack',matk:'Magic ATK',def:'Defense',mdefPercent:'MDEF',maxHp:'Max HP',maxSp:'Max SP',moveSpeed:'Move Speed'};
  for(const key of ['atk','matk','def','mdefPercent','maxHp','maxSp','moveSpeed']){
   const base=fixed[key];if(base===undefined||base===null||!Number(base))continue;
   const refinementGain=item?.slot==='mainHand'&&!!item?.weaponType&&(key==='atk'||key==='matk')?5:3;const value=Number(base)+(['atk','matk','def','mdefPercent'].includes(key)&&refine?refinementGain*refine:0);
   if(key==='atk'&&equippedSlot==='offHand'&&item.weaponType&&!['shield','rune'].includes(String(item.weaponType))){lines.push({label:this.locale.t(labels[key]),originalValue:'+'+value,value:'+'+Math.floor(value/2)});}
   else lines.push({label:this.locale.t(labels[key]),value:'+'+value+(key==='mdefPercent'?'%':'' )});
  }
  for(const [key,value] of Object.entries(fixed.statBonus??{})){const n=Number(value);if(n)lines.push({label:this.locale.t(key.toLowerCase()),value:`+${n}`});}
  const rolledAttribute=String(instanceData?.rolledAttribute??'');const rolledValue=Number(instanceData?.rolledValue??0);
  if(rolledAttribute&&rolledValue)lines.push({label:`${this.locale.t(rolledAttribute.toLowerCase())} (rolled)`,value:`+${rolledValue}`});
  const rolledStat=String(instanceData?.rolledStat??'');const rolledStatValue=Number(instanceData?.rolledStatValue??0);
  const statLabels:Record<string,string>={atk:'Attack',matk:'Magic ATK',castTimeReduction:'Cast Time Reduction',accuracy:'Accuracy',criticalPercent:'Critical Chance',atkSpeed:'Attack Speed',hp:'Max HP',sp:'Max SP',evasion:'Evasion',defense:'Defense'};
  if(rolledStat&&rolledStatValue)lines.push({label:`${this.locale.t(statLabels[rolledStat]??rolledStat)} (rolled)`,value:`+${rolledStatValue}`});
  if(refine)lines.push({label:this.locale.t('Refinement'),value:'+'+refine});
  return lines;
 }
 townNpcsForMap(mapId:string){
  const map=this.maps().find(row=>row.id===mapId);
  const catalogue=this.npcCatalog();
  const vendor=this.npcVendor();
  const ids:string[]=Array.isArray(map?.npcIds)?map.npcIds:(mapId==='map_town'?[String(vendor?.id??'william'),...catalogue.map(row=>String(row.id))]:[]);
  return ids.map(id=>{
   if(id===vendor?.id)return {id:vendor.id,name:this.locale.localized(vendor,'name',vendor.name),location:vendor.location,types:['vendor'],greeting:this.locale.localized(vendor,'greeting',vendor.greeting??vendor.vendor?.greeting)};
   const npc=catalogue.find(row=>row.id===id&&row.location==='town');
   return npc?{...npc,id:npc.id,name:this.locale.localized(npc,'name',npc.name),location:npc.location,types:Array.isArray(npc.types)?npc.types:[],greeting:this.locale.localized(npc,'greeting',npc.greeting??npc.vendor?.greeting),monologue:this.locale.localized(npc,'monologue',npc.monologue)}:null;
  }).filter((npc):npc is NonNullable<typeof npc>=>npc!==null);
 }
 itemIcon(id:string,framed=false){const item=this.item(id);const folder=item?.type==='equipment'?'equipment':item?.type==='monster_part'?'monster_parts':item?.type==='material'?'materials':'consumables';const variant=framed?'svg':'svg-noframe';const animatedMaterial=!framed&&(id==='mat_bliss_stone'||id==='mat_divine_shard');const filename=animatedMaterial?`${id}_alpha.png`:`${id}.svg`;return `/assets/ui/items/${variant}/${folder}/${filename}`;} mapList(){return this.maps()} monster(id:string){return this.monsters().find(x=>x.id===id);}
}
