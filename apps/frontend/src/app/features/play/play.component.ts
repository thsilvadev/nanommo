import { CommonModule } from '@angular/common';
import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthStore } from '../../core/auth.store';
import { BattleStore, CharacterStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { ApiService } from '../../core/api.service';
import { LoginMusicControlComponent } from '../../shared/login-music-control.component';
import { AccountDeleteModalComponent } from '../../shared/account-delete-modal.component';
import { TradeModalComponent } from '../../shared/trade-modal.component';
import { GameSocketService } from '../../core/game.socket.service';
import { ViewportService } from '../../core/viewport.service';
import { MobileShellComponent } from './mobile-shell.component';
import { CharacterSummary, GrindInfo, ChatDrawer } from './components';
@Component({
 selector:'app-play', standalone:true, imports:[CommonModule,RouterOutlet,CharacterSummary,GrindInfo,ChatDrawer,LoginMusicControlComponent,MobileShellComponent,TradeModalComponent,AccountDeleteModalComponent],
 templateUrl:'./play.component.html', styleUrl:'./play.component.css'
})
export class PlayComponent implements OnInit {
 readonly auth=inject(AuthStore); readonly character=inject(CharacterStore); private readonly battle=inject(BattleStore);
 private readonly inventory=inject(InventoryStore); private readonly catalog=inject(CatalogService); private readonly api=inject(ApiService); private readonly socket=inject(GameSocketService); readonly viewport=inject(ViewportService);
 private readonly router=inject(Router); readonly chatOpen=signal(false); readonly gambitTitle=signal('No Gambit Active'); readonly settingsOpen=signal(false); readonly deleteAccountOpen=signal(false); readonly deleteAccountError=signal<string | null>(null);
 constructor(){effect(()=>{const path=this.router.url.split('?')[0];if(!this.viewport.isMobile()&&path.startsWith('/play/m/')){const target:{[key:string]:string}={
 '/play/m/battle':'/play/grind','/play/m/map':'/play/grind','/play/m/items':'/play/grind','/play/m/gambits':'/play/gambits','/play/m/character':'/play/character?tab=character'};void this.router.navigateByUrl(target[path]??'/play/grind')}})}
 ngOnInit(){this.socket.connect();this.battle.bindEvents(this.character,this.inventory);void Promise.all([this.character.load(),this.inventory.load(),this.battle.load(),this.catalog.load()]).then(()=>this.loadActiveGambitTitle());}
  async loadActiveGambitTitle(){try{const pages=await this.api.get<any[]>('/gambits').toPromise();const id=this.character.character()?.activeGambitPageId;const page=(pages??[]).find(p=>p.id===id);this.gambitTitle.set(page?.title?.trim()||'Untitled Gambit')}catch{this.gambitTitle.set('No Gambit Active')}}
 go(path:string){void this.router.navigateByUrl(path)} goCharacter(){void this.router.navigate(['/play/character'],{queryParams:{tab:'character'}})} is(path:string){return this.router.url.split('?')[0]===path} isMobileShell(){const path=this.router.url.split('?')[0];return this.viewport.isMobile()&&(path==='/play/grind'||path.startsWith('/play/m/'))}
 xpWidth(){const c=this.character.character();return c?.xpToNext?Math.max(0,Math.min(100,c.xp/c.xpToNext*100)):0}
 xpTitle(){const c=this.character.character();return c?`XP ${c.xp} / ${c.xpToNext}`:'XP'}
  activeGambitTitle(){return this.gambitTitle()}
 openDeleteAccount(){this.settingsOpen.set(false);this.deleteAccountError.set(null);this.deleteAccountOpen.set(true)}
 cancelDeleteAccount(){this.deleteAccountOpen.set(false);this.deleteAccountError.set(null)}
 confirmDeleteAccount(){this.deleteAccountError.set(null);this.auth.deleteAccount().subscribe({next:()=>{this.cancelDeleteAccount();this.auth.logout()},error:(err)=>this.deleteAccountError.set(err.error?.message||'Unable to delete account')})}
}
