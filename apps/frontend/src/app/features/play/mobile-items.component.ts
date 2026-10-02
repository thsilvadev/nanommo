import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { CharacterStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { VendorStore } from '../../core/vendor.store';
import { ActionSheetAction, ActionSheetComponent } from '../../shared/action-sheet.component';
import { GameFormatService } from '../../core/game-format.service';

interface SelectedItem { item:any; equipped:boolean; }

@Component({selector:'app-mobile-items',standalone:true,imports:[CommonModule,ActionSheetComponent],templateUrl:'./mobile-items.component.html',styleUrl:'./mobile-items.component.css'})
export class MobileItemsComponent {
 readonly character=inject(CharacterStore);readonly inventory=inject(InventoryStore);readonly catalog=inject(CatalogService);readonly vendor=inject(VendorStore);readonly format=inject(GameFormatService);
 readonly selected=signal<SelectedItem|null>(null);
 slots=Array.from({length:50},(_,i)=>i);equipment=['head','body','mainHand','offHand','shoes','cape','accessoryLeft','accessoryRight'];

 item(i:number){return this.inventory.items().find(x=>x.slotIndex===i)}
 equipped(s:string){return this.inventory.equipment().find(x=>x.slot===s)}
 icon(id:string){return this.catalog.itemIcon(id)}
 tap(it:any,equipped=false){this.selected.set({item:it,equipped})}
 selectedDef(){const s=this.selected();return s?this.catalog.item(s.item.itemId):null}
 selectedDetails(){const d:any=this.selectedDef();if(!d)return [];const hidden=new Set(['id','name','vendorSells','stackable','maxStack','sellPriceToVendor','usableFor','droppedBy']);return this.format.itemTooltipLines(d).filter((x:any)=>!hidden.has(x.label))}
 actions():ActionSheetAction[]{const s=this.selected(),d=this.selectedDef();if(!s||!d)return[];if(s.equipped&&d.type==='equipment')return[{id:'unequip',label:'Desequipar'},{id:'details',label:'Detalhes'}];const out:ActionSheetAction[]=[];if(d.type==='consumable')out.push({id:'use',label:'Usar'});if(d.type==='equipment'&&d.slot){const current=this.equipped(d.slot);out.push({id:'equip',label:current?'Substituir '+(this.catalog.item(current.itemId)?.name??current.itemId):'Equipar'});} if(d.type==='monster_part'&&this.character.character()?.status==='town')out.push({id:'sell',label:'Vender'});out.push({id:'details',label:'Detalhes'});return out}
 async act(action:string){const s=this.selected();if(!s)return;const it=s.item;try{if(action==='use')await this.inventory.useConsumable(it.itemId);else if(action==='equip'){const d=this.catalog.item(it.itemId);if(d?.slot)await this.inventory.equip(d.slot,it.itemId)}else if(action==='unequip')await this.inventory.unequip(it.slot);else if(action==='sell'&&this.character.character()?.status==='town'){await this.vendor.openSell(it.itemId);this.selected.set(null);return}}finally{if(action!=='details')this.selected.set(null)}}
 close(){this.selected.set(null)}
}