
import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { GameSocketService } from './game.socket.service';
import { Character, InventoryItem, EquippedItem, BattleQueueEntry, BattleResolved, CharacterLeveledUp, CharacterDied, MapPresence } from './game.models';
type LoadState='idle'|'loading'|'loaded'|'error'|'reconnecting';
@Injectable({providedIn:'root'})
export class CharacterStore {
 private readonly api=inject(ApiService); private readonly _character=signal<Character|null>(null); private readonly _state=signal<LoadState>('idle'); private loadSeq=0; private readonly _error=signal<string|null>(null);
 readonly character=this._character.asReadonly();readonly state=this._state.asReadonly();readonly error=this._error.asReadonly();readonly isGrinding=computed(()=>this._character()?.status==='grinding');
 async load(){const seq=++this.loadSeq;this._state.set('loading');try{const value=await this.api.get<Character|null>('/characters').toPromise()??null;if(seq!==this.loadSeq)return;this._character.set(value);this._state.set('loaded')}catch(e:any){if(seq!==this.loadSeq)return;this._state.set('error');this._error.set(e?.error?.message??'Unable to load character')}}
 applyPatch(p:Partial<Character>){const c=this._character();if(c)this._character.set({...c,...p});}
 spend(attributes:Record<string,number>):Promise<Character>{return new Promise((resolve,reject)=>this.api.post<Character>('/characters/attributes/spend',{attributes}).subscribe({next:c=>{this._character.set(c);resolve(c)},error:e=>reject(e)}));}
}
@Injectable({providedIn:'root'})
export class InventoryStore {
 private readonly api=inject(ApiService);private readonly _items=signal<InventoryItem[]>([]);private readonly _equipment=signal<EquippedItem[]>([]);private readonly _state=signal<LoadState>('idle');private readonly _draggedItemId=signal<string|null>(null);
 readonly items=this._items.asReadonly();readonly equipment=this._equipment.asReadonly();readonly state=this._state.asReadonly();readonly draggedItemId=this._draggedItemId.asReadonly();private loadSeq=0;
 async load(){const seq=++this.loadSeq;this._state.set('loading');try{const [i,e]=await Promise.all([this.api.get<InventoryItem[]>('/inventory').toPromise(),this.api.get<EquippedItem[]>('/equipment').toPromise()]);if(seq!==this.loadSeq)return;this._items.set(i??[]);this._equipment.set(e??[]);this._state.set('loaded')}catch{if(seq===this.loadSeq)this._state.set('error')}}
 async equip(slot:string,itemId:string){await this.api.put('/equipment/equip',{slot,itemId}).toPromise();await this.load();}
 async unequip(slot:string){await this.api.delete('/equipment/slot/'+slot).toPromise();await this.load();}
 beginDrag(itemId:string){this._draggedItemId.set(itemId)}
 endDrag(){this._draggedItemId.set(null)}
 async useConsumable(itemId:string){await this.api.post('/inventory/use',{itemId}).toPromise();await this.load();}
}
@Injectable({providedIn:'root'})
export class BattleStore {
 private readonly api=inject(ApiService);private readonly socket=inject(GameSocketService);private readonly _queue=signal<BattleQueueEntry[]>([]);private readonly _state=signal<LoadState>('idle');private readonly _lastResolved=signal<BattleResolved|null>(null);private readonly _death=signal<CharacterDied|null>(null);private readonly _mapPresence=signal<MapPresence|null>(null);private bound=false; private hasConnectedOnce=false; private loadSeq=0;
 readonly queue=this._queue.asReadonly();readonly state=this._state.asReadonly();readonly lastResolved=this._lastResolved.asReadonly();readonly death=this._death.asReadonly();readonly mapPresence=this._mapPresence.asReadonly();
 private readonly _sessionDrops=signal<Array<{itemId:string;quantity:number}>>([]);
 readonly sessionDrops=this._sessionDrops.asReadonly();
 beginGrindSession(){this._sessionDrops.set([]);}
 private addSessionDrops(drops:any[]){
  const next=[...this._sessionDrops()];
  for(const drop of drops??[]){const itemId=String(drop?.itemId??'');const quantity=Number(drop?.quantity??0);if(!itemId||quantity<=0)continue;const existing=next.find(x=>x.itemId===itemId);if(existing)existing.quantity+=quantity;else next.push({itemId,quantity});}
  this._sessionDrops.set(next);
 }readonly active=computed(()=>this._queue().slice().sort((a,b)=>a.sequenceIndex-b.sequenceIndex)[0]??null);
 async load(){const seq=++this.loadSeq;this._state.set('loading');try{const value=await this.api.get<BattleQueueEntry[]>('/battles/queue').toPromise()??[];if(seq!==this.loadSeq)return;this._queue.set(value);this._state.set('loaded')}catch{if(seq===this.loadSeq)this._state.set('error')}}
 bindEvents(character:CharacterStore,inventory:InventoryStore){if(this.bound)return;this.bound=true;this.socket.on<{entries:BattleQueueEntry[]}>('battle:queueUpdated').subscribe(v=>{this._queue.set(v.entries??[]);void inventory.load();if(!(v.entries??[]).length)void this.load()});this.socket.on<MapPresence>('map:presence').subscribe(v=>this._mapPresence.set(v));this.socket.on<BattleResolved>('battle:resolved').subscribe(v=>{this._lastResolved.set(v);this.addSessionDrops(v.drops as any[]);character.applyPatch(v.characterAfter);void Promise.all([character.load(),inventory.load()])});this.socket.on<CharacterLeveledUp>('character:leveledUp').subscribe(v=>character.applyPatch({level:v.newLevel,unspentAttributePoints:v.unspentAttributePoints}));this.socket.on<CharacterDied>('character:died').subscribe(v=>{this._death.set(v);void this.resync(character,inventory)});this.socket.onConnectionState().subscribe(s=>{if(s==='reconnecting'||s==='disconnected')this._state.set('reconnecting');if(s==='connected'){if(this.hasConnectedOnce)void this.resync(character,inventory);else this.hasConnectedOnce=true;}})}
 currentBattleCharacterHp(now=Date.now()){const b=this.active();if(!b||now<Date.parse(b.startAt)||now>=Date.parse(b.endAt))return null;const events=Array.isArray((b.log as any)?.events)?(b.log as any).events:[];const tick=Math.floor((now-Date.parse(b.startAt))/1000);let hp=Number((b.log as any)?.header?.characterSnapshot?.hp??b.hpAfter);let sp=Number((b.log as any)?.header?.characterSnapshot?.sp??b.spAfter);for(const e of events){if(Number(e.tick??0)>tick)break;if(e?.hpRemaining?.character!==undefined)hp=Number(e.hpRemaining.character);if(e?.spRemaining?.character!==undefined)sp=Number(e.spRemaining.character);}return {hp,sp};}
 async resync(character:CharacterStore,inventory:InventoryStore){await Promise.all([character.load(),this.load(),inventory.load()])}
}
