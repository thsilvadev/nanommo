import { CommonModule } from '@angular/common';
import { CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { CatalogService } from '../../core/catalog.service';
import { CharacterStore, InventoryStore } from '../../core/game.store';
import { InventoryGrid } from './components';
import { TooltipPositionDirective } from './tooltip-position.directive';

@Component({ selector:'app-market', standalone:true, imports:[CommonModule,CdkDropList,InventoryGrid,TooltipPositionDirective], templateUrl:'./market.component.html', styleUrl:'./market.component.css', styles:[".market-sell-drop{min-height:132px;margin:10px 0 14px;padding:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;border:1px dashed #a88753;background:radial-gradient(ellipse at top,#302315 0%,#17120e 70%);color:#bda57e;transition:border-color .15s,background .15s,box-shadow .15s}.market-sell-drop.has-item{border-style:solid;border-color:#9b7a46;color:#e3cfaa}.market-sell-drop img{width:44px;height:44px;object-fit:contain;filter:drop-shadow(0 2px 3px #000)}.market-sell-drop p{max-width:220px;margin:0;line-height:1.5}.market-sell-drop span{font-size:11px;color:#aa9677}.market-sell-drop button{background:transparent;color:#c9a66c;border:0;text-decoration:underline;cursor:pointer;font-size:11px}.market-sell-drop.drop-hover{border-color:#e2c17b;background:#332719;box-shadow:0 0 0 2px #c49a5344,inset 0 0 20px #c49a531f}.market-drop-row{display:flex;flex-direction:row;justify-content:space-around;align-items:center;gap:8px;margin:8px 0;color:#bda57e;font-size:11px;text-align:center}.market-drop-target-column{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0}.market-drop-row .market-primary{width:auto;flex:0 0 auto;white-space:nowrap}.market-sell-drop{position:relative;flex:0 0 48px;width:48px;height:48px;min-height:48px;box-sizing:border-box;margin:0;padding:2px;border:1px dashed #a88753;display:grid;place-items:center;overflow:visible}.market-sell-drop img{width:38px;height:38px}.market-sell-drop b{position:absolute;right:1px;bottom:0;font:700 11px Arial;color:#fff;text-shadow:0 1px 2px #000}.market-sell-drop button{position:absolute;right:-7px;top:-7px;width:18px;height:18px;border:1px solid #9b7a46;border-radius:50%;background:#21170e;color:#f0d7a6;padding:0;text-decoration:none;font-size:14px;line-height:16px}.market-drop-hint{margin:4px 0 8px;color:#8f7b5e;font-size:10px}", "/* Keep the Market shell stationary; scrolling belongs to the listing results. */\n.market-page {\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n}\n.market-heading,\n.market-tabs,\n.market-error,\n.market-note {\n  flex: 0 0 auto;\n}\n.market-workspace {\n  flex: 1 1 0;\n  min-height: 0;\n  overflow: hidden;\n}\n.market-workspace > *,\n.market-sell-panel,\n.market-browse-panel {\n  min-height: 0;\n  box-sizing: border-box;\n}\n.market-sell-panel {\n  height: 100%;\n  overflow: hidden;\n}\n.market-browse-panel {\n  height: 100%;\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n}\n.market-filters {\n  flex: 0 0 auto;\n}\n.market-listings {\n  flex: 1 1 0;\n  min-height: 0;\n  grid-auto-rows: max-content;\n  align-content: start;\n  overflow-x: hidden;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  scrollbar-gutter: stable;\n}\n.market-pagination {\n  flex: 0 0 auto;\n}\n.market-table-wrap {\n  flex: 1 1 0;\n  min-height: 0;\n  overflow-x: hidden;\n  overflow-y: auto;\n  align-content: start;\n}\n.market-note {\n  margin-top: 8px;\n}\n@media (max-width: 760px) {\n  .market-page {\n    overflow: hidden;\n  }\n  .market-workspace {\n    overflow-y: auto;\n    overflow-x: hidden;\n    flex: 1 1 0;\n  }\n  .market-sell-panel {\n    height: auto;\n    overflow: visible;\n  }\n  .market-browse-panel {\n    height: 520px;\n    flex: 0 0 520px;\n  }\n}", ".market-modal-backdrop{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:20px;background:#000b;backdrop-filter:blur(2px)}.market-modal{width:min(460px,100%);max-height:min(82vh,720px);overflow:auto;box-sizing:border-box;padding:20px;border:1px solid #9b7849;background:linear-gradient(180deg,#211710,#120e0b);color:#e5d5b9;box-shadow:0 18px 52px #000d,inset 0 0 0 1px #382719;font:13px Arial,sans-serif}.market-modal header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:12px;margin-bottom:14px;border-bottom:1px solid #4d3823}.market-modal header small{display:block;color:#b99759;letter-spacing:1.8px;text-transform:uppercase}.market-modal h2{margin:4px 0 0;color:#f0d9a7;font:22px Georgia,serif}.market-modal-close{width:28px;height:28px;border:1px solid #5e472e;background:#17110d;color:#d9bf8e;font-size:20px;cursor:pointer}.market-modal-item{display:flex;align-items:center;gap:12px;padding:10px;background:#1a140e;border:1px solid #43311f;margin-bottom:12px}.market-modal-item>img{width:46px;height:46px;object-fit:contain}.market-modal-item div{display:grid;gap:5px;min-width:0}.market-modal-item small,.market-modal-subtitle{color:#ad997a;line-height:1.4}.market-modal-summary{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;padding:10px;background:#19130e;border:1px solid #3d2c1d}.market-modal-summary span{color:#bda780}.market-modal-summary b{text-align:right;color:#e8c979}.market-modal-note{color:#c59d68;line-height:1.5;margin:12px 0 0}.market-modal label{display:grid;gap:6px;color:#bda780;margin:12px 0}.market-modal input{box-sizing:border-box;width:100%;background:#0c0b09;border:1px solid #665034;color:#f2e3c6;padding:9px;font:16px Arial}.market-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.market-modal-actions button{border:1px solid #765632;background:#261c12;color:#d9c39e;padding:9px 13px;font:12px Arial;cursor:pointer}.market-modal-actions .primary{background:linear-gradient(#76542b,#4d351c);border-color:#c49a53;color:#fff0c9;font-weight:bold}.market-modal-actions button:disabled{opacity:.45;cursor:not-allowed}.market-slot-item{position:relative;width:100%;height:100%;display:grid;place-items:center}.market-slot-item .item-tooltip,.mailbox-item-icon .item-tooltip{position:absolute;z-index:20}"] })
export class MarketComponent implements OnInit {
  private api=inject(ApiService); readonly catalog=inject(CatalogService); readonly character=inject(CharacterStore); readonly inventory=inject(InventoryStore);
  readonly tab=signal<'browse'|'orders'|'deals'>('browse'); readonly query=signal(''); readonly type=signal(''); readonly tier=signal(''); readonly minPrice=signal(''); readonly maxPrice=signal(''); readonly sort=signal('lowest'); readonly page=signal(1);
  readonly listings=signal<any[]>([]); readonly total=signal(0); readonly suggestion=signal<any|null>(null); readonly orders=signal<any[]>([]); readonly deals=signal<any[]>([]); readonly loading=signal(false); readonly busyId=signal(''); readonly error=signal('');
  readonly selectedInventoryId=signal(''); readonly unitPrice=signal(''); readonly marketDropHovered=signal(false); readonly listingConfirmation=signal(false); readonly purchaseListing=signal<any|null>(null); readonly purchaseStep=signal<'quantity'|'confirm'|null>(null); readonly purchaseQuantity=signal('1');
  readonly selectedInventory=computed(()=>this.inventory.items().find(row=>row.id===this.selectedInventoryId())??null);
  readonly listingGross=computed(()=>{const row=this.selectedInventory();const p=Number(this.unitPrice());return row&&Number.isSafeInteger(p)&&p>0?Number(row.quantity)*p:0});
  readonly listingFee=computed(()=>this.listingGross()>0?Math.max(1,Math.ceil(this.listingGross()*0.01)):0);
  readonly maxGold=999999999; readonly pageSize=20;
  ngOnInit(){void Promise.all([this.catalog.load(),this.inventory.load(),this.character.load()]).then(()=>this.refresh())}
  refresh(){if(this.tab()==='browse')return this.loadListings();if(this.tab()==='orders')return this.loadOrders();return this.loadDeals()}
  setTab(t:'browse'|'orders'|'deals'){this.tab.set(t);this.error.set('');void this.refresh()}
  async loadListings(){this.loading.set(true);this.error.set('');try{const p=new URLSearchParams({query:this.query(),sort:this.sort(),page:String(this.page()),pageSize:String(this.pageSize)});if(this.type())p.set('type',this.type());if(this.tier())p.set('tier',this.tier());if(this.minPrice())p.set('minPrice',this.minPrice());if(this.maxPrice())p.set('maxPrice',this.maxPrice());const r=await this.api.get<any>('/market/listings?'+p.toString()).toPromise();this.listings.set(r?.items??[]);this.total.set(Number(r?.total??0))}catch(e:any){this.error.set(e?.error?.message??'Unable to load Market listings')}finally{this.loading.set(false)}}
  async loadOrders(){this.loading.set(true);try{this.orders.set(await this.api.get<any[]>('/market/my-orders').toPromise()??[])}catch(e:any){this.error.set(e?.error?.message??'Unable to load your listings')}finally{this.loading.set(false)}}
  async loadDeals(){this.loading.set(true);try{this.deals.set(await this.api.get<any[]>('/market/my-deals').toPromise()??[])}catch(e:any){this.error.set(e?.error?.message??'Unable to load deal history')}finally{this.loading.set(false)}}
  search(){this.page.set(1);void this.loadListings()}
  @HostListener('document:nm:drag-end') onInventoryDragEnd(){this.marketDropHovered.set(false)}
  dropInventoryStack(event:CdkDragDrop<any>){
    this.marketDropHovered.set(false);
    const data=event.item.data;
    if(data?.source!=='inventory'||!data.id)return;
    const row=this.inventory.items().find(item=>item.id===data.id);
    if(!row){this.error.set('That inventory stack is no longer available');return;}
    this.changeInventory(row.id);
  }
  changeInventory(id:string){this.selectedInventoryId.set(id);this.unitPrice.set('');this.suggestion.set(null);const row=this.inventory.items().find(x=>x.id===id);if(row)void this.loadSuggestion(row.itemId)}
  async loadSuggestion(itemId:string){try{const result=await this.api.get<any>('/market/suggestion/'+itemId).toPromise();if(this.selectedInventory()?.itemId!==itemId)return;this.suggestion.set(result??null);if(result?.suggestedUnitPrice)this.unitPrice.set(String(result.suggestedUnitPrice))}catch{this.suggestion.set(null)}}
  async createListing(confirmed = false){
    const row=this.selectedInventory(); const price=Number(this.unitPrice());
    if(!row){this.error.set('Select an inventory stack first');return}
    if(!Number.isSafeInteger(price)||price<1){this.error.set('Unit price must be a positive integer');return}
    const gross=Number(row.quantity)*price;
    if(!Number.isSafeInteger(gross)||gross>this.maxGold){this.error.set('Listing total cannot exceed 999,999,999 gold');return}
    if(!confirmed){this.listingConfirmation.set(true);return}
    this.listingConfirmation.set(false);this.loading.set(true);this.error.set('');
    try{await this.api.post('/market/orders/sell',{inventoryItemId:row.id,itemId:row.itemId,quantity:row.quantity,pricePerUnit:price}).toPromise();this.selectedInventoryId.set('');this.unitPrice.set('');await Promise.all([this.inventory.load(),this.character.load()]);this.tab.set('orders');await this.loadOrders()}
    catch(e:any){this.error.set(e?.error?.message??'Unable to create listing')}
    finally{this.loading.set(false)}
  }
  purchase(row:any){this.purchaseListing.set(row);this.purchaseQuantity.set('1');this.error.set('');this.purchaseStep.set('quantity')}
  purchaseRemaining(){const row=this.purchaseListing();return Math.max(1,Number(row?.remainingQuantity??row?.escrowedItemQuantity??1))}
  purchaseGross(){return Math.max(0,Number(this.purchaseQuantity())*Number(this.purchaseListing()?.pricePerUnit??0))}
  continuePurchase(){
    const q=Number(this.purchaseQuantity());
    if(!Number.isSafeInteger(q)||q<1||q>this.purchaseRemaining()){this.error.set('Choose a valid quantity to purchase');return}
    const gross=q*Number(this.purchaseListing()?.pricePerUnit??0);
    if(!Number.isSafeInteger(gross)||gross>this.maxGold){this.error.set('Purchase total exceeds 999,999,999 gold');return}
    this.error.set('');this.purchaseStep.set('confirm');
  }
  async confirmPurchase(){
    const row=this.purchaseListing();const quantity=Number(this.purchaseQuantity());
    if(!row||!Number.isSafeInteger(quantity)||quantity<1||quantity>this.purchaseRemaining())return;
    const gross=quantity*Number(row.pricePerUnit);if(!Number.isSafeInteger(gross)||gross>this.maxGold){this.error.set('Purchase total exceeds 999,999,999 gold');return}
    this.busyId.set(row.id);this.error.set('');
    try{await this.api.post('/market/orders/'+row.id+'/purchase',{quantity}).toPromise();this.purchaseStep.set(null);this.purchaseListing.set(null);await Promise.all([this.character.load(),this.loadListings()])}
    catch(e:any){this.error.set(e?.error?.message??'Purchase failed')}
    finally{this.busyId.set('')}
  }
  closePurchase(){this.purchaseStep.set(null);this.purchaseListing.set(null);this.purchaseQuantity.set('1');this.error.set('')}
  async cancel(row:any){if(!window.confirm('Cancel listing? Remaining items go to Mail; the listing fee is not refunded.'))return;this.busyId.set(row.id);try{await this.api.delete('/market/orders/'+row.id).toPromise();await this.loadOrders()}catch(e:any){this.error.set(e?.error?.message??'Unable to cancel listing')}finally{this.busyId.set('')}}
  itemIcon(id:string){return this.catalog.itemIcon(id)}
  tooltip(id:string,instance?:any){return this.catalog.itemTooltipLines(id,instance).map(x=>(x.label?x.label+': ':'')+x.value).join(' · ')}
  own(row:any){return row.characterId===this.character.character()?.id}
  pages(){return Math.max(1,Math.ceil(this.total()/this.pageSize))}
  changePage(n:number){this.page.set(Math.max(1,Math.min(this.pages(),this.page()+n)));void this.loadListings()}
}
