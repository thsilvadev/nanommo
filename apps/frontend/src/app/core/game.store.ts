
import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { GameSocketService } from './game.socket.service';
import { Character, InventoryItem, EquippedItem, BattleQueueEntry, BattleResolved, CharacterLeveledUp, CharacterDied } from './game.models';
type LoadState='idle'|'loading'|'loaded'|'error'|'reconnecting';
@Injectable({providedIn:'root'})
export class CharacterStore {
 private readonly api=inject(ApiService); private readonly _character=signal<Character|null>(null); private readonly _state=signal<LoadState>('idle'); private readonly _error=signal<string|null>(null);
 readonly character=this._character.asReadonly();readonly state=this._state.asReadonly();readonly error=this._error.asReadonly();readonly isGrinding=computed(()=>this._character()?.status==='grinding');
 async load(){this._state.set('loading');try{this._character.set(await this.api.get<Character|null>('/characters').toPromise()??null);this._state.set('loaded')}catch(e:any){this._state.set('error');this._error.set(e?.error?.message??'Unable to load character')}}
 applyPatch(p:Partial<Character>){const c=this._character();if(c)this._character.set({...c,...p});}
 spend(attributes:Record<string,number>):Promise<Character>{return new Promise((resolve,reject)=>this.api.post<Character>('/characters/attributes/spend',{attributes}).subscribe({next:c=>{this._character.set(c);resolve(c)},error:e=>reject(e)}));}
}
@Injectable({providedIn:'root'})
export class InventoryStore {
 private readonly api=inject(ApiService);private readonly _items=signal<InventoryItem[]>([]);private readonly _equipment=signal<EquippedItem[]>([]);private readonly _state=signal<LoadState>('idle');
 readonly items=this._items.asReadonly();readonly equipment=this._equipment.asReadonly();readonly state=this._state.asReadonly();
 async load(){this._state.set('loading');try{const [i,e]=await Promise.all([this.api.get<InventoryItem[]>('/inventory').toPromise(),this.api.get<EquippedItem[]>('/equipment').toPromise()]);this._items.set(i??[]);this._equipment.set(e??[]);this._state.set('loaded')}catch{this._state.set('error')}}
 async equip(slot:string,itemId:string){await this.api.put('/equipment/equip',{slot,itemId}).toPromise();await this.load();}
 async unequip(slot:string){await this.api.delete('/equipment/slot/'+slot).toPromise();await this.load();}
}
@Injectable({providedIn:'root'})
export class BattleStore {
 private readonly api=inject(ApiService);private readonly socket=inject(GameSocketService);private readonly _queue=signal<BattleQueueEntry[]>([]);private readonly _state=signal<LoadState>('idle');private readonly _lastResolved=signal<BattleResolved|null>(null);private readonly _death=signal<CharacterDied|null>(null);private bound=false;
 readonly queue=this._queue.asReadonly();readonly state=this._state.asReadonly();readonly lastResolved=this._lastResolved.asReadonly();readonly death=this._death.asReadonly();readonly active=computed(()=>this._queue().slice().sort((a,b)=>a.sequenceIndex-b.sequenceIndex)[0]??null);
 async load(){this._state.set('loading');try{this._queue.set(await this.api.get<BattleQueueEntry[]>('/battles/queue').toPromise()??[]);this._state.set('loaded')}catch{this._state.set('error')}}
 bindEvents(character:CharacterStore){if(this.bound)return;this.bound=true;this.socket.on<{entries:BattleQueueEntry[]}>('battle:queueUpdated').subscribe(v=>this._queue.set(v.entries??[]));this.socket.on<BattleResolved>('battle:resolved').subscribe(v=>{this._lastResolved.set(v);character.applyPatch(v.characterAfter)});this.socket.on<CharacterLeveledUp>('character:leveledUp').subscribe(v=>character.applyPatch({level:v.newLevel,unspentAttributePoints:v.unspentAttributePoints}));this.socket.on<CharacterDied>('character:died').subscribe(v=>{this._death.set(v);void this.resync(character)});this.socket.onConnectionState().subscribe(s=>{if(s==='reconnecting'||s==='disconnected')this._state.set('reconnecting');if(s==='connected')void this.resync(character)});}
 async resync(character:CharacterStore){await Promise.all([character.load(),this.load()])}
}
