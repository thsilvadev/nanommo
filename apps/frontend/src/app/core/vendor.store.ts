import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { CharacterStore, InventoryStore } from './game.store';
import { CatalogService } from './catalog.service';
import { VendorNpc, VendorStockItem, VendorQuote } from '@nanommo/shared';

export interface VendorModal { mode:'buy'|'sell'; itemId:string; quantity:number; maxQuantity:number; unitPrice:number; }

@Injectable({providedIn:'root'})
export class VendorStore {
  private readonly api=inject(ApiService);
  readonly character=inject(CharacterStore);
  readonly inventory=inject(InventoryStore);
  readonly catalog=inject(CatalogService);
  readonly npcs=signal<VendorNpc[]>([]);
  readonly selectedNpcId=signal('william');
  readonly stock=signal<VendorStockItem[]>([]);
  readonly modal=signal<VendorModal|null>(null);
  readonly error=signal<string|null>(null);
  readonly busy=signal(false);
  readonly selectedNpc=computed(()=>this.npcs().find(n=>n.id===this.selectedNpcId())??null);

  async load(){
    try{
      const npcs=await this.api.get<VendorNpc[]>('/town/npcs').toPromise();
      this.npcs.set(npcs??[]);
      if(!this.npcs().some(n=>n.id===this.selectedNpcId())) this.selectedNpcId.set(this.npcs()[0]?.id??'');
      await this.loadStock();
    }catch(e:any){this.error.set(e?.error?.message??'Unable to load Town NPCs');}
  }
  async loadStock(){
    const id=this.selectedNpcId();
    if(!id)return;
    try{this.stock.set(await this.api.get<VendorStockItem[]>('/town/vendor/'+id+'/stock').toPromise()??[]);}
    catch(e:any){this.error.set(e?.error?.message??'Unable to load vendor stock');}
  }
  selectNpc(id:string){this.selectedNpcId.set(id);this.error.set(null);void this.loadStock();}
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
  async openSell(itemId:string){
    this.error.set(null);
    const owned=this.totalOwned(itemId);
    if(owned<=0)return;
    try{
      const q=await this.api.get<VendorQuote>('/town/vendor/'+this.selectedNpcId()+'/quote/'+itemId).toPromise();
      const unit=Number(q?.sellPrice??0);
      if(unit<=0){this.error.set('William cannot buy this item');return;}
      const max=q?.stackable?owned:1;
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
