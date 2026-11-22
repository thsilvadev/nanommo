import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PlayComponent } from './play.component';

describe('party resource notification reconciliation',()=>{
  it('reloads personal snapshots after a party action and releases the subscription on exit',fakeAsync(()=>{
    const events=new Map<string,Subject<any>>();const connection=new Subject<string>();
    const character={load:jasmine.createSpy('character.load').and.resolveTo()},inventory={load:jasmine.createSpy('inventory.load').and.resolveTo()},battle={load:jasmine.createSpy('battle.load').and.resolveTo(),bindEvents:()=>{}};
    const play:any=Object.create(PlayComponent.prototype);
    Object.assign(play,{character,inventory,battle,loginMusic:{fadeOut:()=>Promise.resolve()},browserNotifications:{syncExistingSubscription:()=>{}},socket:{connect:()=>{},onConnectionState:()=>connection,on:(event:string)=>{let subject=events.get(event);if(!subject){subject=new Subject();events.set(event,subject);}return subject;}},town:{start:()=>{},stop:()=>{}},party:{start:()=>{},stop:()=>{}},gameAudio:{start:()=>{},destroy:()=>{}},catalog:{load:()=>Promise.resolve()},loadActiveGambitTitle:()=>Promise.resolve(),gamePreload:{start:()=>{}},townScene:{}});
    play.ngOnInit();flushMicrotasks();character.load.calls.reset();inventory.load.calls.reset();battle.load.calls.reset();
    events.get('party:actionUpdated')?.next({refresh:true});tick(100);flushMicrotasks();
    expect(character.load).toHaveBeenCalledTimes(1);expect(inventory.load).toHaveBeenCalledTimes(1);expect(battle.load).toHaveBeenCalledTimes(1);
    play.ngOnDestroy();events.get('party:actionUpdated')?.next({refresh:true});tick(100);flushMicrotasks();
    expect(character.load).toHaveBeenCalledTimes(1);
  }));
});
