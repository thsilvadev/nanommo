
import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { GameSocketService } from './game.socket.service';
import { Character, InventoryItem, EquippedItem, EquipmentMutationResponse, BattleQueueEntry, BattleQueueUpdated, BattleResolved, CharacterLeveledUp, CharacterDied, MapPresence } from './game.models';
type LoadState='idle'|'loading'|'loaded'|'error'|'reconnecting';
@Injectable({providedIn:'root'})
export class CharacterStore {
 private readonly api=inject(ApiService); private readonly _character=signal<Character|null>(null); private readonly _state=signal<LoadState>('idle'); private loadSeq=0; private realtimeGeneration=0; private realtimeRevision=0; private confirmedStanceUpdatedAt=0; private readonly _error=signal<string|null>(null);
 readonly character=this._character.asReadonly();readonly state=this._state.asReadonly();readonly error=this._error.asReadonly();readonly isGrinding=computed(()=>this._character()?.status==='grinding');
 private preserveConfirmedStance(value:Character,current=this._character()):Character{if(!current||this.confirmedStanceUpdatedAt<=0)return value;const snapshotAt=Date.parse(String(value.updatedAt??''));if(!Number.isFinite(snapshotAt)||snapshotAt<=this.confirmedStanceUpdatedAt){const stance=current.lastGrindStance;return stance==='hunting'||stance==='gathering'?{...value,lastGrindStance:stance}:value;}this.confirmedStanceUpdatedAt=0;return value;}
 async load(){const seq=++this.loadSeq;const generation=this.realtimeGeneration;this._state.set('loading');try{const value=await this.api.get<Character|null>('/characters').toPromise()??null;if(seq!==this.loadSeq||generation!==this.realtimeGeneration)return;if(value&&value.stateVersion<this.realtimeRevision){const current=this._character();if(current){const reconciled=this.preserveConfirmedStance(value,current);const stance=reconciled.lastGrindStance;if((stance==='hunting'||stance==='gathering')&&current.lastGrindStance!==stance)this._character.set({...current,lastGrindStance:stance});}this._state.set('loaded');return;}if(value)this.realtimeRevision=value.stateVersion;this._character.set(value?this.preserveConfirmedStance(value):null);this._state.set('loaded')}catch(e:any){if(seq!==this.loadSeq||generation!==this.realtimeGeneration)return;this._state.set('error');this._error.set(e?.error?.message??'Unable to load character')}}
 applyPatch(p:Partial<Character>){const c=this._character();if(!c)return;const patchRevision=typeof p.stateVersion==='number'&&Number.isFinite(p.stateVersion)?p.stateVersion:null;if(patchRevision!==null&&patchRevision<this.realtimeRevision)return;if(patchRevision!==null)this.realtimeRevision=Math.max(this.realtimeRevision,patchRevision);this.realtimeGeneration++;this._character.set(this.preserveConfirmedStance({...c,...p},c));}
 applyConfirmedStance(stance:'hunting'|'gathering',response?:Partial<Character>){const c=this._character();if(!c)return;const responseRevision=typeof response?.stateVersion==='number'&&Number.isFinite(response.stateVersion)?response.stateVersion:null;const canMergeResponse=!!response&&(responseRevision===null||responseRevision>=this.realtimeRevision);const base=canMergeResponse?{...c,...response}:c;if(responseRevision!==null)this.realtimeRevision=Math.max(this.realtimeRevision,responseRevision);const responseAt=Date.parse(String(response?.updatedAt??''));const currentAt=Date.parse(String(c.updatedAt??''));this.confirmedStanceUpdatedAt=Math.max(Number.isFinite(responseAt)?responseAt:0,Number.isFinite(currentAt)?currentAt:0);this.realtimeGeneration++;this._character.set({...base,lastGrindStance:stance});}
 // Digestion expiry and some presentation fields can change without a newer
 // stateVersion. Fresh GETs may therefore replace an equal-revision snapshot, but
 // sequence/realtimeGeneration still rejects a request raced by a newer socket event,
 // and a genuinely older revision is never accepted. Diet eligibility is still decided
 // by the server; the client only re-reads state at the server-reported boundary.
 async refreshDiet(){const seq=++this.loadSeq;const generation=this.realtimeGeneration;try{const value=await this.api.get<Character|null>('/characters').toPromise()??null;if(seq!==this.loadSeq||generation!==this.realtimeGeneration)return;if(!value)return;if(value.stateVersion<this.realtimeRevision)return;this.realtimeRevision=value.stateVersion;this._character.set(this.preserveConfirmedStance(value));this._state.set('loaded')}catch{}}
 applyRealtimeSnapshot(value:Character,revision:number){if(revision<=this.realtimeRevision)return;this.realtimeRevision=revision;this.realtimeGeneration++;this._character.set(this.preserveConfirmedStance(value));this._state.set('loaded');}
 async setAutoFeed(enabled:boolean):Promise<Character>{const value=await this.api.post<Character>('/characters/auto-feed',{enabled}).toPromise();if(value&&value.stateVersion>this.realtimeRevision)this.applyRealtimeSnapshot(value,value.stateVersion);return value as Character;}
 spend(attributes:Record<string,number>):Promise<Character>{const generation=this.realtimeGeneration;return new Promise((resolve,reject)=>this.api.post<Character>('/characters/attributes/spend',{attributes}).subscribe({next:c=>{if(generation!==this.realtimeGeneration||c.stateVersion<this.realtimeRevision){reject(new Error('Character changed while attribute update was in flight'));return;}this.realtimeRevision=Math.max(this.realtimeRevision,c.stateVersion);this.realtimeGeneration++;this._character.set(this.preserveConfirmedStance(c));resolve(this._character()??c)},error:e=>reject(e)}));}
}
@Injectable({providedIn:'root'})
export class InventoryStore {
 private readonly api=inject(ApiService); private readonly character=inject(CharacterStore);private readonly _items=signal<InventoryItem[]>([]);private readonly _equipment=signal<EquippedItem[]>([]);private readonly _state=signal<LoadState>('idle');private readonly _draggedItemId=signal<string|null>(null);
 readonly items=this._items.asReadonly();readonly equipment=this._equipment.asReadonly();readonly state=this._state.asReadonly();readonly draggedItemId=this._draggedItemId.asReadonly();private loadSeq=0;private realtimeGeneration=0;private realtimeRevision=0;
 async load(){const seq=++this.loadSeq;const generation=this.realtimeGeneration;this._state.set('loading');try{const [inventory,equipment]=await Promise.all([this.api.get<{items:InventoryItem[];stateVersion:number}>('/inventory').toPromise(),this.api.get<EquippedItem[]>('/equipment').toPromise()]);if(seq!==this.loadSeq||generation!==this.realtimeGeneration)return;if((inventory?.stateVersion??0)<this.realtimeRevision)return;this.realtimeRevision=Math.max(this.realtimeRevision,inventory?.stateVersion??0);this._items.set(inventory?.items??[]);this._equipment.set(equipment??[]);this._state.set('loaded')}catch{if(seq===this.loadSeq&&generation===this.realtimeGeneration)this._state.set('error')}}
 applyRealtimeSnapshot(items:InventoryItem[],revision:number){if(revision<=this.realtimeRevision)return;this.realtimeRevision=revision;this.realtimeGeneration++;this._items.set(items);this._state.set('loaded');}
 applyMutationSnapshot(snapshot:EquipmentMutationResponse){
  if(snapshot.stateVersion<=this.realtimeRevision)return;
  this.realtimeRevision=snapshot.stateVersion;
  this.realtimeGeneration++;
  this._items.set(snapshot.inventory??[]);
  this._equipment.set(snapshot.equipment??[]);
  this._state.set('loaded');
  this.character.applyRealtimeSnapshot(snapshot.character,snapshot.stateVersion);
 }
 private applyInventoryLayoutSnapshot(snapshot:{items:InventoryItem[];character:Character;stateVersion:number}){
  if(snapshot.stateVersion<=this.realtimeRevision)return;
  this.realtimeRevision=snapshot.stateVersion;
  this.realtimeGeneration++;
  this._items.set(snapshot.items??[]);
  this._state.set('loaded');
  this.character.applyRealtimeSnapshot(snapshot.character,snapshot.stateVersion);
 }
 async moveItemToSlot(itemId:string,targetSlotIndex:number){
  const snapshot=await this.api.put<{items:InventoryItem[];character:Character;stateVersion:number}>('/inventory/slot',{itemId,targetSlotIndex}).toPromise();
  if(snapshot)this.applyInventoryLayoutSnapshot(snapshot);
 }
 async sortInventory(itemIds:string[]){
  const snapshot=await this.api.put<{items:InventoryItem[];character:Character;stateVersion:number}>('/inventory/sort',{itemIds}).toPromise();
  if(snapshot)this.applyInventoryLayoutSnapshot(snapshot);
 }
 async splitStack(itemId:string,quantity:number){
  const snapshot=await this.api.put<{items:InventoryItem[];character:Character;stateVersion:number}>('/inventory/split',{itemId,quantity}).toPromise();
  if(snapshot)this.applyInventoryLayoutSnapshot(snapshot);
 }
 async equip(slot:string,itemId:string){const snapshot=await this.api.put<EquipmentMutationResponse>('/equipment/equip',{slot,itemId}).toPromise();if(snapshot)this.applyMutationSnapshot(snapshot);}
 async unequip(slot:string){const snapshot=await this.api.delete<EquipmentMutationResponse>('/equipment/slot/'+slot).toPromise();if(snapshot)this.applyMutationSnapshot(snapshot);}
 beginDrag(itemId:string){this._draggedItemId.set(itemId)}
 endDrag(){this._draggedItemId.set(null)}
 async useConsumable(itemId:string){
  const snapshot=await this.api.post<{character:Character;inventory:InventoryItem[];stateVersion:number}>('/inventory/use',{itemId}).toPromise();
  if(!snapshot)return;
  if(snapshot.stateVersion<=this.realtimeRevision)return;
  this.realtimeRevision=snapshot.stateVersion;
  this.realtimeGeneration++;
  this._items.set(snapshot.inventory??[]);
  this._state.set('loaded');
  this.character.applyRealtimeSnapshot(snapshot.character,snapshot.stateVersion);
 }
}
@Injectable({providedIn:'root'})
export class BattleStore {
 private readonly api=inject(ApiService);private readonly socket=inject(GameSocketService);private readonly _queue=signal<BattleQueueEntry[]>([]);private readonly _state=signal<LoadState>('idle');private readonly _lastResolved=signal<BattleResolved|null>(null);private readonly _death=signal<CharacterDied|null>(null);private readonly _mapPresence=signal<MapPresence|null>(null);private bound=false; private hasConnectedOnce=false; private loadSeq=0; private realtimeGeneration=0; private readonly resolvedEntryIds=new Set<string>();
 readonly queue=this._queue.asReadonly();readonly state=this._state.asReadonly();readonly lastResolved=this._lastResolved.asReadonly();readonly death=this._death.asReadonly();readonly mapPresence=this._mapPresence.asReadonly();
 private readonly _sessionDrops=signal<Array<{itemId:string;quantity:number}>>([]);
 private readonly _recentBattleIntervals=signal<Array<{entryId:string;startAt:string;endAt:string}>>([]); private recoveryCharacter:CharacterStore|null=null; private queueRecoveryTimer:ReturnType<typeof setInterval>|null=null; private queueRecoveryInFlight=false;
 readonly recentBattleIntervals=this._recentBattleIntervals.asReadonly();
 readonly sessionDrops=this._sessionDrops.asReadonly();
 beginGrindSession(){this._sessionDrops.set([]);}
 private addSessionDrops(drops:any[]){
  const next=[...this._sessionDrops()];
  for(const drop of drops??[]){const itemId=String(drop?.itemId??'');const quantity=Number(drop?.quantity??0);if(!itemId||quantity<=0)continue;const existing=next.find(x=>x.itemId===itemId);if(existing)existing.quantity+=quantity;else next.push({itemId,quantity});}
  this._sessionDrops.set(next);
 }readonly active=computed(()=>this._queue().slice().sort((a,b)=>a.sequenceIndex-b.sequenceIndex)[0]??null);
 async load(){const seq=++this.loadSeq;const generation=this.realtimeGeneration;this._state.set('loading');try{const value=await this.api.get<BattleQueueEntry[]>('/battles/queue').toPromise()??[];if(seq!==this.loadSeq||generation!==this.realtimeGeneration)return;this._queue.set(value.filter(entry=>!this.resolvedEntryIds.has(entry.id)));this._state.set('loaded')}catch{if(seq===this.loadSeq&&generation===this.realtimeGeneration)this._state.set('error')}}
 private rememberBattleInterval(v:BattleResolved){
  if(!v.entryId||!v.startAt||!v.endAt||this._recentBattleIntervals().some(row=>row.entryId===v.entryId))return;
  const effectiveEnd=v.cancellationReason==='flee'&&v.cancelledAt?v.cancelledAt:v.endAt;
  this._recentBattleIntervals.set([...this._recentBattleIntervals(),{entryId:v.entryId,startAt:v.startAt,endAt:effectiveEnd}].slice(-512));
 }
 private reconcileMissingBattleQueue(){const character=this.recoveryCharacter?.character();if(this.queueRecoveryInFlight||!character||character.status!=='grinding'||this._queue().length>0)return;this.queueRecoveryInFlight=true;const generation=this.realtimeGeneration;this.api.get<BattleQueueEntry[]>('/battles/queue').subscribe({next:value=>{if(generation===this.realtimeGeneration&&this._queue().length===0){const entries=(value??[]).filter(entry=>!this.resolvedEntryIds.has(entry.id));if(entries.length){this._queue.set(entries);this._state.set('loaded');}}},error:()=>{this.queueRecoveryInFlight=false;},complete:()=>{this.queueRecoveryInFlight=false;}});}
 ngOnDestroy(){if(this.queueRecoveryTimer!==null)clearInterval(this.queueRecoveryTimer);this.queueRecoveryTimer=null;}
 bindEvents(character:CharacterStore,inventory:InventoryStore){if(this.bound)return;this.bound=true;this.recoveryCharacter=character;this.queueRecoveryTimer=setInterval(()=>this.reconcileMissingBattleQueue(),3000);this.socket.on<BattleQueueUpdated>('battle:queueUpdated').subscribe(v=>{this.realtimeGeneration++;if(v.characterAfter&&v.inventoryAfter&&v.stateRevision!==undefined){character.applyRealtimeSnapshot(v.characterAfter,v.stateRevision);inventory.applyRealtimeSnapshot(v.inventoryAfter,v.stateRevision)}const entries=(v.entries??[]).filter(entry=>!this.resolvedEntryIds.has(entry.id));this._queue.set(entries);this._state.set('loaded');if(!entries.length)void this.load()});this.socket.on<MapPresence>('map:presence').subscribe(v=>this._mapPresence.set(v));this.socket.on<BattleResolved>('battle:resolved').subscribe(v=>{this.rememberBattleInterval(v);this.realtimeGeneration++;this._state.set('loaded');if(v.entryId){this.resolvedEntryIds.add(v.entryId);if(this.resolvedEntryIds.size>512){const oldest=this.resolvedEntryIds.values().next().value;if(oldest)this.resolvedEntryIds.delete(oldest)}this._queue.set(this._queue().filter(entry=>entry.id!==v.entryId))}this._lastResolved.set(v);this.addSessionDrops(v.drops as any[]);character.applyRealtimeSnapshot(v.characterAfter,v.stateRevision);inventory.applyRealtimeSnapshot(v.inventoryAfter,v.stateRevision)});this.socket.on<CharacterLeveledUp>('character:leveledUp').subscribe(v=>character.applyPatch({level:v.newLevel,unspentAttributePoints:v.unspentAttributePoints}));this.socket.on<CharacterDied>('character:died').subscribe(v=>{this._death.set(v);void this.resync(character,inventory)});this.socket.onConnectionState().subscribe(s=>{if(s==='reconnecting'||s==='disconnected')this._state.set('reconnecting');if(s==='connected'){if(this.hasConnectedOnce)void this.resync(character,inventory);else this.hasConnectedOnce=true;}})}
 currentBattleCharacterResources(now=Date.now()){const b=this.active();if(!b||now<Date.parse(b.startAt)||now>=Date.parse(b.endAt))return null;const log:any=b.log;const events=Array.isArray(log?.events)?log.events:[];const tick=Math.floor((now-Date.parse(b.startAt))/1000);let hp=Number(log?.header?.characterSnapshot?.hp??b.hpAfter);let sp=Number(log?.header?.characterSnapshot?.sp??b.spAfter);for(const e of events){if(Number(e.tick??0)>tick)break;if(e?.hpRemaining?.character!==undefined)hp=Number(e.hpRemaining.character);if(e?.spRemaining?.character!==undefined)sp=Number(e.spRemaining.character);}return {hp,sp};}
 async resync(character:CharacterStore,inventory:InventoryStore){await Promise.all([character.load(),this.load(),inventory.load()])}
}
