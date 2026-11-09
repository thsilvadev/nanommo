import { CommonModule } from '@angular/common';
import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { CharacterStore } from '../../core/game.store';
import { GambitPage } from '../../core/game.models';
import { MapBoard, InventoryGrid } from './components';
import { IdleChatComponent } from './idle-chat.component';
import { TooltipPositionDirective } from './tooltip-position.directive';
import { LocaleService } from '../../core/locale.service';
@Component({selector:'app-grind',standalone:true,imports:[CommonModule,MapBoard,InventoryGrid,IdleChatComponent,TooltipPositionDirective],templateUrl:'./grind.component.html',styleUrl:'./grind.component.css',styles:[`.nm-floating-tooltip.stance-tooltip{width:min(310px,calc(100vw - 20px));min-width:210px;max-width:calc(100vw - 20px);padding:12px 14px;background:linear-gradient(145deg,#21170f,#100b07);border-color:#a98750;box-shadow:0 8px 24px #000d,inset 0 0 0 1px #4b3521;display:flex;flex-direction:column;gap:7px}.nm-floating-tooltip.stance-tooltip strong{color:#f0d9ac;font:bold 18px/1.15 Georgia,serif;letter-spacing:.3px}.nm-floating-tooltip.stance-tooltip span{color:#d0bea0;font:13px/1.45 Arial,sans-serif}`]})
export class GrindComponent implements OnInit {
  readonly api=inject(ApiService);
  readonly locale=inject(LocaleService);
  readonly character=inject(CharacterStore);
  readonly gambits=signal<GambitPage[]>([]);
  readonly loading=signal(false);
  readonly error=signal<string|null>(null);
  readonly huntMode=computed<'hunting'|'gathering'|null>(()=>{const stance=this.character.character()?.lastGrindStance;return stance==='hunting'||stance==='gathering'?stance:null;});
  
  readonly activeGambitId=computed(()=>{
    const activeId=this.character.character()?.activeGambitPageId;
    const gambitList=this.gambits();
    if(!activeId||gambitList.length===0)return'';
    const found=gambitList.find(g=>g.id===activeId);
    return found?activeId:'';
  });

  ngOnInit(){
    // The mode is derived directly from the CharacterStore, never mirrored in local UI state.
    // PlayComponent owns the initial Character load; this component only reacts to store updates.
    void this.loadGambits();
  }

  async selectStance(stance:'hunting'|'gathering'){
    if(this.loading()||!this.huntMode()||this.huntMode()===stance)return;
    this.loading.set(true);this.error.set(null);
    try{const response=await this.api.post<any>('/maps/stance',{stance}).toPromise();this.character.applyConfirmedStance(stance,response?.character);}
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
