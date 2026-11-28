import { TownStore } from '../../core/town.store';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VendorPanel } from './components';
import { VendorStore } from '../../core/vendor.store';
import { InventoryStore, CharacterStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';

describe('Balance Storage template', () => {
  it('renders fifteen Storage slots and keeps vendor stock at ten', () => {
    const vendor: any = new Proxy({ localized:(_row:any,_field:string,fallback:any)=>fallback ?? '', questSpeechOverride:signal(null),questInteraction:signal(null), selectedNpc: signal({id:'storage',name:'Storage',types:['storage']}), warehouse:signal([]), modal:signal(null), error:signal(null), busy:signal(false), t:(x:string)=>x, itemName:()=>'', stock:signal([]), loading:signal(false), selectedNpcId:signal('storage'), dialogue:signal(null), cookingState:signal(null), professionState:signal(null), refinementState:signal(null), npcs:signal([]), character:{character:signal({gold:0})} },{get:(target:any,key)=>key in target ? target[key] : ()=>null});
    TestBed.configureTestingModule({imports:[VendorPanel],providers:[
      {provide:TownStore,useValue:{isNpcNearby:()=>true, selectedNpcId:signal('storage')}},{provide:VendorStore,useValue:vendor},{provide:InventoryStore,useValue:{items:signal([]),draggedItemId:signal(null)}},
      {provide:CharacterStore,useValue:{character:signal({gold:0})}},{provide:CatalogService,useValue:{}}
    ]});
    const fixture=TestBed.createComponent(VendorPanel);fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.storage-grid .vendor-slot').length).toBe(15);
    expect(fixture.componentInstance.slots.length).toBe(10);
    expect(fixture.nativeElement.textContent).toContain('15 slots');
  });
});
