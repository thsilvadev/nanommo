import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthStore } from '../../core/auth.store';
import { BattleStore, CharacterStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { GameSocketService } from '../../core/game.socket.service';
import { CharacterSummary, GrindInfo, WeaponProficiency, ChatDrawer } from './components';
@Component({
 selector:'app-play', standalone:true, imports:[CommonModule,RouterOutlet,CharacterSummary,GrindInfo,WeaponProficiency,ChatDrawer],
 templateUrl:'./play.component.html', styleUrl:'./play.component.css'
})
export class PlayComponent implements OnInit {
 readonly auth=inject(AuthStore); readonly character=inject(CharacterStore); private readonly battle=inject(BattleStore);
 private readonly inventory=inject(InventoryStore); private readonly catalog=inject(CatalogService); private readonly socket=inject(GameSocketService);
 private readonly router=inject(Router); readonly chatOpen=signal(false);
 ngOnInit(){this.socket.connect();this.battle.bindEvents(this.character);void Promise.all([this.character.load(),this.inventory.load(),this.battle.load(),this.catalog.load()]);}
 go(path:string){void this.router.navigateByUrl(path)} is(path:string){return this.router.url===path}
 xpWidth(){return (this.character.character()?.xp??0)%100}
}
