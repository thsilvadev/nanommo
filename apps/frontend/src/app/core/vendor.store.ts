import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { CharacterStore, InventoryStore } from './game.store';
import { CatalogService } from './catalog.service';
import { TownNpc, VendorStockItem, VendorQuote, NpcDialogueState } from '@nanommo/shared';

export interface VendorModal { mode:'buy'|'sell'; itemId:string; quantity:number; maxQuantity:number; unitPrice:number; }
export interface CookingState { progress:{level:number;xp:number;xpIntoLevel:number;xpToNextLevel:number;nextLevelXp:number}; recipes:any[]; session:any|null; }

/** Maximum amount selectable when selling the Inventory row that was dragged. */
export function sellModalMaxQuantity(ownedQuantity:number, selectedStackQuantity:number|undefined, stackable:boolean):number {
  if (!stackable) return 1;
  const owned = Math.max(0, Math.trunc(Number(ownedQuantity) || 0));
  const selected = Number.isFinite(Number(selectedStackQuantity)) && Number(selectedStackQuantity) > 0
    ? Math.trunc(Number(selectedStackQuantity)) : owned;
  return Math.max(0, Math.min(owned, selected));
}

@Injectable({providedIn:'root'})
export class VendorStore {
  private readonly api=inject(ApiService);
  readonly character=inject(CharacterStore);
  readonly inventory=inject(InventoryStore);
  readonly catalog=inject(CatalogService);
  readonly npcs=signal<TownNpc[]>([]);
  readonly dialogue=signal<NpcDialogueState|null>(null);
  readonly selectedNpcId=signal('');
  readonly stock=signal<VendorStockItem[]>([]);
  readonly warehouse=signal<import('./game.models').InventoryItem[]>([]);
  readonly modal=signal<VendorModal|null>(null);
  readonly cookingModal=signal(false);
  readonly cookingState=signal<CookingState|null>(null);
  readonly cookingNow=signal(Date.now());
  private cookingTimer:ReturnType<typeof setInterval>|null=null;
  private cookingRefreshSessionId:string|null=null;
  readonly error=signal<string|null>(null);
  readonly busy=signal(false);
  readonly selectedNpc=computed(()=>this.npcs().find(n=>n.id===this.selectedNpcId())??null);
  private npcLoadSequence=0;

  /** Reset transient Town interaction state whenever the Town panel is entered. */
  resetForTownEntry(clearNpcCatalogue = true){
    // Invalidate any NPC catalogue request started for the previous Town.
    this.npcLoadSequence++;
    if(clearNpcCatalogue) this.npcs.set([]);
    this.selectedNpcId.set('');
    this.stock.set([]);
    this.warehouse.set([]);
    this.dialogue.set(null);
    this.modal.set(null);
    this.cookingModal.set(false);
    this.error.set(null);
  }
  private async loadTownNpcFallback(mapId:string):Promise<TownNpc[]> {
    const get=async(path:string)=>{const response=await fetch('/data/'+path);if(!response.ok)throw new Error('Unable to load Town NPC fallback '+path);return response.json();};
    const [mapsData,npcData,vendor]=await Promise.all([get('maps.json'),get('npc_catalog.json'),get('npc_vendor.json')]);
    const map=(mapsData.maps??[]).find((row:any)=>row.id===mapId);
    const catalogue=Array.isArray(npcData.npcs)?npcData.npcs:[];
    const ids:string[]=Array.isArray(map?.npcIds)?map.npcIds:(mapId==='map_town'?[String(vendor.id??'william'),...catalogue.map((row:any)=>String(row.id))]:[]);
    return ids.map(id=>id===vendor.id?{id:vendor.id,name:vendor.name,location:vendor.location,types:['vendor'],greeting:vendor.greeting??vendor.vendor?.greeting} as TownNpc:catalogue.find((row:any)=>row.id===id&&row.location==='town') as TownNpc|undefined).filter((row):row is TownNpc=>!!row);
  }

