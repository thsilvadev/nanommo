import { CommonModule } from '@angular/common';
import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { CharacterStore } from '../../core/game.store';
import { GambitPage } from '../../core/game.models';
import { MapBoard, InventoryGrid } from './components';
@Component({selector:'app-grind',standalone:true,imports:[CommonModule,MapBoard,InventoryGrid],templateUrl:'./grind.component.html',styleUrl:'./grind.component.css'})
export class GrindComponent implements OnInit {
  readonly api=inject(ApiService);
  readonly character=inject(CharacterStore);
  readonly gambits=signal<GambitPage[]>([]);
  readonly loading=signal(false);
  readonly error=signal<string|null>(null);
  readonly huntMode=signal<'hunting'|'defensive'|'fleeing'>('hunting');
  
  readonly activeGambitId=computed(()=>{
    const activeId=this.character.character()?.activeGambitPageId;
    return activeId||'';
  });

  ngOnInit(){void this.loadGambits();}

  async loadGambits(){
    try{
      const pages=await this.api.get<GambitPage[]>('/gambits').toPromise()??[];
      this.gambits.set(pages);
      const activeId=this.character.character()?.activeGambitPageId;
      const isValid=activeId&&pages.some(p=>p.id===activeId);
      if(!isValid&&pages.length>0){
        const defaultPage=pages.find(p=>p.slotIndex===0);
        if(defaultPage){
          await this.selectGambit(defaultPage.id);
        }
      }
    }catch{
      this.error.set('Unable to load Gambits');
    }
  }

  async selectGambit(pageId:string){
    const previous=this.character.character()?.activeGambitPageId;
    if(!pageId||pageId===previous)return;
    this.loading.set(true);
    this.error.set(null);
    try{
      await this.api.put('/gambits/'+pageId+'/activate',{}).toPromise();
      this.character.applyPatch({activeGambitPageId:pageId});
    }catch(e:any){
      this.error.set(e?.error?.message??'Unable to activate Gambit');
    }finally{
      this.loading.set(false);
    }
  }
}
