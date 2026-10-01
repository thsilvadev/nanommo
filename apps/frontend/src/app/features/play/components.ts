import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, OnDestroy, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CharacterStore, BattleStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { VendorStore } from '../../core/vendor.store';
import { VendorStockItem } from '@nanommo/shared';
import { GameSocketService } from '../../core/game.socket.service';
import { ApiService } from '../../core/api.service';
import { CdkDrag, CdkDropList, CdkDropListGroup, CdkDragDrop, CdkDragStart, CdkDragPreview, CdkDragPlaceholder } from '@angular/cdk/drag-drop';

@Component({selector:'app-character-summary',standalone:true,imports:[CommonModule,CdkDrag,CdkDropList,CdkDragPreview,CdkDragPlaceholder],templateUrl:'./character-summary.html',styleUrl:'./character-summary.css'})
export class CharacterSummary implements OnDestroy {
 readonly character=inject(CharacterStore);readonly inventory=inject(InventoryStore);readonly battle=inject(BattleStore);readonly catalog=inject(CatalogService);readonly router=inject(Router);
 private readonly townTimer=setInterval(()=>{const c=this.character.character();if(c?.status==='town'&&Date.parse(c.lastSeenAt)+10000<=Date.now())void this.character.load()},1000);
 slots=[{key:'head',label:'Head',icon:'/assets/ui/helmet.svg'},{key:'body',label:'Body',icon:'/assets/ui/armor.svg'},{key:'mainHand',label:'Weapon',icon:'/assets/ui/sword.svg'},{key:'offHand',label:'Shield',icon:'/assets/ui/shield.svg'},{key:'shoes',label:'Shoes',icon:'/assets/ui/boots.svg'},{key:'cape',label:'Cape',icon:'/assets/ui/cape.svg'},{key:'accessoryLeft',label:'Ring',icon:'/assets/ui/ring.svg'},{key:'accessoryRight',label:'Ring',icon:'/assets/ui/ring.svg'}];equipmentPredicates=Object.fromEntries(this.slots.map(s=>[s.key,(drag:CdkDrag)=>this.canEnterEquipmentSlot(s.key,drag)]));
 initial(){return (this.character.character()?.name||'?').slice(0,1).toUpperCase()}
 displayHp(){return this.character.character()?.hpCurrent??null}
 displaySp(){return this.character.character()?.spCurrent??null}
 hpPct(){const c=this.character.character();const hp=this.displayHp();return c?.maxHp&&hp!==null?Math.max(0,Math.min(100,hp/c.maxHp*100)):0}
 spPct(){const c=this.character.character();const sp=this.displaySp();return c?.maxSp&&sp!==null?Math.max(0,Math.min(100,sp/c.maxSp*100)):0}
 statusLabel(){const s=this.character.character()?.status;return s==='grinding'?'Grinding':s==='dead_pending_return'?'Dead — return pending':'In Town'}
 itemName(slot:string){const e=this.equipped(slot);return e?(this.catalog.item(e.itemId)?.name??e.itemId):''}
 itemDefinition(slot:string){const e=this.equipped(slot);return e?this.catalog.item(e.itemId):null}
 itemTooltipLines(slot:string){const d:any=this.itemDefinition(slot);if(!d)return [];const hidden=d.type==='consumable'?new Set(['vendorSells','stackable','maxStack','sellPriceToVendor']):d.type==='monster_part'?new Set(['usableFor','sellPriceToVendor','stackable','maxStack','droppedBy']):new Set<string>();const keys=Object.keys(d);const stop=Math.max(0,keys.indexOf('tier'));const visible=stop>0?keys.slice(0,stop):keys;return visible.filter(k=>k!=='id'&&k!=='name'&&!hidden.has(k)&&d[k]!==undefined&&d[k]!==null&&d[k]!=='').map(k=>({label:k==='effect'?'Effect':k.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase()),value:k==='effect'?this.formatItemEffect(d[k]):typeof d[k]==='object'?JSON.stringify(d[k]):String(d[k])}))}
 formatItemEffect(effect:any){if(!effect)return '';if(effect.status){const status=String(effect.status).replace(/_/g,' ');return `Cures ${status}.`}if(effect.type==='heal_hp')return `Restores ${Number(effect.amount)||0} HP.`;if(effect.type==='heal_sp')return `Restores ${Number(effect.amount)||0} SP.`;if(effect.type==='food_buff')return `Regenerates HP/SP for ${Math.round((Number(effect.durationSeconds)||0)/60)} minutes.`;return String(effect.type??'').replace(/_/g,' ').replace(/^./,x=>x.toUpperCase())+'.'}
 itemTierClass(slot:string){const tier=Number((this.itemDefinition(slot) as any)?.tier??0);return tier>=2&&tier<=5?'tier-'+tier:''}
 go(p:string){void this.router.navigateByUrl(p)} equipped(slot:string){return this.inventory.equipment().find(x=>x.slot===slot)} canEnterEquipmentSlot(slot:string,drag:CdkDrag){const data:any=drag?.data; if(data?.source!=='inventory') return false; const item=this.catalog.item(data.itemId); return item?.type==='equipment' && item.slot===slot} itemIcon(slot:string,fallback:string){const e=this.equipped(slot);return e?this.catalog.itemIcon(e.itemId):fallback} slotDropId(slot:string){return `character-slot-${slot}`} isSlotFocused(slot:string){const id=this.inventory.draggedItemId();const item=id?this.catalog.item(id):null;return item?.type==='equipment'&&item.slot===slot} onEquipmentDragStart(itemId:string){this.inventory.beginDrag(itemId)} onEquipmentDragEnd(){this.inventory.endDrag()} equipDragData(slot:string,it:any){return {source:'equipment',slot,...it}} async dropEquipment(slot:string,ev:CdkDragDrop<any>){const data=ev.item.data;try{if(data?.source==='inventory'){await this.inventory.equip(slot,data.itemId)}}catch{}finally{this.inventory.endDrag()}} async unequip(slot:string){try{await this.inventory.unequip(slot)}catch{}} ngOnDestroy(){clearInterval(this.townTimer)}
}

