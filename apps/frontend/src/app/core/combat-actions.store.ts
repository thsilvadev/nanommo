import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { GameSocketService } from './game.socket.service';

export type CombatActionKind='equip'|'unequip'|'use_item'|'attributes'|'gambit_update'|'gambit_activate';
export interface CombatActionTarget {
  slot?:string; slots?:string[]; itemId?:string; inventoryItemId?:string; pageId?:string;
  attributes?:Record<string,number>; draft?:{title?:string;lines?:any[]};
}
export interface CombatAction {
  id:string;clientRequestId?:string;kind:CombatActionKind;target?:CombatActionTarget;
  status:'pending'|'applied'|'failed'|'cancelled';message?:string;result?:{message?:string};
}
export interface ActionFeedback {
  id:string;clientRequestId:string;kind:CombatActionKind;target:CombatActionTarget;
  phase:'sending'|'queued'|'confirming'|'failed';message?:string;local:boolean;
}
const equipment=(kind:string)=>kind==='equip'||kind==='unequip';
const slots=(target:CombatActionTarget)=>target.slots??(target.slot?[target.slot]:[]);
function overlaps(a:{kind:string;target:CombatActionTarget},b:{kind:string;target:CombatActionTarget}):boolean {
  if(equipment(a.kind)&&equipment(b.kind))return slots(a.target).some(slot=>slots(b.target).includes(slot));
  if(a.kind!==b.kind)return false;
  if(a.kind==='gambit_activate')return true;
  if(a.kind==='use_item')return a.target.itemId===b.target.itemId;
  if(a.kind.startsWith('gambit_'))return a.target.pageId===b.target.pageId;
  return a.kind==='attributes';
}

/** Lifecycle of server-owned commands; no Character/PartyStore dependency cycle. */
@Injectable({providedIn:'root'})
export class CombatActionsStore {
  private readonly api=inject(ApiService);
  private readonly zone=inject(NgZone);
  private readonly rows=signal<ActionFeedback[]>([]);
  readonly feedback=this.rows.asReadonly();
  private readonly server=signal<CombatAction[]>([]);
  readonly serverActions=this.server.asReadonly();
  private readonly terminals=new Map<string,CombatAction>();
  private readonly requests=new Map<string,(id:string)=>Promise<any>>();
  private readonly inFlight=new Set<string>();
  private subscriptions:Subscription[]=[];
  private synchronizer:(()=>Promise<void>)|null=null;
  private timer:ReturnType<typeof setInterval>|null=null;
  private generation=0;
  private refreshSequence=0;
  private recovering=false;
  private disconnected=false;
  private readonly visibility=()=>{if(!document.hidden)void this.recover();};

