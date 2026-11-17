import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { BattleStore, CharacterStore } from './game.store';
import { GameSocketService } from './game.socket.service';
import { ApiService } from './api.service';
import { GameAudioService } from '../shared/game-audio.service';

describe('shared resolution outbox replay',()=>{
  it('counts session loot once while still reconciling repeated authoritative resource snapshots',()=>{
    const events=new Map<string,Subject<any>>();
    const character={character:()=>({id:'hero',status:'grinding',currentMapId:'map'}),applyRealtimeSnapshot:jasmine.createSpy('character.applyRealtimeSnapshot')};
    const inventory={applyRealtimeSnapshot:jasmine.createSpy('inventory.applyRealtimeSnapshot')};
    TestBed.configureTestingModule({providers:[BattleStore,{provide:CharacterStore,useValue:character},{provide:ApiService,useValue:{get:()=>of([])}},{provide:GameAudioService,useValue:{play:()=>{}}},{provide:GameSocketService,useValue:{onConnectionState:()=>new Subject(),on:(event:string)=>{const subject=new Subject();events.set(event,subject);return subject;}}}]});
    const store=TestBed.inject(BattleStore);store.bindEvents(character as any,inventory as any);
    const payload={entryId:'shared-battle',startAt:'2026-11-17T12:00:00Z',endAt:'2026-11-17T12:00:10Z',tickDurationMs:500,outcome:'win',xpGain:10,goldGain:1,drops:[{itemId:'herb',quantity:2}],stateRevision:5,characterAfter:{id:'hero'},inventoryAfter:[]};
    events.get('battle:resolved')!.next(payload);events.get('battle:resolved')!.next(payload);
    expect(store.sessionDrops()).toEqual([{itemId:'herb',quantity:2}]);
    expect(character.applyRealtimeSnapshot).toHaveBeenCalledTimes(2);
    expect(inventory.applyRealtimeSnapshot).toHaveBeenCalledTimes(2);
    store.ngOnDestroy();
  });
});
