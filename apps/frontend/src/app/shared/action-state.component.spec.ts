import { TestBed } from '@angular/core/testing';
import { ActionStateComponent } from './action-state.component';
import { LocaleService } from '../core/locale.service';

describe('subtle action marker',()=>{
  beforeEach(()=>TestBed.configureTestingModule({imports:[ActionStateComponent],providers:[LocaleService]}));
  it('keeps the queue clock small, stationary and keyboard-readable',()=>{
    const fixture=TestBed.createComponent(ActionStateComponent);
    fixture.componentRef.setInput('state',{id:'a',clientRequestId:'r',kind:'use_item',target:{itemId:'food_bread'},phase:'queued',local:false});
    document.body.appendChild(fixture.nativeElement);fixture.detectChanges();
    const marker:HTMLElement=fixture.nativeElement.querySelector('.marker');
    const svg:SVGElement=marker.querySelector('svg')!;
    expect(svg.getBoundingClientRect().width).toBe(12);expect(svg.getBoundingClientRect().height).toBe(12);
    expect(getComputedStyle(svg).animationName).toBe('none');
    expect(marker.tabIndex).toBe(0);expect(marker.getAttribute('aria-label')).toBeTruthy();expect(marker.title).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.caption')).toBeNull();fixture.destroy();
  });
  it('shows failure detail and clears completely when no action remains',()=>{
    const fixture=TestBed.createComponent(ActionStateComponent);
    fixture.componentRef.setInput('state',{id:'a',clientRequestId:'r',kind:'use_item',target:{},phase:'failed',message:'Food is still digesting',local:true});fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.marker').getAttribute('aria-label')).toBe('Food is still digesting');
    fixture.componentRef.setInput('state',null);fixture.detectChanges();expect(fixture.nativeElement.querySelector('.marker')).toBeNull();fixture.destroy();
  });
});
