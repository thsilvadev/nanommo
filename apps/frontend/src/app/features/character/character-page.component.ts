import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, inject, signal, effect } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CdkDrag, CdkDropList, CdkDragDrop, CdkDragStart } from '@angular/cdk/drag-drop';
import { Router } from '@angular/router';
import { BattleStore, CharacterStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { ApiService } from '../../core/api.service';
import { GambitEditorComponent } from '../gambit/gambit-editor.component';
import { InventoryGrid } from '../play/components';

@Component({selector:'app-character-page',standalone:true,imports:[CommonModule,GambitEditorComponent,InventoryGrid,CdkDrag,CdkDropList],templateUrl:'./character-page.component.html',styleUrl:'./character-page.component.css',styles:[`.skill-tree{display:flex;flex-direction:column;align-items:center;gap:28px;padding:22px 8px}.skill-node{position:relative;display:flex;flex-direction:column;align-items:center;gap:7px;min-width:150px;text-align:center;padding:12px;border-radius:8px;border:1px solid #4b5563;background:#111827}.skill-node:not(:first-child)::before{content:'';position:absolute;bottom:100%;height:29px;width:2px;background:#64748b}.skill-icon{width:72px;height:72px;padding:3px;border:2px solid #64748b;border-radius:8px;background:#0b1220;display:grid;place-items:center;cursor:pointer}.skill-icon img{width:64px;height:64px;object-fit:contain}.skill-node.unlocked .skill-icon{border-color:#d4a84f}.skill-node.pending .skill-icon{border-color:#4ade80;box-shadow:0 0 0 2px #14532d}.skill-node.locked .skill-icon{filter:grayscale(1);opacity:.65}.skill-node .pending-rank{color:#4ade80}.skill-node .mastery-tooltip{display:none;position:absolute;z-index:30;top:80px;left:50%;transform:translateX(-50%);min-width:210px;max-width:280px;white-space:normal;text-align:left}.skill-node:hover .mastery-tooltip,.skill-node:focus-within .mastery-tooltip{display:flex}.mastery-actions{justify-content:center;gap:10px}`]})
export class CharacterPageComponent implements OnInit {
 readonly character=inject(CharacterStore);readonly inventory=inject(InventoryStore);readonly battle=inject(BattleStore);readonly catalog=inject(CatalogService);readonly api=inject(ApiService);private readonly router=inject(Router);private readonly route=inject(ActivatedRoute);readonly equipmentTargetIds=['character-page-slot-head','character-page-slot-body','character-page-slot-mainHand','character-page-slot-offHand','character-page-slot-shoes','character-page-slot-cape','character-page-slot-accessoryLeft','character-page-slot-accessoryRight'];
 @Input() tab='character';weaponLevels=signal<Record<string,number>>({});masteryRows=signal<Record<string,any>>({});selectedWeapon=signal('sword');pending=signal<Record<string,number>>({});pendingMastery=signal<Record<string,Record<string,number>>>({});saving=signal(false);error=signal<string|null>(null);selectedItem=signal<any|null>(null);
 attrs=[['str','STR'],['agi','AGI'],['dex','DEX'],['vit','VIT'],['int','INT'],['sor','SOR']];
 slots=[['head','Head','helmet'],['body','Body','armor'],['mainHand','Main Hand','sword'],['offHand','Off Hand','shield'],['shoes','Shoes','boots'],['cape','Cape','cape'],['accessoryLeft','Accessory L','ring'],['accessoryRight','Accessory R','ring']];
 constructor(){void this.catalog.load();void this.inventory.load();effect(()=>{if(this.battle.lastResolved())void this.loadWeaponLevels()})}
 ngOnInit(){this.route.queryParamMap.subscribe(q=>{const t=q.get('tab') || this.route.snapshot.data['defaultTab'];if(t==='gambits'||t==='mastery'||t==='character')this.tab=t;});void this.loadWeaponLevels();}
 async loadWeaponLevels(){try{const rows=await this.api.get<Array<{weaponType:string;level:number}>>('/characters/weapon-proficiency').toPromise();this.weaponLevels.set(Object.fromEntries((rows??[]).map(r=>[r.weaponType,r.level])));this.masteryRows.set(Object.fromEntries((rows??[]).map((r:any)=>[r.weaponType,r])))}catch{this.weaponLevels.set({})}}
 weaponRows(){return [['sword','Sword'],['greatsword','Greatsword'],['dagger','Dagger'],['bow','Bow'],['staff','Staff'],['rod','Rod'],['shield','Shield'],['rune','Rune']]}
 skillIcon(skill:any){return '/assets/ui/skill-icons/'+skill.id+'.svg'}
 masterySkills(){return this.catalog.skills().filter((s:any)=>s.category===this.selectedWeapon()&&!s.hidden&&!s.deprecated)}
 persistedSkillRank(skill:any){return Number(this.masteryRows()[this.selectedWeapon()]?.skillRanks?.[skill.id]??0)}
 skillRank(skill:any){return Number(this.draftRanks()[skill.id]??0)}
 draftRanks(){const saved=this.masteryRows()[this.selectedWeapon()]?.skillRanks??{};const draft=this.pendingMastery()[this.selectedWeapon()]??{};const ids=new Set(this.masterySkills().map((skill:any)=>skill.id));return Object.fromEntries([...Object.entries(saved),...Object.entries(draft)].filter(([id])=>ids.has(id)))}
 draftPoints(){return Object.values(this.draftRanks()).reduce<number>((sum,rank)=>sum+Number(rank||0),0)}
 canAllocate(skill:any){const row=this.masteryRows()[this.selectedWeapon()]??{};const skills=this.masterySkills();const first=skills.find((s:any)=>s.node===1)??skills[0];return this.draftPoints()<Number(row.level??0)&&this.skillRank(skill)<Number(skill.maxRank??5)&&(!skill.prerequisite||this.skillRank(skills.find((s:any)=>s.id===skill.prerequisite.skillId)??{})>=skill.prerequisite.rank)&&(!skill.node||skill.node===1||this.skillRank(first)>=5)}
 stageMastery(skill:any){if(!this.canAllocate(skill)||this.saving())return;const category=this.selectedWeapon();const draft={...(this.pendingMastery()[category]??{})};draft[skill.id]=this.skillRank(skill)+1;this.pendingMastery.set({...this.pendingMastery(),[category]:draft});}
 resetMasteryDraft(){this.pendingMastery.set({...this.pendingMastery(),[this.selectedWeapon()]:{}});this.error.set(null)}
 hasMasteryDraft(){return Object.keys(this.pendingMastery()[this.selectedWeapon()]??{}).length>0}
 async applyMastery(){if(!this.hasMasteryDraft())return;this.saving.set(true);this.error.set(null);try{const category=this.selectedWeapon();const row=await this.api.post<any>('/characters/mastery/apply',{category,targetRanks:this.draftRanks()}).toPromise();this.masteryRows.set({...this.masteryRows(),[row.category]:row});this.weaponLevels.set({...this.weaponLevels(),[row.category]:row.level});this.pendingMastery.set({...this.pendingMastery(),[category]:{}})}catch(e:any){this.error.set(e?.error?.message??'Mastery allocation rejected by server')}finally{this.saving.set(false)}}
 selectWeapon(type:string){this.selectedWeapon.set(type);void this.loadWeaponLevels()}
 selectedWeaponIndex(){const i=this.weaponRows().findIndex(r=>r[0]===this.selectedWeapon());return i<0?0:i}
 setTab(t:string){this.tab=t;if(t==='gambits')this.router.navigate(['/play/character'],{queryParams:{tab:'gambits'}});else this.router.navigate(['/play/character'],{queryParams:{tab:t}})}
 value(k:string){const c=this.character.character() as any;return (c?.[k]??0)+(this.pending()[k]??0)}
 moveSpeed(){const level=Number(this.character.character()?.level??0);return level>0?50+level:'—'}
 attributeBonus(k:string){const c=this.character.character() as any;const key=k.toUpperCase();return Number(c?.attributeBonuses?.[key]??0)}
 attributeTooltip(k:string){const tips:Record<string,string>={str:'STR increases Physical ATK.',agi:'AGI increases Attack Speed and Evasion.',dex:'DEX increases Accuracy and Cast Speed.',vit:'VIT increases Max HP and HP Regen.',int:'INT increases Max SP, SP Regen and Magic ATK.',sor:'SOR increases Critical Chance.'};return tips[k]??''}
 delta(k:string){return this.pending()[k]??0}
 change(k:string,n:number){const points=Object.values(this.pending()).reduce((a,b)=>a+b,0);if(n>0&&(this.character.character()?.unspentAttributePoints??0)-points<=0)return;const next={...this.pending(),[k]:(this.pending()[k]??0)+n};if(next[k]===0)delete next[k];this.pending.set(next)}
 reset(){this.pending.set({});this.error.set(null)}
 async apply(){if(!Object.keys(this.pending()).length)return;this.saving.set(true);this.error.set(null);try{await this.character.spend(this.pending());this.pending.set({})}catch(e:any){this.pending.set({});this.error.set(e?.error?.message??'Allocation rejected by server')}finally{this.saving.set(false)}}
 pendingPoints(){return Object.values(this.pending()).reduce((a,b)=>a+b,0)}
 hasPending(){return Object.keys(this.pending()).length>0}
 item(slot:string){return this.inventory.equipment().find(e=>e.slot===slot)} icon(kind:string){return '/assets/ui/'+kind+'.svg'}
 onDragStart(e:CdkDragStart<any>){const it=e.source.data;if(it?.itemId)this.inventory.beginDrag(it.itemId)}
 onDragEnd(){this.inventory.endDrag()}
 equipmentDragData(slot:string,it:any){return {source:'equipment',slot,id:it.id,characterId:it.characterId,itemId:it.itemId,instanceData:it.instanceData}}
 inventoryDragData(it:any){return {source:'inventory',id:it.id,characterId:it.characterId,itemId:it.itemId,quantity:it.quantity,instanceData:it.instanceData}}
 async drop(slot:string,e:CdkDragDrop<any>){const it=e.item.data;if(!it)return;try{if(it.source!=='equipment')await this.inventory.equip(slot,it.itemId);this.selectedItem.set(it)}catch(err:any){this.error.set(err?.error?.message??'Equipment change rejected by server')}finally{this.inventory.endDrag()}}
 async doubleClickInventory(it:any){const def:any=this.catalog.item(it.itemId);if(def?.type==='equipment'&&def.slot){const slot=def.slot==='accessory'?(this.inventory.equipment().some(e=>e.slot==='accessoryLeft')?'accessoryRight':'accessoryLeft'):def.slot;try{await this.inventory.equip(slot,it.itemId)}catch(err:any){this.error.set(err?.error?.message??'Equipment change rejected by server')}}}
 async doubleClickEquipped(slot:string){try{await this.inventory.unequip(slot)}catch(err:any){this.error.set(err?.error?.message??'Unequip rejected by server')}}
 async dropToInventory(e:CdkDragDrop<any>){const it=e.item.data;if(it?.source==='equipment')await this.doubleClickEquipped(it.slot);}
}
