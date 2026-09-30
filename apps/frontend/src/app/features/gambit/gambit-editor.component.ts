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
 addLine(){const p=this.page();if(!p||p.lines.length>=20)return;p.lines=[...p.lines,{priority:p.lines.length+1,conditions:[{id:'always'}],action:{id:'attack'},enabled:true}];this.pages.set([...this.pages()])}
 remove(i:number){const p=this.page();if(!p)return;p.lines=p.lines.filter((_,n)=>n!==i).map((x,n)=>({...x,priority:n+1}));this.pages.set([...this.pages()])}
 reorder(e:CdkDragDrop<GambitLine[]>){const p=this.page();if(!p)return;moveItemInArray(p.lines,e.previousIndex,e.currentIndex);p.lines=p.lines.map((x,n)=>({...x,priority:n+1}));this.pages.set([...this.pages()])}
 updateLine(i:number,key:string,value:any){const p=this.page();if(!p)return;(p.lines[i] as any)[key]=value;this.pages.set([...this.pages()])}
 conditionOptions(){return this.catalog.gambits().conditions} actionOptions(){return this.catalog.gambits().actions} paramSpecs(node:any,kind:'condition'|'action'){const options=kind==='condition'?this.conditionOptions():this.actionOptions();return options.find(x=>x.id===node?.id)?.params??[]} paramValue(node:any,name:string){return node?.params?.[name]??node?.[name]??''} setParam(node:any,name:string,value:any){node.params={...(node.params??{}),[name]:value};this.pages.set([...this.pages()])} changeCondition(line:GambitLine,index:number,id:string){line.conditions[0]={id,params:{}};this.pages.set([...this.pages()])} changeAction(line:GambitLine,id:string){line.action={id,params:{}};this.pages.set([...this.pages()])} paramLabel(name:string){return name.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase())} itemOptions(){return this.catalog.items().filter(x=>x.id)} skillOptions(){return this.catalog.skills().filter(x=>x.id)} valueForInput(spec:any,value:any){return spec.type==='number'?Number(value??0):value}
 normalizeLegacyLines(){for(const p of this.pages()){for(const line of p.lines){line.conditions=[line.conditions?.[0]??{id:'always'}];delete (line as any).combinator;for(const condition of line.conditions){const legacyValue=condition['value'];if(condition.id==='self_hp_below_percent'&&condition.params===undefined&&legacyValue!==undefined){condition.params={value:legacyValue};delete condition['value']}}for(const node of [line.action]){if(node?.params===undefined){const specs=this.paramSpecs(node,'action');const params:any={};for(const spec of specs)if(node[spec.name]!==undefined)params[spec.name]=node[spec.name];if(Object.keys(params).length){node.params=params;for(const spec of specs)delete node[spec.name]}}}}}this.pages.set([...this.pages()])}
 async save(){const p=this.page();if(!p)return;this.normalizeLegacyLines();this.saving.set(true);this.error.set(null);this.validation.set([]);try{await this.api.put('/gambits/'+p.id,{title:p.title,lines:p.lines}).toPromise()}catch(e:any){this.validation.set(e?.error?.fieldErrors??[]);this.error.set(e?.error?.message?.join?.('\n')??e?.error?.message??'Gambit validation rejected')}finally{this.saving.set(false)}}
 async activate(){const p=this.page();if(!p)return;try{await this.api.put('/gambits/'+p.id+'/activate',{}).toPromise();this.character.applyPatch({activeGambitPageId:p.id})}catch(e:any){this.error.set(e?.error?.message??'Page activation rejected')}}
 conditionLabel(id:string){return this.conditionOptions().find(x=>x.id===id)?.label??id} actionLabel(id:string){return this.actionOptions().find(x=>x.id===id)?.label??id}
}
