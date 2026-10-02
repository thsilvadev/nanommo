import { Injectable, OnDestroy, signal } from '@angular/core';
@Injectable({providedIn:'root'})
export class TickerService implements OnDestroy {
 readonly now=signal(Date.now());
 private id:number|null=null;
 private readonly onVisibilityChange=()=>{if(document.hidden)this.stop();else this.start()};
 constructor(){document.addEventListener('visibilitychange',this.onVisibilityChange);if(!document.hidden)this.start()}
 private start(){if(this.id!==null)return;this.now.set(Date.now());this.id=window.setInterval(()=>this.now.set(Date.now()),250)}
 private stop(){if(this.id===null)return;window.clearInterval(this.id);this.id=null}
 ngOnDestroy(){this.stop();document.removeEventListener('visibilitychange',this.onVisibilityChange)}
}
