import { Injectable, computed, inject } from '@angular/core';
import { BattleStore, CharacterStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { PartyMember, PartyStore } from '../../core/party.store';
import { UiClockService } from '../../core/ui-clock.service';
import { isSharedBattleCurrent, sharedCurrentTarget } from '../../core/party-projection';
import { CombatTimer, persistentCombatTimers, sharedCombatTimers, soloCombatTimers } from '../../shared/combat-timers';

@Injectable({providedIn:'root'})
export class CombatTimersService {
  private readonly character = inject(CharacterStore);
  private readonly battle = inject(BattleStore);
  private readonly party = inject(PartyStore);
  private readonly catalog = inject(CatalogService);
  private readonly now = inject(UiClockService).now;
  private readonly definitions = computed(() => ({
    items:Object.fromEntries(this.catalog.items().map(item=>[item.id,item])),
    skills:Object.fromEntries(this.catalog.skills().map(skill=>[skill.id,skill])),
  }));
  readonly own = computed(() => {
    const now=this.now(), character=this.character.character(), shared=this.party.battle();
    if (shared && character && isSharedBattleCurrent(shared,now) && now>=Date.parse(shared.startAt)) return sharedCombatTimers(shared,character.id,now);
    const entry=this.battle.active();
    if (entry && now>=Date.parse(entry.startAt) && now<Date.parse(entry.endAt)) return soloCombatTimers(entry,'character',now,this.definitions());
    return persistentCombatTimers(character,now,this.definitions());
  });
  member(member: PartyMember): CombatTimer[] {
    const now=this.now(), battle=this.party.battle();
    if (battle && isSharedBattleCurrent(battle,now) && now>=Date.parse(battle.startAt)) return sharedCombatTimers(battle,member.characterId,now);
    return persistentCombatTimers(member,now,this.definitions());
  }
  target(entry: any): CombatTimer[] { return soloCombatTimers(entry,'monster',this.now(),this.definitions()); }
  readonly sharedTarget = computed(() => {
    const battle=this.party.battle(), id=this.character.character()?.id, now=this.now();
    if (!battle || !id || !isSharedBattleCurrent(battle,now)) return [];
    const target=sharedCurrentTarget(battle,id,now);
    return target ? sharedCombatTimers(battle,target,now) : [];
  });
}
