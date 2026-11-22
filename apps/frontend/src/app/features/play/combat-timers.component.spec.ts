import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CombatTimersComponent } from './combat-timers.component';
import { CombatTimersService } from './combat-timers.service';
import { CatalogService } from '../../core/catalog.service';
import { LocaleService } from '../../core/locale.service';
import { UiClockService } from '../../core/ui-clock.service';
import { BattleStore, CharacterStore } from '../../core/game.store';
import { PartyStore } from '../../core/party.store';

describe('combat HUD rendering', () => {
  const catalog={statusEffect:(id:string)=>({id,name:id,polarity:id==='rage'?'buff':'debuff'}),skills:()=>[{id:'bolt',name:'Bolt'}],item:()=>null,itemIcon:()=>'',items:()=>[]};
  beforeEach(()=>TestBed.configureTestingModule({imports:[CombatTimersComponent],providers:[{provide:CatalogService,useValue:catalog},LocaleService]}));
  it('uses equal 28px icons with category borders and status duration instead of stacks', () => {
    const fixture=TestBed.createComponent(CombatTimersComponent);
    fixture.componentRef.setInput('timers',[
      {key:'item:potion',kind:'item',id:'potion',remainingSeconds:5,fraction:.5},
      {key:'skill:bolt',kind:'skill',id:'bolt',remainingSeconds:2,fraction:.25},
      {key:'status:poison',kind:'status',id:'poison',remainingSeconds:4.1,fraction:0,stacks:2},
      {key:'status:rage',kind:'status',id:'rage',remainingSeconds:Infinity,fraction:0,stacks:1},
    ]);
    document.body.appendChild(fixture.nativeElement);fixture.detectChanges();
    const icons:HTMLElement[]=Array.from(fixture.nativeElement.querySelectorAll('.combat-timer'));
    expect(icons.map(icon=>icon.dataset['kind'])).toEqual(['buff','debuff','item','skill']);
    expect(icons.every(icon=>icon.getBoundingClientRect().width===28&&icon.getBoundingClientRect().height===28)).toBeTrue();
    expect(icons.map(icon=>getComputedStyle(icon).borderTopColor)).toEqual(['rgb(97, 199, 107)','rgb(237, 98, 98)','rgb(146, 146, 146)','rgb(245, 241, 232)']);
    expect(icons[0].querySelector('.duration')).toBeNull();
    expect(icons[1].querySelector('.duration')?.textContent).toBe('5');
    expect(icons[1].querySelector('.cooldown-sweep')).toBeNull();
    expect(icons[2].querySelector('.cooldown-sweep')).not.toBeNull();
    expect(icons[2].querySelector('img')?.getAttribute('src')).toBe('/assets/ui/cooldowns/potion.svg');
    fixture.componentRef.setInput('timers',[]);fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.combat-timer').length).toBe(0);
    fixture.destroy();
  });
  it('provides a keyboard tooltip with remaining duration and stacks', () => {
    const fixture=TestBed.createComponent(CombatTimersComponent);
    fixture.componentRef.setInput('timers',[{key:'status:poison',kind:'status',id:'poison',remainingSeconds:8,fraction:0,stacks:3}]);
    fixture.detectChanges();
    const icon=fixture.nativeElement.querySelector('.combat-timer');
    expect(icon.tabIndex).toBe(0);expect(icon.getAttribute('aria-label')).toContain('8s');
    expect(icon.querySelector('[role=tooltip]').textContent).toContain('3');
    fixture.destroy();
  });
});

describe('combat HUD panel data', () => {
  const start=Date.parse('2026-11-22T12:00:00Z');
  let clock:ReturnType<typeof signal<number>>, own:ReturnType<typeof signal<any>>, shared:ReturnType<typeof signal<any>>;
  beforeEach(()=>{
    clock=signal(start);own=signal({id:'hero',consumableCooldowns:{'item:potion':new Date(start+5000).toISOString()}});
    shared=signal({id:'battle',revision:1,state:'started',startAt:new Date(start).toISOString(),endAt:new Date(start+30000).toISOString(),snapshot:{tickDurationMs:500,actors:[
      {id:'hero',snapshot:{cooldowns:{'item:potion':10}}},{id:'ally',snapshot:{cooldowns:{'item:tonic':20}}},
      {id:'wolf1',snapshot:{statusEffects:[{type:'poison',expiresAtTick:20}]}},{id:'wolf2',snapshot:{statusEffects:[{type:'burn',expiresAtTick:20}]}},
    ]},log:{events:[
      {tick:1,actorId:'hero',action:'attack',targetIds:['wolf1']},
      {tick:2,actorId:'hero',action:'attack',targetIds:['wolf2']},
    ]}});
    TestBed.configureTestingModule({providers:[CombatTimersService,
      {provide:UiClockService,useValue:{now:clock}}, {provide:CharacterStore,useValue:{character:own}},
      {provide:BattleStore,useValue:{active:()=>null}},{provide:PartyStore,useValue:{battle:shared}},
      {provide:CatalogService,useValue:{items:()=>[],skills:()=>[]}},
    ]});
  });
  it('keeps own, ally and switched target identities separate', () => {
    const service=TestBed.inject(CombatTimersService);
    expect(service.own().map(row=>row.id)).toEqual(['potion']);
    expect(service.member({characterId:'ally'} as any).map(row=>row.id)).toEqual(['tonic']);
    clock.set(start+500);expect(service.sharedTarget().map(row=>row.id)).toEqual(['poison']);
    clock.set(start+1000);expect(service.sharedTarget().map(row=>row.id)).toEqual(['burn']);
    expect(service.member({characterId:'missing'} as any)).toEqual([]);
  });
  it('uses absolute timers between battles and expires them without refresh', () => {
    shared.set(null);const service=TestBed.inject(CombatTimersService);
    expect(service.own().map(row=>row.id)).toEqual(['potion']);
    clock.set(start+5000);expect(service.own()).toEqual([]);
  });
});
