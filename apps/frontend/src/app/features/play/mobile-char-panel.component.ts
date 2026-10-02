import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { CharacterStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { TickerService } from '../../core/ticker.service';

@Component({selector:'app-mobile-char-panel',standalone:true,imports:[CommonModule],templateUrl:'./mobile-char-panel.component.html',styleUrl:'./mobile-char-panel.component.css'})
export class MobileCharPanelComponent {
 readonly character=inject(CharacterStore);readonly inventory=inject(InventoryStore);readonly catalog=inject(CatalogService);readonly ticker=inject(TickerService);
 slots=['head','body','mainHand','offHand','shoes','cape','accessoryLeft','accessoryRight'];dietSlots=[0,1,2];
 item(slot:string){const e=this.inventory.equipment().find(x=>x.slot===slot);return e?this.catalog.itemIcon(e.itemId):'/assets/ui/'+({head:'helmet',body:'armor',mainHand:'sword',offHand:'shield',shoes:'boots',cape:'cape',accessoryLeft:'ring',accessoryRight:'ring'} as any)[slot]+'.svg'}
 dietEntry(i:number){return this.character.character()?.diet?.[i]??null}
 dietIcon(i:number){const e=this.dietEntry(i);return e?this.catalog.itemIcon(e.itemId):'/assets/ui/food.svg'}
 dietName(i:number){const e=this.dietEntry(i);return e?(this.catalog.item(e.itemId)?.name??e.itemId):'Empty'}
 dietStars(i:number){const e=this.dietEntry(i);return e?'★'.repeat(Math.max(0,Math.min(3,Number(e.dietLevel??0)))):'·'}
 dietRemaining(i:number){const e=this.dietEntry(i);if(!e)return 0;return Math.max(0,Math.ceil((Date.parse(e.digestUntil)-this.ticker.now())/1000))}
 async toggleAutoFeed(){const c=this.character.character();if(!c)return;try{await this.character.setAutoFeed(!c.autoFeed)}catch{}}
}