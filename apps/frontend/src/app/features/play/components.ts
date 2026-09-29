import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CharacterStore, BattleStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { GameSocketService } from '../../core/game.socket.service';
import { ApiService } from '../../core/api.service';
import { CdkDrag, CdkDropList, CdkDropListGroup, CdkDragDrop, CdkDragStart } from '@angular/cdk/drag-drop';

@Component({selector:'app-character-summary',standalone:true,imports:[CommonModule],templateUrl:'./character-summary.html',styleUrl:'./character-summary.css'})
export class CharacterSummary {
 readonly character=inject(CharacterStore);readonly inventory=inject(InventoryStore);readonly catalog=inject(CatalogService);readonly router=inject(Router);
 slots=[{key:'head',label:'Head',icon:'/assets/ui/helmet.svg'},{key:'body',label:'Body',icon:'/assets/ui/armor.svg'},{key:'mainHand',label:'Weapon',icon:'/assets/ui/sword.svg'},{key:'offHand',label:'Shield',icon:'/assets/ui/shield.svg'},{key:'shoes',label:'Shoes',icon:'/assets/ui/boots.svg'},{key:'cape',label:'Cape',icon:'/assets/ui/cape.svg'},{key:'accessoryLeft',label:'Ring',icon:'/assets/ui/ring.svg'},{key:'accessoryRight',label:'Ring',icon:'/assets/ui/ring.svg'}];
 initial(){return (this.character.character()?.name||'?').slice(0,1).toUpperCase()} hpPct(){const c=this.character.character();return c?.maxHp?Math.max(0,Math.min(100,c.hpCurrent/c.maxHp*100)):0} spPct(){const c=this.character.character();return c?.maxSp?Math.max(0,Math.min(100,c.spCurrent/c.maxSp*100)):0}
 statusLabel(){const s=this.character.character()?.status;return s==='grinding'?'Grinding':s==='dead_pending_return'?'Dead — return pending':'In Town'}
 itemName(slot:string){const e=this.inventory.equipment().find(x=>x.slot===slot);return e?e.itemId.replaceAll('_',' '):''} itemIcon(slot:string,fallback:string){const e=this.inventory.equipment().find(x=>x.slot===slot);return e?this.catalog.itemIcon(e.itemId):fallback} go(p:string){void this.router.navigateByUrl(p)}
}

@Component({selector:'app-map-board',standalone:true,imports:[CommonModule],templateUrl:'./map-board.html',styleUrl:'./map-board.css'})
export class MapBoard {
 readonly character=inject(CharacterStore);private readonly api=inject(ApiService);
 maps:any[]=[];selected=signal<string|null>(null);error=signal<string|null>(null);
 constructor(){this.api.get<any[]>('/maps').subscribe({next:m=>this.maps=m,error:e=>this.error.set(e?.error?.message??'Unable to load maps')});}
 mapName(){return this.maps.find(m=>m.id===this.character.character()?.currentMapId)?.name||'Town'}
 level(){return this.character.character()?.level??1}
 select(t:any){if(t.unlockLevel<=this.level())this.selected.set(t.id)}
 enter(id:string){const map=this.maps.find(m=>m.id===id);if(!map||map.unlockLevel>this.level())return;this.error.set(null);this.api.post(`/maps/${id}/enter`,{}).subscribe({next:()=>void this.character.load(),error:e=>this.error.set(e?.error?.message??'Map entry rejected by server')})}
}

@Component({selector:'app-inventory-grid',standalone:true,imports:[CommonModule,CdkDropList,CdkDrag,CdkDropListGroup],templateUrl:'./inventory-grid.html',styleUrl:'./inventory-grid.css'})
export class InventoryGrid {
 readonly inventory=inject(InventoryStore);readonly catalog=inject(CatalogService);slots=Array.from({length:50},(_,i)=>i);
 equipmentSlots=[['head','Head'],['body','Body'],['mainHand','Weapon'],['offHand','Shield'],['shoes','Shoes'],['cape','Cape'],['accessoryLeft','Ring'],['accessoryRight','Ring']];
 activeSlot=signal<string|null>(null);
 item(i:number){return this.inventory.items().find(x=>x.slotIndex===i)}
 equipped(slot:string){return this.inventory.equipment().find(x=>x.slot===slot)}
 itemTitle(i:any){return this.catalog.item(i.itemId)?.name??i.itemId}
 glyph(i:any){return this.catalog.itemIcon(i.itemId)}
 onDragStart(ev:CdkDragStart<any>){const d=this.catalog.item(ev.source.data.itemId);this.activeSlot.set(d?.type==='equipment'?(d.slot ?? null):null)}
 onDragEnd(){this.activeSlot.set(null)}
 dropInventory(ev:CdkDragDrop<any>){const data=ev.item.data;if(data?.source==='equipment'){void this.inventory.unequip(data.slot)}}
 dropEquipment(slot:string,ev:CdkDragDrop<any>){const data=ev.item.data;if(data?.source==='inventory'){void this.inventory.equip(slot,data.itemId)}this.activeSlot.set(null)}
 dragData(it:any){return {source:'inventory',...it}}
 equipDragData(slot:string,it:any){return {source:'equipment',slot,...it}}
}

