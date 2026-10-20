import { CommonModule } from '@angular/common';
import { Component, inject, signal, computed, OnInit, effect } from '@angular/core';
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
  readonly huntMode=signal<'hunting'|'gathering'>('hunting');
  
  readonly activeGambitId=computed(()=>{
    const activeId=this.character.character()?.activeGambitPageId;
    const gambitList=this.gambits();
    if(!activeId||gambitList.length===0)return'';
    const found=gambitList.find(g=>g.id===activeId);
    return found?activeId:'';
  });

  constructor(){effect(()=>{const stance=this.character.character()?.lastGrindStance;if(stance==='hunting'||stance==='gathering')this.huntMode.set(stance);});}

  ngOnInit(){void this.loadGambits();}

  async selectStance(stance:'hunting'|'gathering'){
    if(this.loading()||this.huntMode()===stance)return;
    this.loading.set(true);this.error.set(null);
    try{const response=await this.api.post<any>('/maps/stance',{stance}).toPromise();this.huntMode.set(stance);if(response?.character)this.character.applyPatch(response.character);else this.character.applyPatch({lastGrindStance:stance});}
    catch(e:any){this.error.set(e?.error?.message??'Unable to change stance');}
    finally{this.loading.set(false);}
  }

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
