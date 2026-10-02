import { Injectable, computed, signal } from '@angular/core';
export type SheetDetent='peek'|'half'|'full';
@Injectable({providedIn:'root'})
export class UiPrefsStore {
 readonly grind=signal<SheetDetent>(this.read('nanommo:sheet-detent-grind','half')); readonly town=signal<SheetDetent>(this.read('nanommo:sheet-detent-town','full'));
 readonly active=computed(()=>this.contextValue()==='town'?this.town():this.grind()); private readonly contextValue=signal<'grind'|'town'>('grind'); readonly context=()=>this.contextValue();
 setContext(c:'grind'|'town'){this.contextValue.set(c)}
 setDetent(d:SheetDetent){const c=this.context();(c==='town'?this.town:this.grind).set(d);localStorage.setItem(c==='town'?'nanommo:sheet-detent-town':'nanommo:sheet-detent-grind',d)}
 private read(key:string,fallback:SheetDetent):SheetDetent{const v=localStorage.getItem(key);return v==='peek'||v==='half'||v==='full'?v:fallback}
}