@Component({selector:'app-map-board',standalone:true,imports:[CommonModule],templateUrl:'./map-board.html',styleUrl:'./map-board.css'})
export class MapBoard implements OnDestroy {
 readonly character=inject(CharacterStore);readonly battle=inject(BattleStore);private readonly api=inject(ApiService);private readonly socket=inject(GameSocketService);
 maps:any[]=[];selected=signal<string|null>(null);error=signal<string|null>(null);readonly townReturnPending=signal(false);private readonly returnToTownBattleId=signal<string|null>(null);private townPoll:ReturnType<typeof setInterval>|null=null;private townPollBusy=false;
 constructor(){
  effect(()=>{
   const targetId=this.returnToTownBattleId();
   if(!targetId||this.battle.lastResolved()?.entryId!==targetId)return;
   this.returnToTownBattleId.set(null);
   this.townReturnPending.set(false);
   void Promise.all([this.character.load(), this.battle.load()]);
  });
  this.api.get<any[]>('/maps').subscribe({next:m=>this.maps=m,error:e=>this.error.set(e?.error?.message??'Unable to load maps')});
 }
 mapName(){return this.maps.find(m=>m.id===this.character.character()?.currentMapId)?.name||'Town'}
 playersInMap(){const current=this.character.character()?.currentMapId;return current&&this.battle.mapPresence()?.mapId===current?this.battle.mapPresence()?.playersOnMap??0:0}
 level(){return this.character.character()?.level??1}
 select(t:any){if(t.unlockLevel<=this.level())this.selected.set(t.id)}
 enter(id:string){const map=this.maps.find(m=>m.id===id);if(!map||map.unlockLevel>this.level())return;this.error.set(null);this.api.post(`/maps/${id}/enter`,{}).subscribe({next:async()=>{this.battle.beginGrindSession();this.townReturnPending.set(false);await this.character.load();try{await this.socket.emit('map:syncPresence',{mapId:id})}catch{}},error:e=>this.error.set(e?.error?.message??'Map entry rejected by server')})}
 enterTown(){
  const current=this.character.character();
  if(current?.status==='town' || !current?.currentMapId){
   this.character.applyPatch({status:'town',currentMapId:undefined});
   this.townReturnPending.set(false);
   this.returnToTownBattleId.set(null);
   this.stopTownPoll();
   return;
  }
  this.error.set(null);
  const active=this.battle.active();
  const isActive=!!active&&Date.now()>=Date.parse(active.startAt)&&Date.now()<Date.parse(active.endAt);
  if(isActive)this.townReturnPending.set(true);
  this.api.post<any>('/maps/leave',{}).subscribe({
   next:async result=>{
    this.character.applyPatch(result?.character??{});
    if(result?.deferred){
     this.returnToTownBattleId.set(result.battleId??active?.id??null);
     this.townReturnPending.set(true);
     this.startTownPoll();
     return;
    }
    this.returnToTownBattleId.set(null);
    this.townReturnPending.set(false);
    this.stopTownPoll();
    await Promise.all([this.character.load(),this.battle.load()]);
   },
   error:e=>{
    this.townReturnPending.set(false);
    this.returnToTownBattleId.set(null);
    this.error.set(e?.error?.message??'Unable to return to Town');
    void this.character.load();
    void this.battle.load();
   },
  });
 }
 private startTownPoll(){
  this.stopTownPoll();
  this.townPoll=setInterval(()=>{
   if(this.townPollBusy)return;
   this.townPollBusy=true;
   void this.character.load().finally(()=>{
    this.townPollBusy=false;
    const c=this.character.character();
    if(c?.status==='town' || !c?.currentMapId){
     this.townReturnPending.set(false);
     this.returnToTownBattleId.set(null);
     this.stopTownPoll();
     void this.battle.load();
    }
   });
  },1000);
 }
 private stopTownPoll(){if(this.townPoll!==null){clearInterval(this.townPoll);this.townPoll=null;}}
 ngOnDestroy(){this.stopTownPoll();}

}

