import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { GrindComponent } from './grind.component';
import { ApiService } from '../../core/api.service';
import { CharacterStore } from '../../core/game.store';
import { PartyStore } from '../../core/party.store';
import { LocaleService } from '../../core/locale.service';

describe('Grind Gambit selection',()=>{
  const pages=[{id:'first',slotIndex:0,title:'First',lines:[]},{id:'second',slotIndex:1,title:'Second',lines:[]}];
  let api:any, current:any;
  beforeEach(async()=>{
    current=signal<any>({activeGambitPageId:'second'});
    api={get:()=>of(pages),put:jasmine.createSpy().and.returnValue(of({intent:{status:'pending'}}))};
    TestBed.configureTestingModule({imports:[GrindComponent],providers:[
      {provide:ApiService,useValue:api},
      {provide:CharacterStore,useValue:{character:current,applyPatch:(patch:any)=>current.update((c:any)=>({...c,...patch}))}},
      {provide:PartyStore,useValue:{party:()=>null}},
      {provide:LocaleService,useValue:{t:(value:string)=>value}},
    ]});
    TestBed.overrideComponent(GrindComponent,{set:{imports:[CommonModule,FormsModule],schemas:[NO_ERRORS_SCHEMA]}});
    await TestBed.compileComponents();
  });
  it('does not activate a default page while the character is still loading',async()=>{
    current.set(null);
    const fixture=TestBed.createComponent(GrindComponent);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    expect(api.put).not.toHaveBeenCalled();expect(current()).toBeNull();
  });
  it('renders the confirmed second page when options arrive asynchronously',async()=>{
    const fixture=TestBed.createComponent(GrindComponent);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('select').value).toBe('second');
    expect(api.put).not.toHaveBeenCalled();
  });
  it('keeps the displayed selection on the confirmed page while activation is pending',async()=>{
    const fixture=TestBed.createComponent(GrindComponent);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();await fixture.whenStable();
    const select=fixture.nativeElement.querySelector('select');select.value='first';select.dispatchEvent(new Event('change'));
    await fixture.whenStable();fixture.detectChanges();await fixture.whenStable();
    expect(current().activeGambitPageId).toBe('second');expect(select.value).toBe('second');
  });
  it('preserves the confirmed page when activation fails',async()=>{
    api.put.and.returnValue(of({intent:{status:'failed',result:{message:'Rejected'}}}));
    const fixture=TestBed.createComponent(GrindComponent);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();await fixture.whenStable();
    const select=fixture.nativeElement.querySelector('select');select.value='first';select.dispatchEvent(new Event('change'));
    await fixture.whenStable();fixture.detectChanges();
    expect(current().activeGambitPageId).toBe('second');expect(select.value).toBe('second');expect(fixture.componentInstance.error()).toBe('Rejected');
  });
  it('uses the authoritative character when activation is applied',async()=>{
    api.put.and.returnValue(of({intent:{status:'applied'},character:{activeGambitPageId:'first',stateVersion:12}}));
    const fixture=TestBed.createComponent(GrindComponent);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();await fixture.whenStable();
    const select=fixture.nativeElement.querySelector('select');select.value='first';select.dispatchEvent(new Event('change'));
    await fixture.whenStable();fixture.detectChanges();
    expect(current().activeGambitPageId).toBe('first');expect(select.value).toBe('first');expect(current().stateVersion).toBe(12);
  });

});
