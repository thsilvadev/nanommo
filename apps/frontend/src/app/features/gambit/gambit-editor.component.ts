import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, inject, signal } from '@angular/core';
import { CdkDrag, CdkDropList, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ApiService } from '../../core/api.service';
import { CharacterStore } from '../../core/game.store';
import { GambitLine, GambitPage } from '../../core/game.models';
import { CatalogService } from '../../core/catalog.service';

@Component({selector:'app-gambit-editor',standalone:true,imports:[CommonModule,FormsModule,CdkDrag,CdkDropList],templateUrl:'./gambit-editor.component.html',styleUrl:'./gambit-editor.component.css'})
export class GambitEditorComponent {
 readonly api=inject(ApiService);readonly character=inject(CharacterStore);readonly catalog=inject(CatalogService);
 pages=signal<GambitPage[]>([]);active=signal(0);saving=signal(false);validation=signal<any[]>([]);error=signal<string|null>(null);
 constructor(){void this.load();}
 async load(){try{const p=await this.api.get<GambitPage[]>('/gambits').toPromise();this.pages.set(p??[]);const c=this.character.character();const i=(p??[]).findIndex(x=>x.id===c?.activeGambitPageId);this.active.set(i>=0?i:0);await this.catalog.load()}catch(e:any){this.error.set(e?.error?.message??'Unable to load Gambits')}}
 page(){return this.pages()[this.active()]??null}
 lines(){return this.page()?.lines??[]}
 addLine(){const p=this.page();if(!p||p.lines.length>=20)return;p.lines=[...p.lines,{priority:p.lines.length+1,conditions:[{id:'always'}],combinator:null,action:{id:'attack'},enabled:true}];this.pages.set([...this.pages()])}
 remove(i:number){const p=this.page();if(!p)return;p.lines=p.lines.filter((_,n)=>n!==i).map((x,n)=>({...x,priority:n+1}));this.pages.set([...this.pages()])}
 reorder(e:CdkDragDrop<GambitLine[]>){const p=this.page();if(!p)return;moveItemInArray(p.lines,e.previousIndex,e.currentIndex);p.lines=p.lines.map((x,n)=>({...x,priority:n+1}));this.pages.set([...this.pages()])}
 updateLine(i:number,key:string,value:any){const p=this.page();if(!p)return;(p.lines[i] as any)[key]=value;this.pages.set([...this.pages()])}
 conditionOptions(){return this.catalog.gambits().conditions} actionOptions(){return this.catalog.gambits().actions}
 async save(){const p=this.page();if(!p)return;this.saving.set(true);this.error.set(null);this.validation.set([]);try{await this.api.put('/gambits/'+p.id,{title:p.title,lines:p.lines}).toPromise()}catch(e:any){this.validation.set(e?.error?.fieldErrors??[]);this.error.set(e?.error?.message?.join?.('\n')??e?.error?.message??'Gambit validation rejected')}finally{this.saving.set(false)}}
 async activate(){const p=this.page();if(!p)return;try{await this.api.put('/gambits/'+p.id+'/activate',{}).toPromise();this.character.applyPatch({activeGambitPageId:p.id})}catch(e:any){this.error.set(e?.error?.message??'Page activation rejected')}}
 conditionLabel(id:string){return this.conditionOptions().find(x=>x.id===id)?.label??id} actionLabel(id:string){return this.actionOptions().find(x=>x.id===id)?.label??id}
}
