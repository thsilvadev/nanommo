import { signal } from '@angular/core';
import { CharacterSummary } from './components';
import { SharedBattleView } from '../../core/party-projection';

describe('Character Summary shared projection', () => {
  it('uses the visible shared actor state before persisted character resources', () => {
    const start=Date.parse('2026-11-17T12:00:00Z');
    const battle:SharedBattleView={id:'battle',revision:1,state:'started',startAt:new Date(start).toISOString(),endAt:new Date(start+10000).toISOString(),snapshot:{actors:[{id:'hero',kind:'character',team:'a',snapshot:{hp:90,sp:40,maxHp:100,maxSp:50}}]},log:{events:[{tick:1,actorId:'hero',targetIds:[],action:'use_skill',actorStates:{hero:{hp:65,sp:25}},payload:{type:'action'}}]}};
    const summary:any=Object.create(CharacterSummary.prototype);
    Object.assign(summary,{party:{battle:()=>battle},character:{character:()=>({id:'hero',hpCurrent:90,spCurrent:40})},battle:{currentBattleCharacterResources:()=>null},battleDisplayNow:signal(start+500)});
    expect(summary.displayHp()).toBe(65);expect(summary.displaySp()).toBe(25);
    summary.battleDisplayNow.set(start+10000);
    expect(summary.displayHp()).toBe(90);expect(summary.displaySp()).toBe(40);
  });
  it('shows shared actor status events at their authoritative visible tick', () => {
    const start=Date.parse('2026-11-17T12:00:00Z');
    const battle:SharedBattleView={id:'battle',revision:1,state:'started',startAt:new Date(start).toISOString(),endAt:new Date(start+10000).toISOString(),snapshot:{actors:[{id:'hero',kind:'character',team:'a',snapshot:{hp:90,sp:40,maxHp:100,maxSp:50,statusEffects:[]}}]},log:{events:[{tick:1,actorId:'hero',targetIds:[],action:'status_applied',actorStates:{hero:{hp:90,sp:40,statusEffects:[{type:'poison'}]}},payload:{type:'status'}}]}};
    const summary:any=Object.create(CharacterSummary.prototype);
    Object.assign(summary,{party:{battle:()=>battle},character:{character:()=>({id:'hero'})},catalog:{statusEffect:()=>({name:'Poison',maxStacks:1})},battle:{active:()=>null},battleDisplayNow:signal(start)});
    expect(summary.activeStatusEffects()).toEqual([]);
    summary.battleDisplayNow.set(start+500);
    expect(summary.activeStatusEffects().map((status:any)=>status.id)).toEqual(['poison']);
  });
});