@Component({selector:'app-inventory-grid',standalone:true,imports:[CommonModule,CdkDropList,CdkDrag],templateUrl:'./inventory-grid.html',styleUrl:'./inventory-grid.css'})
export class InventoryGrid implements OnDestroy {
 readonly inventory=inject(InventoryStore);readonly catalog=inject(CatalogService);readonly battle=inject(BattleStore);readonly vendor=inject(VendorStore);slots=Array.from({length:50},(_,i)=>i);readonly characterSlotIds=['character-slot-head','character-slot-body','character-slot-mainHand','character-slot-offHand','character-slot-shoes','character-slot-cape','character-slot-accessoryLeft','character-slot-accessoryRight'];readonly vendorDropListIds=['vendor-drop-list'];readonly now=signal(Date.now());private readonly timer=setInterval(()=>this.now.set(Date.now()),250);
 item(i:number){return this.inventory.items().find(x=>x.slotIndex===i)}
 itemTitle(i:any){return this.catalog.item(i.itemId)?.name??i.itemId}
 itemDefinition(i:any){return this.catalog.item(i.itemId)}
 itemTooltipLines(i:any){const d:any=this.itemDefinition(i);if(!d)return [];const hidden=d.type==='consumable'?new Set(['vendorSells','stackable','maxStack','sellPriceToVendor']):d.type==='monster_part'?new Set(['usableFor','sellPriceToVendor','stackable','maxStack','droppedBy']):new Set<string>();const keys=Object.keys(d);const stop=Math.max(0,keys.indexOf('tier'));const visible=stop>0?keys.slice(0,stop):keys;return visible.filter(k=>k!=='id'&&k!=='name'&&!hidden.has(k)&&d[k]!==undefined&&d[k]!==null&&d[k]!=='').map(k=>({label:k==='effect'?'Effect':k.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase()),value:k==='effect'?this.formatItemEffect(d[k]):typeof d[k]==='object'?JSON.stringify(d[k]):String(d[k])}))}
 formatItemEffect(effect:any){if(!effect)return '';if(effect.status){const status=String(effect.status).replace(/_/g,' ');return `Cures ${status}.`}if(effect.type==='heal_hp')return `Restores ${Number(effect.amount)||0} HP.`;if(effect.type==='heal_sp')return `Restores ${Number(effect.amount)||0} SP.`;if(effect.type==='food_buff')return `Regenerates HP/SP for ${Math.round((Number(effect.durationSeconds)||0)/60)} minutes.`;return String(effect.type??'').replace(/_/g,' ').replace(/^./,x=>x.toUpperCase())+'.'}
 itemTierClass(i:any){const tier=Number((this.itemDefinition(i) as any)?.tier??0);return tier>=2&&tier<=5?'tier-'+tier:''}
 glyph(i:any){return this.catalog.itemIcon(i.itemId)}
 elapsedTick(){const b=this.battle.active();if(!b)return -1;return Math.max(0,Math.floor((this.now()-Date.parse(b.startAt))/1000))}
 displayQuantity(it:any){return Number(it.quantity??0)}
 onDragStart(ev:CdkDragStart<any>){this.inventory.beginDrag(ev.source.data.itemId)}
 onDragEnd(){this.inventory.endDrag()}
 dropInventory(ev:CdkDragDrop<any>){const data=ev.item.data;if(data?.source==='equipment')void this.inventory.unequip(data.slot);else if(data?.source==='vendor')void this.vendor.openBuy(data.stock)}
 async doubleClick(it:any){const d=this.catalog.item(it.itemId);if(d?.type==='consumable'){try{await this.inventory.useConsumable(it.itemId)}catch{}}else if(d?.type==='equipment'&&d.slot){try{await this.inventory.equip(d.slot,it.itemId)}catch{}}}
 dragData(it:any){return {source:'inventory',...it}}
 ngOnDestroy(){clearInterval(this.timer)}
}

