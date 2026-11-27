import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PartyStore, PartyView } from '../../core/party.store';
import { CharacterStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { LocaleService } from '../../core/locale.service';
import { UiClockService } from '../../core/ui-clock.service';
import { SharedBattleView } from '../../core/party-projection';
import { CombatTimersService } from './combat-timers.service';
import { PartyPanelComponent } from './party-panel.component';
import { SharedBattlePanelComponent } from './shared-battle-panel.component';

@Component({standalone:true,imports:[CommonModule,PartyPanelComponent,SharedBattlePanelComponent],template:`<div class="columns"><app-party-panel/><section class="battle-column"><app-shared-battle-panel/><div class="below" data-skills>SKILLS</div><div class="below" data-loot>SESSION LOOT</div></section></div>`,styles:[`:host{display:block}.columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);height:100%;gap:8px}.battle-column{display:flex;flex-direction:column;height:100%;min-height:0}.below{flex:0 0 30px}`]})
class RenderingHost {}

describe('party components in constrained viewports',()=>{
  const start=Date.parse('2026-11-17T12:00:00Z');
  const party=signal<PartyView|null>(null),battle=signal<SharedBattleView|null>(null),clock=signal(Date.now());
  const store={party,battle,members:computed(()=>party()?.members??[]),invites:signal([]),actions:signal([]),autoPartyEnabled:signal(false),busy:signal(false),error:signal(''),connection:signal('connected'),leave:jasmine.createSpy('leave'),kick:jasmine.createSpy('kick'),reorder:jasmine.createSpy('reorder'),setAuto:jasmine.createSpy('setAuto'),transferLeader:jasmine.createSpy('transferLeader'),lastErrorCode:signal('')};
  beforeEach(async()=>{
    party.set({id:'party',revision:1,kind:'manual',leaderCharacterId:'hero',mapId:'map',members:Array.from({length:5},(_,i)=>({characterId:i===0?'hero':'ally'+i,name:'Character '+(i+1),orderIndex:i,pendingLeave:false,hp:100,sp:50,maxHp:100,maxSp:50,statusEffects:[]}))});
    battle.set({id:'battle',revision:1,state:'started',startAt:new Date(start).toISOString(),endAt:new Date(start+60000).toISOString(),snapshot:{actors:[{id:'hero',kind:'character',team:'a',name:'Hero',snapshot:{hp:100,sp:50,maxHp:100,maxSp:50}},{id:'wolf',kind:'monster',team:'b',name:'Wolf',snapshot:{hp:70,sp:0,maxHp:70,maxSp:0}}]},log:{events:Array.from({length:100},(_,tick)=>({tick,actorId:'hero',targetIds:['wolf'],action:'attack',payload:{type:'action',damage:1},actorStates:{hero:{hp:100,sp:50,targetId:'wolf'},wolf:{hp:70,sp:0}}}))}});
    await TestBed.configureTestingModule({imports:[RenderingHost],providers:[{provide:CombatTimersService,useValue:{member:()=>[],sharedTarget:()=>[]}},{provide:UiClockService,useValue:{now:clock}},{provide:PartyStore,useValue:store},{provide:CharacterStore,useValue:{character:()=>({id:'hero',name:'Hero'})}},{provide:CatalogService,useValue:{monster:()=>null}},{provide:LocaleService,useValue:{t:(value:string)=>value}}]}).compileComponents();
  });
  for(const height of [700,340])it(`keeps group controls and the internally scrolling feed available at ${height}px height`,()=>{
    const fixture=TestBed.createComponent(RenderingHost),host:HTMLElement=fixture.nativeElement;
    host.style.width='700px';host.style.height=height+'px';fixture.detectChanges();
    clock.set(start+50000);fixture.detectChanges();
    const log=host.querySelector<HTMLElement>('.shared-feed')!,loot=host.querySelector<HTMLElement>('[data-loot]')!,skills=host.querySelector<HTMLElement>('[data-skills]')!,panel=host.querySelector<HTMLElement>('app-party-panel')!;
    expect(host.querySelectorAll('.party-member').length).toBe(5);
    expect(host.querySelector('input[placeholder="Character name"]')).toBeNull();
    expect(host.querySelector('.auto-party input[type="checkbox"]')).not.toBeNull();
    expect(host.querySelector('.action-history')).toBeNull();
    expect(log.scrollHeight).toBeGreaterThan(log.clientHeight);
    expect(log.getBoundingClientRect().bottom).toBeLessThanOrEqual(skills.getBoundingClientRect().top+1);
    expect(loot.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.getBoundingClientRect().bottom+1);
    expect(panel.scrollHeight).toBeGreaterThanOrEqual(panel.clientHeight);
    expect(host.querySelectorAll('.shared-event').length).toBe(100);
    fixture.destroy();
  });
  it('lets the leader hand leadership to another member',()=>{
    const fixture=TestBed.createComponent(RenderingHost);fixture.detectChanges();
    const buttons=[...fixture.nativeElement.querySelectorAll('.member-controls button')] as HTMLButtonElement[];
    const make=buttons.filter(b=>b.textContent?.trim()==='Make leader');
    expect(make.length).toBe(4);
    make[0].click();
    expect(store.transferLeader).toHaveBeenCalledWith('ally1');
    fixture.destroy();
  });
  it('leaves an invitation addressed to me to the popup, and lists the one I sent',()=>{
    const invites=store.invites as any;
    invites.set([{id:'in',inviterId:'x',candidateId:'hero',inviterName:'Xena',status:'offered',expiresAt:new Date(Date.now()+60000).toISOString(),mode:'manual'},{id:'out',inviterId:'hero',candidateId:'y',candidateName:'Yuri',status:'offered',expiresAt:new Date(Date.now()+60000).toISOString(),mode:'manual'}]);
    const fixture=TestBed.createComponent(RenderingHost);fixture.detectChanges();
    const listed=[...fixture.nativeElement.querySelectorAll('.invite')].map((e:any)=>e.textContent);
    expect(listed.length).toBe(1);
    expect(listed[0]).toContain('Yuri');
    invites.set([]);
    fixture.destroy();
  });
  it('keeps non-leader removal and ordering controls unavailable',()=>{
    party.update(value=>({...value!,leaderCharacterId:'ally1'}));
    const fixture=TestBed.createComponent(RenderingHost);fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.member-controls')).toBeNull();
    expect(fixture.nativeElement.querySelector('.invite-form')).toBeNull();
    fixture.destroy();
  });
});
