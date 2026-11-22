import { CombatTimersComponent } from './combat-timers.component';
import { CombatTimersService } from './combat-timers.service';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { CharacterStore } from '../../core/game.store';
import { LocaleService } from '../../core/locale.service';
import { PartyMember, PartyStore } from '../../core/party.store';
import { sharedActorResources, sharedActorStatuses, isSharedBattleCurrent } from '../../core/party-projection';
import { CharacterSummary } from './components';
import { UiClockService } from '../../core/ui-clock.service';

@Component({
  selector: 'app-party-panel', standalone: true, imports: [CommonModule, CharacterSummary, CombatTimersComponent],
  templateUrl: './party-panel.component.html', styleUrl: './party-panel.component.css',
})
export class PartyPanelComponent {
  readonly timers = inject(CombatTimersService);
  readonly party = inject(PartyStore);
  readonly character = inject(CharacterStore);
  readonly locale = inject(LocaleService);
  readonly tab = signal<'character'|'group'>('group');
  readonly now = inject(UiClockService).now;
  trackIndex(index: number) { return index; }
  readonly isLeader = computed(() => this.party.party()?.leaderCharacterId === this.character.character()?.id);
  readonly ownMember = computed(() => this.party.members().find(member => member.characterId === this.character.character()?.id));
  readonly activeInvites = computed(() => this.party.invites().filter(invite => ['offered','accepted'].includes(invite.status)));
  resources(member: PartyMember) {
    const battle = this.party.battle();
    const projected=battle && isSharedBattleCurrent(battle,this.now()) ? sharedActorResources(battle, member.characterId, this.now()):null;
    return projected ?? {hp:member.hp ?? 0, sp:member.sp ?? 0};
  }
  statuses(member: PartyMember) { const battle=this.party.battle();return battle && isSharedBattleCurrent(battle,this.now())?sharedActorStatuses(battle,member.characterId,this.now()):member.statusEffects??[]; }
  percent(value: number, max?: number): number { return max ? Math.max(0,Math.min(100,value/max*100)) : 0; }
  move(member: PartyMember, delta: number): void {
    const members=this.party.members(), index=members.findIndex(value => value.characterId===member.characterId), next=index+delta;
    if(!this.isLeader() || next<0 || next>=members.length) return;
    [members[index],members[next]]=[members[next],members[index]];
    void this.party.reorder(members.map(value => value.characterId));
  }
}
