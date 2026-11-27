import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CatalogService } from '../../core/catalog.service';
import { LocaleService } from '../../core/locale.service';
import { TooltipPositionDirective } from './tooltip-position.directive';

@Component({standalone:true,imports:[CommonModule,TooltipPositionDirective],template:`
  <section *ngIf="open" style="height:60px;width:180px;overflow:hidden;position:relative;z-index:1000">
    <span class="craft-trigger" tabindex="0">Item
      <span class="item-tooltip craft-item-tooltip" role="tooltip"><strong [class]="catalog.itemTitleClass('sword')">{{catalog.craftItemName('sword')}}</strong>
        <span *ngFor="let line of catalog.craftItemTooltipLines('sword',{refinementLevel:2})">{{line.label}}: {{line.value}}</span>
      </span>
    </span>
  </section>`})
class CraftTooltipHost { readonly catalog=inject(CatalogService);open=true; }

describe('craft item floating details',()=>{
  const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  beforeEach(async()=>{
    await TestBed.configureTestingModule({imports:[CraftTooltipHost],providers:[CatalogService,LocaleService]}).compileComponents();
    TestBed.inject(CatalogService).items.set([{id:'sword',name:'Reinforced Sword',type:'equipment',tier:2,slot:'mainHand',weaponType:'sword',levelReq:8,fixedStats:{atk:28},requiredUnlock:'equipment_access_t2',description:'A dependable blade for experienced adventurers.'}] as any);
  });
  it('floats readable item details above the modal, outside clipped containers',async()=>{
    const fixture=TestBed.createComponent(CraftTooltipHost);fixture.detectChanges();
    fixture.nativeElement.querySelector('.craft-trigger').dispatchEvent(new PointerEvent('pointerenter',{clientX:innerWidth-3,clientY:innerHeight-3}));await frame();
    const tooltip=document.querySelector<HTMLElement>('.craft-item-tooltip.nm-floating-tooltip')!;
    expect(tooltip.parentElement).toBe(document.body);
    expect(Number(getComputedStyle(tooltip).zIndex)).toBeGreaterThan(1000);
    expect(tooltip.textContent).toContain('Reinforced Sword');expect(tooltip.textContent).toContain('+28 (+10)');
    expect(getComputedStyle(tooltip.querySelector('strong')!).color).toBe('rgb(95, 196, 107)');
    expect(tooltip.textContent).not.toContain('equipment_access_t2');
    expect(tooltip.getBoundingClientRect().right).toBeLessThanOrEqual(document.documentElement.clientWidth);
    expect(tooltip.getBoundingClientRect().bottom).toBeLessThanOrEqual(document.documentElement.clientHeight);
    fixture.componentInstance.open=false;fixture.detectChanges();expect(document.body.contains(tooltip)).toBeFalse();fixture.destroy();
  });
  it('keeps long details scrollable inside a short viewport and dismisses with Escape',async()=>{
    TestBed.inject(CatalogService).items.update(items=>items.map(item=>({...item,description:'Detailed item information. '.repeat(150)})));
    const fixture=TestBed.createComponent(CraftTooltipHost);fixture.detectChanges();
    const trigger=fixture.nativeElement.querySelector('.craft-trigger');trigger.dispatchEvent(new PointerEvent('pointerenter',{clientX:innerWidth-3,clientY:innerHeight-3}));await frame();
    const tooltip=document.querySelector<HTMLElement>('.craft-item-tooltip.nm-floating-tooltip')!;
    expect(tooltip.getBoundingClientRect().height).toBeLessThanOrEqual(document.documentElement.clientHeight-19);
    tooltip.scrollTop=30;expect(tooltip.scrollTop).toBeGreaterThan(0);
    trigger.dispatchEvent(new PointerEvent('pointerleave'));tooltip.dispatchEvent(new PointerEvent('pointerenter'));
    await new Promise(resolve=>setTimeout(resolve,160));expect(tooltip.style.display).not.toBe('none');
    trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect(tooltip.style.display).toBe('none');fixture.destroy();
  });
  it('supports keyboard focus and never falls back to an internal item code',async()=>{
    const fixture=TestBed.createComponent(CraftTooltipHost);fixture.detectChanges();
    const trigger=fixture.nativeElement.querySelector('.craft-trigger');trigger.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));await frame();
    const tooltip=document.querySelector<HTMLElement>('.craft-item-tooltip.nm-floating-tooltip')!;
    expect(tooltip.style.visibility).toBe('visible');
    expect(TestBed.inject(CatalogService).craftItemName('equipment_access_t2')).not.toContain('equipment_access_t2');
    trigger.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));expect(tooltip.style.display).toBe('none');fixture.destroy();
  });
});
