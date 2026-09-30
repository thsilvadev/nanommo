import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthStore } from '../../core/auth.store';
import { BattleStore, CharacterStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { ApiService } from '../../core/api.service';
import { GameSocketService } from '../../core/game.socket.service';
import { CharacterSummary, GrindInfo, ChatDrawer } from './components';
@Component({
 selector:'app-play', standalone:true, imports:[CommonModule,RouterOutlet,CharacterSummary,GrindInfo,ChatDrawer],
 templateUrl:'./play.component.html', styleUrl:'./play.component.css'
})
export class PlayComponent implements OnInit {
 readonly auth=inject(AuthStore); readonly character=inject(CharacterStore); private readonly battle=inject(BattleStore);
 private readonly inventory=inject(InventoryStore); private readonly catalog=inject(CatalogService); private readonly api=inject(ApiService); private readonly socket=inject(GameSocketService);
 private readonly router=inject(Router); readonly chatOpen=signal(false); readonly gambitTitle=signal('No Gambit Active'); readonly settingsOpen=signal(false); readonly deleteAccountOpen=signal(false); readonly deleteConfirm=signal(''); readonly deleteAccountError=signal<string | null>(null);
 ngOnInit(){this.socket.connect();this.battle.bindEvents(this.character,this.inventory);void Promise.all([this.character.load(),this.inventory.load(),this.battle.load(),this.catalog.load()]).then(()=>this.loadActiveGambitTitle());}
  async loadActiveGambitTitle(){try{const pages=await this.api.get<any[]>('/gambits').toPromise();const id=this.character.character()?.activeGambitPageId;const page=(pages??[]).find(p=>p.id===id);this.gambitTitle.set(page?.title?.trim()||'Untitled Gambit')}catch{this.gambitTitle.set('No Gambit Active')}}
 go(path:string){void this.router.navigateByUrl(path)} goCharacter(){void this.router.navigate(['/play/character'],{queryParams:{tab:'character'}})} is(path:string){return this.router.url.split('?')[0]===path}
 xpWidth(){const c=this.character.character();return c?.xpToNext?Math.max(0,Math.min(100,c.xp/c.xpToNext*100)):0}
 xpTitle(){const c=this.character.character();return c?`XP ${c.xp} / ${c.xpToNext}`:'XP'}
  activeGambitTitle(){return this.gambitTitle()}
 openDeleteAccount(){this.settingsOpen.set(false);this.deleteConfirm.set('');this.deleteAccountError.set(null);this.deleteAccountOpen.set(true)}
 cancelDeleteAccount(){this.deleteAccountOpen.set(false);this.deleteConfirm.set('');this.deleteAccountError.set(null)}
 confirmDeleteAccount(){if(this.deleteConfirm()!=='DELETE') return;this.deleteAccountError.set(null);this.auth.deleteAccount().subscribe({next:()=>{this.cancelDeleteAccount();this.auth.logout()},error:(err)=>this.deleteAccountError.set(err.error?.message||'Unable to delete account')})}
}
