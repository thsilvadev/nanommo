import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { CharacterStore } from '../../core/game.store';
import { LocaleService } from '../../core/locale.service';
import { PartyMember, PartyStore } from '../../core/party.store';
import { sharedActorResources, sharedActorStatuses, isSharedBattleCurrent } from '../../core/party-projection';
import { CharacterSummary } from './components';

@Component({
  selector: 'app-party-panel', standalone: true, imports: [CommonModule, CharacterSummary],
  templateUrl: './party-panel.component.html', styleUrl: './party-panel.component.css',
})
export class PartyPanelComponent implements OnDestroy {
  readonly party = inject(PartyStore);
  readonly character = inject(CharacterStore);
  readonly locale = inject(LocaleService);
  readonly tab = signal<'character'|'group'>('group');
  readonly candidate = signal('');
  readonly now = signal(Date.now());
  private readonly timer = setInterval(() => this.now.set(Date.now()), 250);
  readonly isLeader = computed(() => this.party.party()?.leaderCharacterId === this.character.character()?.id);
  readonly ownMember = computed(() => this.party.members().find(member => member.characterId === this.character.character()?.id));
  readonly activeInvites = computed(() => this.party.invites().filter(invite => ['offered','accepted'].includes(invite.status)));
  readonly visibleActions = computed(() => this.party.actions().slice(0,10));
  resources(member: PartyMember) {
    const battle = this.party.battle();
    const projected=battle && isSharedBattleCurrent(battle,this.now()) ? sharedActorResources(battle, member.characterId, this.now()):null;
    return projected ?? {hp:member.hp ?? 0, sp:member.sp ?? 0};
  }
  statuses(member: PartyMember) { const battle=this.party.battle();return battle && isSharedBattleCurrent(battle,this.now())?sharedActorStatuses(battle,member.characterId,this.now()):member.statusEffects??[]; }
  percent(value: number, max?: number): number { return max ? Math.max(0,Math.min(100,value/max*100)) : 0; }
  async invite(): Promise<void> { const name=this.candidate().trim(); if(name && await this.party.invite({candidateName:name})) this.candidate.set(''); }
  move(member: PartyMember, delta: number): void {
    const members=this.party.members(), index=members.findIndex(value => value.characterId===member.characterId), next=index+delta;
    if(!this.isLeader() || next<0 || next>=members.length) return;
    [members[index],members[next]]=[members[next],members[index]];
    void this.party.reorder(members.map(value => value.characterId));
  }
  ngOnDestroy(): void { clearInterval(this.timer); }
}