@Component({selector:'app-town-center',standalone:true,imports:[CommonModule,InventoryGrid],templateUrl:'./town-center.html',styleUrl:'./town-center.css'})
export class TownCenter {}

@Component({selector:'app-vendor-panel',standalone:true,imports:[CommonModule,CdkDropList,CdkDrag,CdkDragPreview,CdkDragPlaceholder],templateUrl:'./vendor-panel.html',styleUrl:'./vendor-panel.css'})
export class VendorPanel {
  readonly vendor=inject(VendorStore);readonly inventory=inject(InventoryStore);readonly slots=Array.from({length:10},(_,i)=>i);
  constructor(){void this.vendor.load();}
  stockAt(slot:number){return this.vendor.stock().find(x=>x.slotIndex===slot);}
  dragData(item:VendorStockItem){return {source:'vendor',vendorId:this.vendor.selectedNpcId(),itemId:item.itemId,stock:item};}
  drop(ev:CdkDragDrop<any>){const data=ev.item.data;if(data?.source==='inventory')void this.vendor.openSell(data.itemId);}
}

@Component({selector:'app-battle-progress',standalone:true,imports:[CommonModule],templateUrl:'./battle-progress.html',styleUrl:'./battle-progress.css'})
export class BattleProgress implements OnDestroy{@Input()entry!:any;readonly now=signal(Date.now());private readonly timer=setInterval(()=>this.now.set(Date.now()),250);progress(){const s=Date.parse(this.entry.startAt),e=Date.parse(this.entry.endAt);return Math.max(0,Math.min(100,(this.now()-s)/Math.max(1,e-s)*100))}remaining(){const sec=Math.max(0,Math.ceil((Date.parse(this.entry.endAt)-this.now())/1000));return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')}ngOnDestroy(){clearInterval(this.timer)}}

@Component({selector:'app-grind-info',standalone:true,imports:[CommonModule,BattleProgress,VendorPanel],templateUrl:'./grind-info.html',styleUrl:'./grind-info.css'})
export class GrindInfo implements OnDestroy {
 readonly battle=inject(BattleStore);
 readonly character=inject(CharacterStore);
 readonly inventory=inject(InventoryStore);
 readonly catalog=inject(CatalogService);readonly vendor=inject(VendorStore);
 readonly now=signal(Date.now());
 private readonly timer=setInterval(()=>this.now.set(Date.now()),250);

 stateLabel(){const b=this.battle.active();if(this.battle.state()==='reconnecting')return 'RECONNECTING';if(b&&this.isSearching(b))return 'SEARCHING';return b?'ACTIVE':'IDLE'}
 isSearching(entry:any){return Date.now()<Date.parse(entry.startAt)}
 searchEntry(entry:any){return {startAt:entry.log?.searchStartAt??new Date(Date.parse(entry.startAt)-2000).toISOString(),endAt:entry.startAt}}
 monsterSnapshot(entry:any){return (entry.log as any)?.header?.monsterSnapshot??{}}
 monsterStatusEffects(entry:any){return this.monsterSnapshot(entry).statusEffects??[]}
 monsterStats(entry:any){const m=this.monsterSnapshot(entry);return [{label:'ATK',value:m.atk},{label:'MATK',value:m.matk},{label:'DEF',value:m.def},{label:'MDEF',value:m.mdefPercent+'%'},{label:'ACC',value:m.accuracy},{label:'EVA',value:m.evasion},{label:'CRIT',value:m.critChance+'%'}]}

