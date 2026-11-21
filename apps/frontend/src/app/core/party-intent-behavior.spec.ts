import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PartyStore } from './party.store';
import { ApiService } from './api.service';
import { CharacterStore, InventoryStore } from './game.store';
import { CatalogService } from './catalog.service';
import { GameAudioService } from '../shared/game-audio.service';
import { BrowserNotificationsService } from './browser-notifications.service';
import { GambitEditorComponent } from '../features/gambit/gambit-editor.component';

describe('combat intent responses',()=>{
  let api:any, character:any, audio:any, inventory:InventoryStore, actions:any;
  beforeEach(()=>{
    api={get:jasmine.createSpy().and.returnValue(of([])),put:jasmine.createSpy(),post:jasmine.createSpy(),delete:jasmine.createSpy()};
    character={character:()=>({id:'hero',activeGambitPageId:'old'}),applyPatch:jasmine.createSpy(),applyRealtimeSnapshot:jasmine.createSpy()};
    audio={play:jasmine.createSpy()};actions=signal<any[]>([]);
    const catalog={load:async()=>{},items:()=>[],item:()=>({type:'consumable'}),gambits:()=>({conditions:[],actions:[]}),skills:()=>[],setEquippedEquipment:()=>{}};
    TestBed.configureTestingModule({providers:[InventoryStore,{provide:ApiService,useValue:api},{provide:CharacterStore,useValue:character},{provide:CatalogService,useValue:catalog},{provide:GameAudioService,useValue:audio},{provide:BrowserNotificationsService,useValue:{}},{provide:PartyStore,useValue:{actions}}]});
    inventory=TestBed.inject(InventoryStore);
  });
  it('surfaces failed consumable requests without playing the success sound',async()=>{
    api.post.and.returnValue(of({intent:{id:'i',status:'failed',result:{message:'Item is on cooldown'}},stateVersion:1,inventory:[],character:{}}));
    await expectAsync(inventory.useConsumable('elixir_greater')).toBeRejected();
    expect(audio.play).not.toHaveBeenCalled();
  });
  it('does not play the success sound while a consumable is pending',async()=>{
    api.post.and.returnValue(of({intent:{id:'i',status:'pending'},stateVersion:1,inventory:[],character:{}}));
    await inventory.useConsumable('elixir_greater');expect(audio.play).not.toHaveBeenCalled();
  });
  it('surfaces failed equipment requests',async()=>{
    api.put.and.returnValue(of({intent:{id:'i',status:'failed',result:{message:'Invalid slot'}},stateVersion:1,inventory:[],equipment:[],character:{}}));
    await expectAsync(inventory.equip('head','hat')).toBeRejected();
  });
  it('keeps an accepted but pending Gambit edit dirty and does not activate pending pages',async()=>{
    const editor=TestBed.runInInjectionContext(()=>new GambitEditorComponent());await Promise.resolve();
    const page:any={id:'page',title:'Page',lines:[]};editor.pages.set([page]);(editor as any).savedStates.set({page:'old state'});
    api.put.and.returnValue(of({intent:{id:'intent-1',status:'pending'}}));
    await editor.save();expect(editor.pageDirty('page')).toBeTrue();
    await editor.activate();expect(character.applyPatch).not.toHaveBeenCalled();
  });
  it('shows rejected Gambit changes and leaves the draft dirty',async()=>{
    const editor=TestBed.runInInjectionContext(()=>new GambitEditorComponent());await Promise.resolve();
    editor.pages.set([{id:'page',title:'Page',lines:[]} as any]);(editor as any).savedStates.set({page:'old state'});
    api.put.and.returnValue(of({intent:{id:'intent-1',status:'failed',result:{message:'Invalid Gambit'}}}));
    await editor.save();expect(editor.pageDirty('page')).toBeTrue();expect(editor.error()).toContain('Invalid Gambit');
  });
  it('marks a pending Gambit save complete only after its authoritative applied event, without erasing later edits',async()=>{
    const editor=TestBed.runInInjectionContext(()=>new GambitEditorComponent());await Promise.resolve();
    editor.pages.set([{id:'page',title:'Initial',lines:[]} as any]);(editor as any).savedStates.set({page:'old'});
    api.put.and.returnValue(of({intent:{id:'queued',status:'pending'}}));
    await editor.save();expect(editor.pageDirty('page')).toBeTrue();
    actions.set([{id:'queued',status:'applied'}]);TestBed.flushEffects();
    expect(editor.pageDirty('page')).toBeFalse();
    editor.updateTitle(editor.page()!,'Changed again');expect(editor.pageDirty('page')).toBeTrue();
  });
  it('reconciles a terminal intent already received before its pending HTTP response',async()=>{
    const editor=TestBed.runInInjectionContext(()=>new GambitEditorComponent());await Promise.resolve();
    editor.pages.set([{id:'page',title:'Initial',lines:[]} as any]);(editor as any).savedStates.set({page:'old'});
    actions.set([{id:'queued',status:'applied'}]);TestBed.flushEffects();
    api.put.and.returnValue(of({intent:{id:'queued',status:'pending'}}));
    await editor.save();TestBed.flushEffects();expect(editor.pageDirty('page')).toBeFalse();
  });
  it('does not enqueue a second save for a page while its first save is pending',async()=>{
    const editor=TestBed.runInInjectionContext(()=>new GambitEditorComponent());await Promise.resolve();
    editor.pages.set([{id:'page',title:'Initial',lines:[]} as any]);(editor as any).savedStates.set({page:'old'});
    api.put.and.returnValue(of({intent:{id:'queued',status:'pending'}}));
    await editor.save();editor.updateTitle(editor.page()!,'Later draft');await editor.save();
    expect(api.put).toHaveBeenCalledTimes(1);expect(editor.pagePending('page')).toBeTrue();
    actions.set([{id:'queued',status:'applied'}]);TestBed.flushEffects();
    expect(editor.pagePending('page')).toBeFalse();expect(editor.pageDirty('page')).toBeTrue();
  });
  it('keeps cancelled saves dirty and permits retrying them',async()=>{
    const editor=TestBed.runInInjectionContext(()=>new GambitEditorComponent());await Promise.resolve();
    editor.pages.set([{id:'page',title:'Initial',lines:[]} as any]);(editor as any).savedStates.set({page:'old'});
    api.put.and.returnValue(of({intent:{id:'queued',status:'pending'}}));await editor.save();
    actions.set([{id:'queued',status:'cancelled'}]);TestBed.flushEffects();
    expect(editor.pagePending('page')).toBeFalse();expect(editor.pageDirty('page')).toBeTrue();expect(editor.error()).toBeTruthy();
  });
  it('plays the item sound exactly once after the queued consume is applied',async()=>{
    api.post.and.returnValue(of({intent:{id:'consume-1',status:'pending'},stateVersion:1,inventory:[],character:{}}));
    await inventory.useConsumable('elixir_greater');expect(audio.play).not.toHaveBeenCalled();
    actions.set([{id:'consume-1',status:'applied'}]);TestBed.flushEffects();expect(audio.play).toHaveBeenCalledOnceWith('potion_drink');
    actions.set([{id:'consume-1',status:'applied'}]);TestBed.flushEffects();expect(audio.play).toHaveBeenCalledTimes(1);
  });
});
