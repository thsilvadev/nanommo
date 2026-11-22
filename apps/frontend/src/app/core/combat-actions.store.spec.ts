import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { ApiService } from './api.service';
import { CombatActionsStore } from './combat-actions.store';

describe('durable combat action feedback',()=>{
  let store:CombatActionsStore,api:any;
  const target={itemId:'food_test'};
  beforeEach(()=>{api={get:jasmine.createSpy().and.returnValue(of([]))};TestBed.configureTestingModule({providers:[CombatActionsStore,{provide:ApiService,useValue:api}]});store=TestBed.inject(CombatActionsStore);});
  afterEach(()=>store.stop());
  it('shows sending then queued and blocks only the same target',async()=>{
    let respond!:(value:any)=>void;
    const request=store.run('use_item',target,()=>new Promise(resolve=>respond=resolve));
    expect(store.item('food_test')?.phase).toBe('sending');
    await expectAsync(store.run('use_item',target,async()=>({}))).toBeRejected();
    expect(store.item('other')).toBeNull();
    respond({intent:{id:'a',status:'pending'}});await request;
    expect(store.item('food_test')?.phase).toBe('queued');
  });
  it('restores exact equipment and Gambit targets from server pending actions',async()=>{
    api.get.and.returnValue(of([{id:'a',kind:'equip',status:'pending',target:{itemId:'sword',inventoryItemId:'row',slot:'mainHand',slots:['mainHand','offHand']}},{id:'b',kind:'gambit_activate',status:'pending',target:{pageId:'page'}}]));
    await store.refresh();expect(store.slot('offHand')?.id).toBe('a');expect(store.item('sword','other')).toBeNull();expect(store.page('page','gambit_activate')?.id).toBe('b');
  });
  it('does not clear a terminal action until authoritative refresh finishes',async()=>{
    let synced!:()=>void;
    store.setSynchronizer(()=>new Promise<void>(resolve=>synced=resolve));
    await store.run('use_item',target,async()=>({intent:{id:'a',status:'pending'}}));
    api.get.and.returnValue(of([{id:'a',kind:'use_item',status:'applied',target}]));
    const refreshing=store.refresh();await Promise.resolve();
    expect(store.item('food_test')?.phase).toBe('confirming');synced();await refreshing;
    expect(store.item('food_test')).toBeNull();
  });
  it('preserves pending state when a partial result omits an action',async()=>{
    await store.run('use_item',target,async()=>({intent:{id:'a',status:'pending'}}));
    await store.refresh();expect(store.item('food_test')?.phase).toBe('queued');
  });
  it('keeps failure reasons local and permits retry without optimistic success',async()=>{
    await expectAsync(store.run('use_item',target,async()=>({intent:{id:'a',status:'failed',result:{message:'Food is still digesting'}}}))).toBeRejected();
    expect(store.item('food_test')?.phase).toBe('failed');expect(store.item('food_test')?.message).toContain('digesting');
    await store.run('use_item',target,async()=>({intent:{id:'b',status:'applied'}}));expect(store.item('food_test')).toBeNull();
  });
  it('uses the same request ID when recovering an uncertain HTTP response',async()=>{
    const ids:string[]=[];let fail=true;
    await expectAsync(store.run('use_item',target,async id=>{ids.push(id);if(fail)throw {status:0};return {intent:{id:'a',status:'pending'}}})).toBeRejected();
    expect(store.item('food_test')?.phase).toBe('confirming');fail=false;
    await store.recover();expect(ids.length).toBe(2);expect(ids[1]).toBe(ids[0]);expect(store.item('food_test')?.phase).toBe('queued');
  });
  it('never lets a late pending HTTP response regress a terminal socket result',async()=>{
    let resolve!:(value:any)=>void;
    const operation=store.run('use_item',target,()=>new Promise(r=>resolve=r));
    const requestId=store.item('food_test')!.clientRequestId;
    api.get.and.returnValue(of([{id:'a',clientRequestId:requestId,kind:'use_item',status:'applied',target}]));
    await store.refresh();resolve({intent:{id:'a',status:'pending'}});await operation;
    expect(store.item('food_test')).toBeNull();
  });
  it('ignores a stale pending GET after an applied HTTP acknowledgement',async()=>{
    const pending=new Subject<any[]>();api.get.and.returnValue(pending);
    let requestId='';
    const refreshing=store.refresh();
    await store.run('use_item',target,async id=>{requestId=id;return {intent:{id:'a',status:'applied'}}});
    pending.next([{id:'a',clientRequestId:requestId,kind:'use_item',status:'pending',target}]);pending.complete();await refreshing;
    expect(store.item('food_test')).toBeNull();
  });

  it('blocks conflicting page activations without blocking unrelated actions',async()=>{
    await store.run('gambit_activate',{pageId:'first'},async()=>({intent:{id:'activation',status:'pending'}}));
    expect(store.busy('gambit_activate',{pageId:'second'})).toBeTrue();
    expect(store.busy('use_item',{itemId:'food_test'})).toBeFalse();
    await expectAsync(store.run('gambit_activate',{pageId:'second'},async()=>({}))).toBeRejected();
  });

});
