import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CharacterStore, BattleStore, InventoryStore } from '../../core/game.store';
import { AuthStore } from '../../core/auth.store';
import { GameSocketService } from '../../core/game.socket.service';
import { ViewportService } from '../../core/viewport.service';
import { LoginMusicControlComponent } from '../../shared/login-music-control.component';
import { ChatDrawer } from './components';
import { MobileCharPanelComponent } from './mobile-char-panel.component';
import { SheetPanelComponent } from './sheet-panel.component';

@Component({selector:'app-mobile-shell',standalone:true,imports:[CommonModule,RouterOutlet,LoginMusicControlComponent,ChatDrawer,MobileCharPanelComponent,SheetPanelComponent],templateUrl:'./mobile-shell.component.html',styleUrl:'./mobile-shell.component.css'})
export class MobileShellComponent {
 readonly router=inject(Router);readonly auth=inject(AuthStore);readonly character=inject(CharacterStore);readonly battle=inject(BattleStore);readonly socket=inject(GameSocketService);readonly viewport=inject(ViewportService);
 readonly chatOpen=signal(false);readonly menuOpen=signal(false);readonly settingsOpen=signal(false);@Output() deleteAccount=new EventEmitter<void>();
 tabs=[['battle','Battle','/assets/ui/sword.svg'],['map','Map','/assets/ui/map.svg'],['items','Itens','/assets/ui/inventory.svg'],['gambits','Gambit','/assets/ui/scroll.svg'],['character','Char','/assets/ui/sword.svg']];
 constructor(){this.socket.connect()}
 go(path:string){void this.router.navigateByUrl('/play/m/'+path)}
 active(path:string){const current=this.router.url.split('?')[0];return current==='/play/m/'+path||(path==='battle'&&current==='/play/grind')}
 openMenu(){this.menuOpen.set(true)}
 showCockpit(){const path=this.router.url.split('?')[0];return path==='/play/grind'||path==='/play/m/battle'}
 logout(){this.menuOpen.set(false);this.auth.logout()}
}
