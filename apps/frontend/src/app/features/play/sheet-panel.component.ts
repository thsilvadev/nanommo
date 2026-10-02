import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, effect, inject, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CharacterStore, BattleStore, InventoryStore } from '../../core/game.store';
import { UiPrefsStore, SheetDetent } from '../../core/ui-prefs.store';
import { GameFormatService } from '../../core/game-format.service';
import { TickerService } from '../../core/ticker.service';
import { BattleLogComponent } from './battle-log.component';
import { VendorPanel } from './components';
@Component({selector:'app-sheet-panel',standalone:true,imports:[CommonModule,VendorPanel,BattleLogComponent],templateUrl:'./sheet-panel.component.html',styleUrl:'./sheet-panel.component.css'})
export class SheetPanelComponent implements AfterViewInit,OnDestroy {
 constructor(){effect(()=>this.prefs.setContext(this.town?'town':'grind'))}
 readonly character=inject(CharacterStore);readonly battle=inject(BattleStore);readonly inventory=inject(InventoryStore);readonly prefs=inject(UiPrefsStore);readonly format=inject(GameFormatService);readonly router=inject(Router);readonly ticker=inject(TickerService);private readonly host=inject(ElementRef<HTMLElement>);readonly bodyPx=signal(0);readonly dragPx=signal<number|null>(null);private ro?:ResizeObserver;private startY=0;private startPx=0;private moved=false;
 get town(){return this.character.character()?.status==='town'||!this.character.character()?.currentMapId}
 get detent(){return this.prefs.active()}
 ngAfterViewInit(){const body=this.host.nativeElement.parentElement;this.ro=new ResizeObserver(()=>this.bodyPx.set(body?.clientHeight??0));if(body)this.ro.observe(body)}
 height(){const h=this.bodyPx();if(this.dragPx()!==null)return this.dragPx()!;return Math.max(88,h*(this.detent==='peek'?.1:this.detent==='half'?.5:.9))}
 down(e:PointerEvent){this.startY=e.clientY;this.startPx=this.height();this.moved=false;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)}
 move(e:PointerEvent){if(!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId))return;const dy=this.startY-e.clientY;if(Math.abs(dy)>4)this.moved=true;this.dragPx.set(Math.max(88,Math.min(this.bodyPx(),this.startPx+dy)))}
 up(e:PointerEvent){if(!this.moved){const n:SheetDetent=this.detent==='peek'?'half':this.detent==='half'?'full':'peek';this.prefs.setDetent(n)}else{const h=this.bodyPx(),p=this.dragPx()??this.startPx;const vals:[SheetDetent,number][]=[['peek',h*.1],['half',h*.5],['full',h*.9]];this.prefs.setDetent(vals.reduce((a,b)=>Math.abs(b[1]-p)<Math.abs(a[1]-p)?b:a)[0])}this.dragPx.set(null)}
 ngOnDestroy(){this.ro?.disconnect()}
 state(){const b=this.battle.active();if(this.town)return 'In Town';if(this.battle.state()==='reconnecting')return 'RECONNECTING';if(!b)return 'SEARCHING FOR MONSTER';return this.clockTick(b)>0?'BATTLE ACTIVE':'SEARCHING FOR MONSTER'}
 clockTick(b:any){return Math.max(0,Math.floor((this.ticker.now()-Date.parse(b.startAt))/1000))}
 events(){const b:any=this.battle.active();if(!b?.log?.events)return [];const tick=this.clockTick(b);return b.log.events.filter((e:any)=>e.tick<=tick).sort((a:any,b:any)=>a.tick-b.tick).map((e:any)=>({tick:e.tick,text:this.format.eventText(e)}))}
}
