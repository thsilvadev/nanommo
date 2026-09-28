import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CdkDrag, CdkDropList, CdkDragDrop } from '@angular/cdk/drag-drop';
import { Router } from '@angular/router';
import { CharacterStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { ApiService } from '../../core/api.service';
import { GambitEditorComponent } from '../gambit/gambit-editor.component';

@Component({selector:'app-character-page',standalone:true,imports:[CommonModule,GambitEditorComponent,CdkDrag,CdkDropList],templateUrl:'./character-page.component.html',styleUrl:'./character-page.component.css'})
export class CharacterPageComponent implements OnInit {
 readonly character=inject(CharacterStore);readonly inventory=inject(InventoryStore);readonly catalog=inject(CatalogService);readonly api=inject(ApiService);private readonly router=inject(Router);private readonly route=inject(ActivatedRoute);
 @Input() tab='character';pending=signal<Record<string,number>>({});saving=signal(false);error=signal<string|null>(null);selectedItem=signal<any|null>(null);
 attrs=[['str','STR'],['agi','AGI'],['dex','DEX'],['vit','VIT'],['int','INT'],['sor','SOR']];
 slots=[['head','Head','helmet'],['body','Body','armor'],['mainHand','Main Hand','sword'],['offHand','Off Hand','shield'],['shoes','Shoes','boots'],['cape','Cape','cape'],['accessoryLeft','Accessory L','ring'],['accessoryRight','Accessory R','ring']];
 constructor(){void this.catalog.load();void this.inventory.load();}
 ngOnInit(){this.route.queryParamMap.subscribe(q=>{const t=q.get('tab') || this.route.snapshot.data['defaultTab'];if(t==='gambits'||t==='equipment'||t==='character')this.tab=t;});}
 setTab(t:string){this.tab=t;if(t==='gambits')this.router.navigate(['/play/character'],{queryParams:{tab:'gambits'}});else this.router.navigate(['/play/character'],{queryParams:{tab:t}})}
 value(k:string){const c=this.character.character() as any;return (c?.[k]??0)+(this.pending()[k]??0)}
 delta(k:string){return this.pending()[k]??0}
 change(k:string,n:number){const points=Object.values(this.pending()).reduce((a,b)=>a+b,0);if(n>0&&(this.character.character()?.unspentAttributePoints??0)-points<=0)return;const next={...this.pending(),[k]:(this.pending()[k]??0)+n};if(next[k]===0)delete next[k];this.pending.set(next)}
 reset(){this.pending.set({});this.error.set(null)}
 async apply(){if(!Object.keys(this.pending()).length)return;this.saving.set(true);this.error.set(null);try{await this.character.spend(this.pending());this.pending.set({})}catch(e:any){this.pending.set({});this.error.set(e?.error?.message??'Allocation rejected by server')}finally{this.saving.set(false)}}
 pendingPoints(){return Object.values(this.pending()).reduce((a,b)=>a+b,0)}
 hasPending(){return Object.keys(this.pending()).length>0}
 item(slot:string){return this.inventory.equipment().find(e=>e.slot===slot)} icon(kind:string){return '/assets/ui/'+kind+'.svg'}
 async drop(slot:string,e:CdkDragDrop<any>){const it=e.item.data;if(!it)return;try{await this.inventory.equip(slot,it.itemId);this.selectedItem.set(it)}catch(err:any){this.error.set(err?.error?.message??'Equipment change rejected by server')}}
 async unequip(slot:string){try{await this.inventory.unequip(slot)}catch(err:any){this.error.set(err?.error?.message??'Unequip rejected by server')}}
}