  setSynchronizer(sync:()=>Promise<void>):void {this.synchronizer=sync;}
  start(socket:GameSocketService,sync:()=>Promise<void>):void {
    if(this.timer)return;
    this.synchronizer=sync;
    this.subscriptions.push(socket.on('party:actionUpdated').subscribe({next:()=>{void this.refresh();}}));
    this.subscriptions.push(socket.onConnectionState().subscribe(state=>{
      this.disconnected=state!=='connected';
      if(this.disconnected)this.markConfirming();else void this.recover();
    }));
    this.timer=this.zone.runOutsideAngular(()=>setInterval(()=>{
      if(!document.hidden&&this.rows().some(row=>row.phase!=='failed'))void this.recover();
    },5000));
    document.addEventListener('visibilitychange',this.visibility);
    void this.recover();
  }
  stop():void {
    ++this.generation;++this.refreshSequence;
    this.subscriptions.forEach(subscription=>subscription.unsubscribe());this.subscriptions=[];
    if(this.timer)clearInterval(this.timer);this.timer=null;
    document.removeEventListener('visibilitychange',this.visibility);
    this.rows.set([]);this.server.set([]);this.requests.clear();this.inFlight.clear();this.terminals.clear();
    this.synchronizer=null;this.disconnected=false;this.recovering=false;
  }
  busy(kind:CombatActionKind,target:CombatActionTarget):boolean {return this.rows().some(row=>row.phase!=='failed'&&overlaps(row,{kind,target}));}
  item(itemId:string,inventoryItemId?:string):ActionFeedback|null {
    return this.rows().find(row=>row.target.itemId===itemId&&(!row.target.inventoryItemId||row.target.inventoryItemId===inventoryItemId))??null;
  }
  slot(slot:string):ActionFeedback|null {return this.rows().find(row=>equipment(row.kind)&&slots(row.target).includes(slot))??null;}
  page(pageId:string,kind?:CombatActionKind):ActionFeedback|null {return this.rows().find(row=>row.target.pageId===pageId&&(!kind||row.kind===kind))??null;}
  attributes():ActionFeedback|null {return this.rows().find(row=>row.kind==='attributes')??null;}
  isItemBusy(itemId:string,inventoryItemId?:string):boolean {const row=this.item(itemId,inventoryItemId);return !!row&&row.phase!=='failed';}
  isSlotBusy(slot:string):boolean {const row=this.slot(slot);return !!row&&row.phase!=='failed';}
  private update(requestId:string,patch:Partial<ActionFeedback>):void {this.rows.update(rows=>rows.map(row=>row.clientRequestId===requestId?{...row,...patch}:row));}
  private remove(requestId:string):void {this.rows.update(rows=>rows.filter(row=>row.clientRequestId!==requestId));}
  private markConfirming():void {this.rows.update(rows=>rows.map(row=>row.phase==='failed'?row:{...row,phase:'confirming'}));}
  private message(error:any):string {const message=error?.error?.message??error?.message??'Change rejected';return Array.isArray(message)?message.join('\n'):String(message);}

