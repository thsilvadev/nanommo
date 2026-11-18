import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CombatantPortraitComponent } from './combatant-portrait.component';

@Component({standalone:true,imports:[CombatantPortraitComponent],template:`
  <app-combatant-portrait imageClass="foe-sprite" src="/test-monster.svg" name="Treant">
    <div portraitDetails>{{content}}</div>
  </app-combatant-portrait>`})
class PortraitHost { content='Ancient Bark · 12.5%'; }

describe('combatant portrait details',()=>{
  const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  beforeEach(async()=>{await TestBed.configureTestingModule({imports:[PortraitHost]}).compileComponents();});
  it('shows projected details on hover, accepts different content on focus, and cleans up',async()=>{
    const fixture=TestBed.createComponent(PortraitHost);fixture.detectChanges();
    const trigger:HTMLElement=fixture.nativeElement.querySelector('.portrait');
    expect(trigger.querySelector('.foe-sprite')?.tagName).toBe('IMG');
    expect(document.querySelector('.combatant-details.nm-floating-tooltip')).toBeNull();
    trigger.dispatchEvent(new PointerEvent('pointerenter',{clientX:20,clientY:20}));await frame();
    const tooltip=document.querySelector<HTMLElement>('.combatant-details.nm-floating-tooltip')!;
    expect(tooltip).not.toBeNull();expect(tooltip.textContent).toContain('Ancient Bark · 12.5%');
    expect(tooltip.parentElement).toBe(document.body);expect(tooltip.style.visibility).toBe('visible');
    trigger.dispatchEvent(new PointerEvent('pointerleave'));expect(tooltip.style.display).toBe('none');
    fixture.componentInstance.content='PvP rating: 1500';fixture.detectChanges();
    trigger.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));await frame();
    expect(tooltip.textContent).toContain('PvP rating: 1500');expect(tooltip.textContent).not.toContain('Ancient Bark');
    trigger.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));expect(tooltip.style.display).toBe('none');
    fixture.destroy();expect(document.body.contains(tooltip)).toBeFalse();
  });
  it('keeps floating details inside the viewport near the bottom-right corner',async()=>{
    const fixture=TestBed.createComponent(PortraitHost);fixture.detectChanges();
    fixture.nativeElement.querySelector('.portrait').dispatchEvent(new PointerEvent('pointerenter',{clientX:innerWidth-1,clientY:innerHeight-1}));await frame();
    const bounds=document.querySelector<HTMLElement>('.combatant-details.nm-floating-tooltip')!.getBoundingClientRect();
    expect(bounds.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
    expect(bounds.bottom).toBeLessThanOrEqual(document.documentElement.clientHeight);
    fixture.destroy();
  });
});
