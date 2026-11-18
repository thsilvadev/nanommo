import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CombatantDetailsComponent, combatantStatRows, CombatantDropRow } from './combatant-details.component';
import { CombatantPortraitComponent } from './combatant-portrait.component';

@Component({standalone:true,imports:[CombatantDetailsComponent,CombatantPortraitComponent],template:`
  <app-combatant-portrait name="Target" src="/test-monster.svg">
    <app-combatant-details portraitDetails [stats]="stats" [drops]="drops" />
  </app-combatant-portrait>`})
class DetailsHost {
  stats=combatantStatRows({atk:42,matk:0,def:15,mdefPercent:20,accuracy:97,evasion:3,critChance:5});
  drops:CombatantDropRow[]|null=[{name:'Ancient Bark',percent:12.5}];
}

describe('target tooltip stats and drops',()=>{
  beforeEach(async()=>{await TestBed.configureTestingModule({imports:[DetailsHost]}).compileComponents();});
  it('shows monster name, stats, then drops in the floating tooltip',()=>{
    const fixture=TestBed.createComponent(DetailsHost);fixture.detectChanges();
    fixture.nativeElement.querySelector('.portrait').dispatchEvent(new PointerEvent('pointerenter'));
    const tooltip=document.querySelector<HTMLElement>('.combatant-details.nm-floating-tooltip')!;
    const text=tooltip.textContent!;
    expect(text.indexOf('Target')).toBeLessThan(text.indexOf('STATS'));
    expect(text.indexOf('STATS')).toBeLessThan(text.indexOf('DROPS'));
    expect(text).toContain('ATK42');expect(text).toContain('MATK0');
    expect(text).toContain('MDEF20%');expect(text).toContain('Ancient Bark12.5%');
    fixture.destroy();
  });
  it('omits all drop content for player targets',()=>{
    const fixture=TestBed.createComponent(DetailsHost);fixture.componentInstance.drops=null;fixture.detectChanges();
    fixture.nativeElement.querySelector('.portrait').dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
    const text=document.querySelector('.combatant-details.nm-floating-tooltip')!.textContent!;
    expect(text).toContain('Target');expect(text).toContain('STATS');expect(text).not.toContain('DROPS');expect(text).not.toContain('No listed drops');
    fixture.destroy();
  });
  it('keeps an empty monster drop section and formats absent stats explicitly',()=>{
    const fixture=TestBed.createComponent(DetailsHost);fixture.componentInstance.drops=[];fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('DROPS');expect(fixture.nativeElement.textContent).toContain('No listed drops');
    expect(combatantStatRows({})[0].value).toBe('—');fixture.destroy();
  });
});