  async run<T>(kind:CombatActionKind,target:CombatActionTarget,request:(id:string)=>Promise<T>):Promise<T> {
    if(this.busy(kind,target))throw new Error('This change is already queued');
    const requestId=crypto.randomUUID(),generation=this.generation;
    this.rows.update(rows=>[...rows.filter(row=>!overlaps(row,{kind,target})),{id:requestId,clientRequestId:requestId,kind,target,phase:'sending',local:true}]);
    this.requests.set(requestId,request);
    return this.submit(requestId,request,generation);
  }
  private async submit<T>(requestId:string,request:(id:string)=>Promise<T>,generation:number):Promise<T> {
    this.inFlight.add(requestId);
    try {
      const response:any=await request(requestId);
      if(generation!==this.generation)return response;
      const intent:CombatAction|undefined=response?.intent;
      const terminal=intent&&(this.terminals.get(intent.id)??this.terminals.get(requestId));
      if(terminal){this.requests.delete(requestId);if(terminal.status!=='applied')throw Object.assign(new Error(terminal.result?.message??'Change rejected'),{status:400});return response;}
      if(!intent||intent.status==='applied'){if(intent){const terminal={...intent,clientRequestId:requestId};this.terminals.set(intent.id,terminal);this.terminals.set(requestId,terminal);}this.remove(requestId);this.requests.delete(requestId);}
      else if(intent.status==='pending'){
        this.update(requestId,{id:intent.id??requestId,...(intent.target?{target:intent.target}:{}),phase:this.disconnected?'confirming':'queued'});this.requests.delete(requestId);
      }else{
        throw Object.assign(new Error(intent.result?.message??'Change rejected'),{status:400});
      }
      return response;
    }catch(error:any){
      if(generation===this.generation){
        const uncertain=error?.status===0||Number(error?.status)>=500;
        this.update(requestId,{phase:uncertain?'confirming':'failed',message:uncertain?undefined:this.message(error)});
        if(!uncertain)this.requests.delete(requestId);
      }
      if(error?.status===0||Number(error?.status)>=500)throw Object.assign(error,{combatActionUncertain:true});
      throw error;
    }finally{this.inFlight.delete(requestId);}
  }
  /** Consume the same authoritative terminal notification already read by a panel. */
  acknowledge(action:Pick<CombatAction,'id'|'status'|'clientRequestId'|'result'> & {message?:string}):void {
    if(action.status==='pending'||this.terminals.has(action.id))return;
    const row=this.rows().find(row=>row.id===action.id||(action.clientRequestId&&row.clientRequestId===action.clientRequestId));
    if(!row)return;
    const terminal:CombatAction={...action,kind:row.kind,target:row.target};
    this.terminals.set(action.id,terminal);this.terminals.set(row.clientRequestId,terminal);this.requests.delete(row.clientRequestId);
    if(action.status!=='applied'){
      this.update(row.clientRequestId,{phase:'failed',message:action.result?.message??action.message??(action.status==='cancelled'?'Change cancelled':'Change rejected')});
    }else if(!this.synchronizer)this.remove(row.clientRequestId);
    else{
      this.update(row.clientRequestId,{phase:'confirming'});
      const generation=this.generation;
      void this.synchronizer().then(()=>{if(generation===this.generation)this.remove(row.clientRequestId);}).catch(()=>{/* A subsequent authoritative refresh retries confirmation. */});
    }
  }
  async refresh():Promise<void> {
    const sequence=++this.refreshSequence,generation=this.generation;
    try {
      const actions=await firstValueFrom(this.api.get<CombatAction[]>('/party/actions'));
      if(sequence!==this.refreshSequence||generation!==this.generation||!Array.isArray(actions))return;
      const confirmed:ActionFeedback[]=[];
      for(const action of actions){
        const existing=this.rows().find(row=>row.id===action.id||(action.clientRequestId&&row.clientRequestId===action.clientRequestId));
        if(action.status==='pending'){
          if(this.terminals.has(action.id))continue;
          if(existing){this.update(existing.clientRequestId,{id:action.id,target:action.target??existing.target,phase:this.disconnected?'confirming':'queued'});this.requests.delete(existing.clientRequestId);}
          else if(action.target)this.rows.update(rows=>[...rows,{id:action.id,clientRequestId:action.clientRequestId??action.id,kind:action.kind,target:action.target!,phase:this.disconnected?'confirming':'queued',local:false}]);
        }else{
          this.terminals.set(action.id,action);if(action.clientRequestId)this.terminals.set(action.clientRequestId,action);
          if(existing){
            this.requests.delete(existing.clientRequestId);
            if(action.status==='applied'){this.update(existing.clientRequestId,{phase:'confirming'});confirmed.push(existing);}
            else this.update(existing.clientRequestId,{phase:'failed',message:action.result?.message??'Change rejected'});
          }
        }
      }
      this.server.set(actions);
      if(confirmed.length){
        await this.synchronizer?.();
        if(generation!==this.generation)return;
        confirmed.forEach(row=>this.remove(row.clientRequestId));
      }
      // A missing row is never treated as success or rejection.
      if(this.terminals.size>256){for(const key of [...this.terminals.keys()].slice(0,this.terminals.size-256))this.terminals.delete(key);}
    }catch{if(generation===this.generation)this.markConfirming();}
  }
  async recover():Promise<void> {
    if(this.recovering)return;
    this.recovering=true;
    const generation=this.generation;
    try {
      await this.refresh();
      if(generation!==this.generation)return;
      for(const [id,request] of this.requests){
        if(!this.inFlight.has(id)&&this.rows().some(row=>row.clientRequestId===id&&row.phase==='confirming')){
          try{await this.submit(id,request,generation);}catch{/* Keep the authoritative/uncertain state, never duplicate the request ID. */}
        }
      }
    }finally{if(generation===this.generation)this.recovering=false;}
  }
}