 isTown(){const c=this.character.character();return !!c && (c.status==='town'||!c.currentMapId)}
 activeGambitTitle(){return this.character.character()?.activeGambitPageId?'Configured':'Not configured'}
 xpText(){const c=this.character.character();return c?`${c.xp} / ${c.xpToNext}`:'—'}
 monster(id:string){return this.catalog.monster(id)}
 consumableItems(){return this.inventory.items().filter(x=>this.catalog.item(x.itemId)?.type==='consumable').slice(0,3)} displayQuantity(it:any){return Number(it.quantity??0)}
 elapsedTicks(entry:any){const start=Date.parse(entry.startAt);const duration=Number(entry.log?.durationTicks??Math.max(1,(Date.parse(entry.endAt)-start)/1000));return Math.max(0,Math.min(duration,Math.floor((this.now()-start)/1000)))}
 events(entry:any){return Array.isArray(entry.log?.events)?entry.log.events:[]}
 lastEvent(entry:any){const tick=this.elapsedTicks(entry);let state=entry.log?.header?.characterSnapshot&&{tick:-1,hpRemaining:{character:Number(entry.log.header.characterSnapshot.hp??0),monster:Number(entry.log.header.monsterSnapshot?.hp??0)}};for(const e of this.events(entry)){if(Number(e.tick??0)<=tick)state=e;else break}return state}
 characterHp(entry:any){return Number(this.lastEvent(entry)?.hpRemaining?.character??entry.hpAfter??0)}
 monsterHp(entry:any){return Number(this.lastEvent(entry)?.hpRemaining?.monster??entry.log?.header?.monsterSnapshot?.hp??0)}
 characterMaxHp(entry:any){return Number(entry.log?.header?.characterSnapshot?.maxHp??0)}
 monsterMaxHp(entry:any){return Number(entry.log?.header?.monsterSnapshot?.maxHp??entry.log?.header?.monsterSnapshot?.hp??0)}
 percent(v:number,max:number){return max>0?Math.max(0,Math.min(100,v/max*100)):0}
 recentEvents(entry:any){const tick=this.elapsedTicks(entry);return this.events(entry).filter((e:any)=>Number(e.tick??0)<=tick).slice(-4).reverse()}
 eventText(e:any){if(e.action==='attack'){const critical=e.crit?' CRITICAL!':'';return e.actor==='monster'?'Monster attacks for '+Number(e.damage??0)+critical:'Character attacks for '+Number(e.damage??0)+critical}if(e.action==='regen')return 'You regenerated '+Number(e.amount??0)+' '+String(e.resource??'HP')+'.';if(e.action==='use_item')return (e.actor==='character'?'Character uses ':'Monster uses ')+String(e.itemId??'item').replaceAll('_',' ');if(e.action==='use_skill')return (e.actor==='character'?'Character casts ':'Monster casts ')+String(e.skillId??'skill').replaceAll('_',' ');return String(e.action??'event')}
 sessionDrops(){return this.battle.sessionDrops()}
 sessionDropName(it:any){return this.catalog.item(it.itemId)?.name??it.itemId}
 sessionDropIcon(it:any){return this.catalog.itemIcon(it.itemId)}
 foodLabel(){const c=this.character.character();const expiry=c?.foodBuffExpiresAt?Date.parse(c.foodBuffExpiresAt):0;const active=expiry>this.now();return active?'FED · '+Math.max(0,Math.ceil((expiry-this.now())/60000))+'m':'HUNGRY'}
 ngOnDestroy(){clearInterval(this.timer)}
}

@Component({selector:'app-chat-drawer',standalone:true,imports:[CommonModule],templateUrl:'./chat-drawer.html',styleUrl:'./chat-drawer.css'})
export class ChatDrawer{@Input()open=false;@Output()closed=new EventEmitter<void>();}