@Component({selector:'app-battle-progress',standalone:true,imports:[CommonModule],templateUrl:'./battle-progress.html',styleUrl:'./battle-progress.css'})
export class BattleProgress implements OnDestroy{@Input()entry!:any;readonly now=signal(Date.now());private readonly timer=setInterval(()=>this.now.set(Date.now()),250);progress(){const s=Date.parse(this.entry.startAt),e=Date.parse(this.entry.endAt);return Math.max(0,Math.min(100,(this.now()-s)/Math.max(1,e-s)*100))}remaining(){const sec=Math.max(0,Math.ceil((Date.parse(this.entry.endAt)-this.now())/1000));return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')}ngOnDestroy(){clearInterval(this.timer)}}

@Component({selector:'app-grind-info',standalone:true,imports:[CommonModule,BattleProgress],templateUrl:'./grind-info.html',styleUrl:'./grind-info.css'})
export class GrindInfo implements OnDestroy {
 readonly battle=inject(BattleStore);
 readonly character=inject(CharacterStore);
 readonly inventory=inject(InventoryStore);
 readonly catalog=inject(CatalogService);
 readonly now=signal(Date.now());
 private readonly timer=setInterval(()=>this.now.set(Date.now()),250);

 stateLabel(){return this.battle.state()==='reconnecting'?'RECONNECTING':this.battle.active()?'ACTIVE':'IDLE'}
 monster(id:string){return this.catalog.monster(id)}
 consumableItems(){return this.inventory.items().filter(x=>this.catalog.item(x.itemId)?.type==='consumable').slice(0,3)}
 elapsedTicks(entry:any){const start=Date.parse(entry.startAt);const duration=Number(entry.log?.durationTicks??Math.max(1,(Date.parse(entry.endAt)-start)/1000));return Math.max(0,Math.min(duration,Math.floor((this.now()-start)/1000)))}
 events(entry:any){return Array.isArray(entry.log?.events)?entry.log.events:[]}
 lastEvent(entry:any){const tick=this.elapsedTicks(entry);let state=entry.log?.header?.characterSnapshot&&{tick:-1,hpRemaining:{character:Number(entry.log.header.characterSnapshot.hp??0),monster:Number(entry.log.header.monsterSnapshot?.hp??0)}};for(const e of this.events(entry)){if(Number(e.tick??0)<=tick)state=e;else break}return state}
 characterHp(entry:any){return Number(this.lastEvent(entry)?.hpRemaining?.character??entry.hpAfter??0)}
 monsterHp(entry:any){return Number(this.lastEvent(entry)?.hpRemaining?.monster??entry.log?.header?.monsterSnapshot?.hp??0)}
 characterMaxHp(entry:any){return Number(entry.log?.header?.characterSnapshot?.maxHp??0)}
 monsterMaxHp(entry:any){return Number(entry.log?.header?.monsterSnapshot?.maxHp??entry.log?.header?.monsterSnapshot?.hp??0)}
 percent(v:number,max:number){return max>0?Math.max(0,Math.min(100,v/max*100)):0}
 recentEvents(entry:any){const tick=this.elapsedTicks(entry);return this.events(entry).filter((e:any)=>Number(e.tick??0)<=tick).slice(-4).reverse()}
 eventText(e:any){if(e.action==='attack')return e.actor==='monster'?'Monster attacks for '+Number(e.damage??0):'Character attacks for '+Number(e.damage??0);if(e.action==='use_item')return (e.actor==='character'?'Character uses ':'Monster uses ')+String(e.itemId??'item').replaceAll('_',' ');if(e.action==='use_skill')return (e.actor==='character'?'Character casts ':'Monster casts ')+String(e.skillId??'skill').replaceAll('_',' ');return String(e.action??'event')}
 foodLabel(){const c=this.character.character();const expiry=c?.foodBuffExpiresAt?Date.parse(c.foodBuffExpiresAt):0;const active=expiry>this.now();return active?'FED · '+Math.max(0,Math.ceil((expiry-this.now())/60000))+'m':'HUNGRY'}
 ngOnDestroy(){clearInterval(this.timer)}
}

@Component({selector:'app-weapon-proficiency',standalone:true,imports:[CommonModule],templateUrl:'./weapon-proficiency.html',styleUrl:'./weapon-proficiency.css'})
export class WeaponProficiency {rows=[['Sword','sword'],['Greatsword','greatsword'],['Dagger','dagger'],['Bow','bow'],['Staff','staff'],['Wand','wand'],['Shield','shield']].map(([name,key])=>({name,key,level:null,progress:0,icon:key==='shield'?'/assets/ui/shield.svg':'/assets/ui/weapon.svg'}));}

@Component({selector:'app-chat-drawer',standalone:true,imports:[CommonModule],templateUrl:'./chat-drawer.html',styleUrl:'./chat-drawer.css'})
export class ChatDrawer{@Input()open=false;@Output()closed=new EventEmitter<void>();}