  async load(){
    const requestSequence=++this.npcLoadSequence;
    try{
      // Seed the panel from the same canonical public JSON used by the backend.
      // The API response then confirms/replaces it; a transient request/transition
      // race can no longer blank an otherwise valid Town NPC list.
      let catalogLoadError:any=null;
      try { await this.catalog.load(); } catch(error) { catalogLoadError=error; }
      const characterAtRequest=this.character.character?.();
      const mapIdAtRequest=characterAtRequest?.currentMapId;
      let catalogueNpcs:TownNpc[]=mapIdAtRequest?this.catalog.townNpcsForMap(mapIdAtRequest) as TownNpc[]:[];
      if(!catalogueNpcs.length && mapIdAtRequest) {
        try { catalogueNpcs=await this.loadTownNpcFallback(mapIdAtRequest); } catch { /* API request below remains the authoritative attempt. */ }
      }
      if(requestSequence!==this.npcLoadSequence) return;
      if(catalogueNpcs.length) this.npcs.set(catalogueNpcs as TownNpc[]);
      const npcs=await this.api.get<TownNpc[]>('/town/npcs').toPromise();
      const latestCharacter=this.character.character?.();
      if(requestSequence!==this.npcLoadSequence) return;
      // A Town-to-Town transition can overlap an HTTP response from the previous
      // Town. Never let that response replace the destination's NPC catalogue.
      if(mapIdAtRequest && (latestCharacter?.currentMapId!==mapIdAtRequest || latestCharacter?.status!=='town')) {
        // If the response raced with arrival at a different, already-settled Town,
        // fetch that Town's catalogue instead of leaving a placeholder catalogue behind.
        if(latestCharacter?.status==='town' && latestCharacter.currentMapId && latestCharacter.currentMapId!==mapIdAtRequest && !latestCharacter.travelIntent && !latestCharacter.pendingMapTransition) void this.load();
        return;
      }
      if(Array.isArray(npcs) && npcs.length) {
        this.npcs.set(npcs);
        this.error.set(null);
      } else if(catalogueNpcs.length) {
        // A successful HTTP response with an empty NPC list is still inconsistent
        // with a Town whose map JSON names residents. Keep the canonical map list
        // visible and make the API/catalogue inconsistency diagnosable.
        this.npcs.set(catalogueNpcs as TownNpc[]);
        this.error.set(catalogLoadError ? 'Town catalogue load failed; showing NPCs from the standalone map/catalogue files.' : 'Town NPC endpoint returned an empty list; showing the map catalogue.');
      } else this.npcs.set([]);
      if(this.selectedNpcId() && !this.npcs().some(n=>n.id===this.selectedNpcId())) this.resetForTownEntry(false);
      // An empty ID is intentional: never silently select the first NPC.
      await this.loadSelectedNpc();
    }catch(e:any){
      if(requestSequence===this.npcLoadSequence){
        // Keep the map-specific public-JSON entries displayed if the API is
        // temporarily unavailable, but surface the API error instead of hiding it.
        this.error.set(e?.error?.message??'Unable to refresh Town NPCs');
      }
    }
  }
  async loadSelectedNpc(){
    const id=this.selectedNpcId();
    const npc=this.npcs().find(n=>n.id===id);
    this.stock.set([]);
    this.warehouse.set([]);
    this.dialogue.set(null);
    if(!npc)return;
    const requests: Promise<void>[]=[];
    if(npc.types.includes('vendor')) requests.push(this.loadStock(id));
    if(npc.types.includes('quest')) requests.push(this.loadDialogue(id));
    if(npc.types.includes('storage')) requests.push(this.loadWarehouse(id));
    if(npc.types.includes('cooking')) requests.push(this.loadCooking());
    await Promise.all(requests);
  }
  async loadStock(id=this.selectedNpcId()){
    if(!id)return;
    try{
      const stock=await this.api.get<VendorStockItem[]>('/town/vendor/'+id+'/stock').toPromise()??[];
      if(this.selectedNpcId()===id) this.stock.set(stock);
    }catch(e:any){if(this.selectedNpcId()===id)this.error.set(e?.error?.message??'Unable to load vendor stock');}
  }
  async loadWarehouse(id=this.selectedNpcId()){
    if(!id || !this.npcs().find(n=>n.id===id)?.types.includes('storage')) { this.warehouse.set([]); return; }
    try {
      const rows=await this.api.get<import('./game.models').InventoryItem[]>('/town/warehouse/contents').toPromise() ?? [];
      if(this.selectedNpcId()===id) this.warehouse.set(rows);
    }catch(e:any){if(this.selectedNpcId()===id)this.error.set(e?.error?.message??'Unable to load Storage');}
  }
  async transferWarehouseRow(rowId:string, direction:'deposit'|'withdraw'){
    if(this.busy()) return; this.busy.set(true); this.error.set(null);
    try { await this.api.post('/town/warehouse/transfer',{rowId,direction}).toPromise(); await Promise.all([this.inventory.load(),this.loadWarehouse(),this.character.load()]); }
    catch(e:any) { this.error.set(e?.error?.message ?? 'Storage transfer rejected'); await Promise.all([this.inventory.load(),this.loadWarehouse()]); }
    finally { this.busy.set(false); }
  }
  async loadDialogue(id=this.selectedNpcId()){
    if(!id)return;
    try{
      const dialogue=await this.api.get<NpcDialogueState>('/town/npcs/'+id+'/dialogue').toPromise()??null;
      if(this.selectedNpcId()===id) this.dialogue.set(dialogue);
    }catch(e:any){if(this.selectedNpcId()===id)this.error.set(e?.error?.message??'Unable to load NPC dialogue');}
  }
  selectNpc(id:string){
    if(!id){this.resetForTownEntry(false);return;}
    this.selectedNpcId.set(id);
    this.stock.set([]);
    this.warehouse.set([]);
    this.dialogue.set(null);
    this.modal.set(null);
    this.cookingModal.set(false);
    this.error.set(null);
    void this.loadSelectedNpc();
  }
  async chooseDialogue(choiceId:string){
    const d=this.dialogue();
    if(!d||this.busy())return;
    this.busy.set(true);this.error.set(null);
    try{
      const next=await this.api.post<NpcDialogueState & {consumedItemId?:string}>('/town/npcs/'+d.npcId+'/dialogue',{nodeId:d.nodeId,choiceId}).toPromise();
      this.dialogue.set(next??null);
      await Promise.all([this.character.load(),this.inventory.load()]);
    }catch(e:any){this.error.set(e?.error?.message??'NPC interaction rejected');}
    finally{this.busy.set(false);}
  }
  async loadCooking(){
    try { const state=await this.api.get<CookingState>('/town/npcs/uncle_phillip/cooking').toPromise(); if(this.selectedNpcId()==='uncle_phillip') { this.cookingState.set(state??null); if(state?.session&&!this.cookingTimer)this.cookingTimer=setInterval(()=>{this.cookingNow.set(Date.now());const session=this.cookingState()?.session;if(session&&this.cookingRemaining()===0&&this.cookingRefreshSessionId!==session.id){this.cookingRefreshSessionId=session.id;void this.loadCooking().then(()=>Promise.all([this.inventory.load(),this.character.load()]));}},100); if(!state?.session&&this.cookingTimer){clearInterval(this.cookingTimer);this.cookingTimer=null;} } }
    catch(e:any){if(this.selectedNpcId()==='uncle_phillip')this.error.set(e?.error?.message??'Unable to load Cooking');}
  }
  openCooking(){this.cookingModal.set(true);void this.loadCooking();}
  closeCooking(){this.cookingModal.set(false);}
  cookingRemaining(){const session=this.cookingState()?.session;if(!session)return 0;return Math.max(0,Math.ceil((Date.parse(session.completesAt)-this.cookingNow())/1000));}
  cookingPercent(){const session=this.cookingState()?.session;if(!session)return 0;const start=Date.parse(session.startedAt),end=Date.parse(session.completesAt);return Math.max(0,Math.min(100,(this.cookingNow()-start)/Math.max(1,end-start)*100));}
  async startCooking(recipeId:string){if(this.busy())return;this.busy.set(true);this.error.set(null);try{const state=await this.api.post<CookingState>('/town/npcs/uncle_phillip/cooking/start',{recipeId}).toPromise();this.cookingState.set(state??null);this.cookingModal.set(true);if(!this.cookingTimer)this.cookingTimer=setInterval(()=>{this.cookingNow.set(Date.now());const session=this.cookingState()?.session;if(session&&this.cookingRemaining()===0&&this.cookingRefreshSessionId!==session.id){this.cookingRefreshSessionId=session.id;void this.loadCooking().then(()=>Promise.all([this.inventory.load(),this.character.load()]));}},100);}catch(e:any){this.error.set(e?.error?.message??'Unable to start Cooking');}finally{this.busy.set(false);}}
  async cancelCooking(){const session=this.cookingState()?.session;if(!session||this.busy())return;this.busy.set(true);this.error.set(null);try{const state=await this.api.post<CookingState>('/town/npcs/uncle_phillip/cooking/cancel',{sessionId:session.id}).toPromise();this.cookingState.set(state??null);await Promise.all([this.inventory.load(),this.character.load()]);if(!state?.session&&this.cookingTimer){clearInterval(this.cookingTimer);this.cookingTimer=null;}}catch(e:any){this.error.set(e?.error?.message??'Unable to cancel Cooking');await this.loadCooking();}finally{this.busy.set(false);}}
  item(id:string){return this.catalog.item(id);}
  itemName(id:string){return this.item(id)?.name??id;}
  totalOwned(itemId:string){return this.inventory.items().filter(x=>x.itemId===itemId).reduce((n,x)=>n+Number(x.quantity??0),0);}
  inventoryCapacity(itemId:string){
    const def=this.item(itemId); if(!def)return 0;
    const items=this.inventory.items();
    const free=50-items.length;
    if(!def.stackable)return free;
    let room=free*Number(def.maxStack??1);
    for(const row of items.filter(x=>x.itemId===itemId)) room+=Math.max(0,Number(def.maxStack??1)-row.quantity);
    return room;
  }
  async openSell(itemId:string, selectedStackQuantity?:number){
    this.error.set(null);
    const owned=this.totalOwned(itemId);
    if(owned<=0)return;
    try{
      const q=await this.api.get<VendorQuote>('/town/vendor/'+this.selectedNpcId()+'/quote/'+itemId).toPromise();
      const unit=Number(q?.sellPrice??0);
      if(unit<=0){this.error.set('This vendor cannot buy this item');return;}
      // Selling from a dragged stack scopes the modal to that stack, not the
      // sum of every matching item across the whole Inventory.
      const max=sellModalMaxQuantity(owned,selectedStackQuantity,!!q?.stackable);
      this.modal.set({mode:'sell',itemId,quantity:1,maxQuantity:max,unitPrice:unit});
    }catch(e:any){this.error.set(e?.error?.message??'Unable to price item');}
  }
  openBuy(entry:VendorStockItem){
    this.error.set(null);
    const gold=Number(this.character.character()?.gold??0);
    if(gold<entry.buyPrice){this.error.set('Not enough gold');return;}
    const capacity=this.inventoryCapacity(entry.itemId);
    if(capacity<=0){this.error.set('Inventory is full');return;}
    const affordable=Math.floor(gold/entry.buyPrice);
    const stockLimit=entry.infiniteStock||entry.quantity===null?Number.MAX_SAFE_INTEGER:Number(entry.quantity);
    const max=Math.min(affordable,stockLimit,entry.item?.['stackable']?capacity:1);
    if(max<1){this.error.set('Unable to buy this item');return;}
    this.modal.set({mode:'buy',itemId:entry.itemId,quantity:1,maxQuantity:max,unitPrice:entry.buyPrice});
  }
  setQuantity(value:number){
    const m=this.modal(); if(!m)return;
    const q=Math.max(1,Math.min(m.maxQuantity,Math.trunc(Number(value)||1)));
    this.modal.set({...m,quantity:q});
  }
  all(){const m=this.modal();if(m)this.setQuantity(m.maxQuantity);}
  total(){const m=this.modal();return m?m.quantity*m.unitPrice:0;}
  async confirm(){
    const m=this.modal(); if(!m||this.busy())return;
    this.busy.set(true);this.error.set(null);
    try{
      const path=m.mode==='buy'?'/town/vendor/'+this.selectedNpcId()+'/buy':'/town/vendor/'+this.selectedNpcId()+'/sell';
      await this.api.post(path,{itemId:m.itemId,quantity:m.quantity}).toPromise();
      this.modal.set(null);
      await Promise.all([this.character.load(),this.inventory.load(),this.loadStock()]);
    }catch(e:any){this.error.set(e?.error?.message??'Vendor transaction rejected');}
    finally{this.busy.set(false);}
  }
  cancel(){if(!this.busy())this.modal.set(null);}
}
