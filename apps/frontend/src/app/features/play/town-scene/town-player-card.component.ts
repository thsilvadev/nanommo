import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { TownRosterEntry, VisibleEquipment } from '@nanommo/shared';
import { CatalogService } from '../../../core/catalog.service';
import { ChatNoticeService } from '../../../core/chat-notice.service';
import { CharacterStore } from '../../../core/game.store';
import { LocaleService } from '../../../core/locale.service';
import { PartyStore } from '../../../core/party.store';
import { CharacterViewerComponent } from '../../../shared/character-viewer/character-viewer.component';
import type { AnimationState } from '../../../shared/character-animation/animation-state';
import { portraitHandTypes, portraitModel } from '../character-portrait';

/** Current party size limit (server: party_members.orderIndex 0..4). */
export const TOWN_PARTY_LIMIT = 5;
const IDLE: AnimationState = { base: 'Idle' };

/**
 * Another player selected in the town scene, shown in the grind panel under the
 * NPC selector: idle 3D avatar (wearing its hand gear), name, level and actions.
 */
@Component({
  selector: 'app-town-player-card',
  standalone: true,
  imports: [CharacterViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="town-player-card" [attr.aria-label]="entry().name">
      <div class="town-player-avatar">
        @if (model(); as m) {
          @if (!viewerFailed()) {
            <app-character-viewer [sex]="m.sex" [heightCm]="m.heightCm" [appearance]="m.appearance" [dominantHand]="m.dominantHand"
              [mainHandType]="hands().main" [offHandType]="hands().off" [equipment]="equipment()" framing="full" [animation]="idle"
              [attr.aria-label]="entry().name" (failed)="viewerFailed.set(true)" />
          } @else { <span class="town-player-initial">{{ initial() }}</span> }
        } @else { <span class="town-player-initial">{{ initial() }}</span> }
      </div>
      <div class="town-player-title">
        <strong>{{ entry().name }}</strong>
        <span>Lv {{ entry().level }}{{ entry().online ? '' : ' · ' + locale.t('offline') }}</span>
      </div>
      <div class="town-player-actions">
        @if (canOfferInvite()) {
          <button type="button" class="town-action" [disabled]="!entry().online || busy()" [attr.title]="entry().online ? null : locale.t('offline')" (click)="invite()">
            {{ locale.t('Invite to group') }}
          </button>
        }
      </div>
    </section>`,
  styles: [`
    :host { display: block; }
    .town-player-card { display: flex; flex-direction: column; gap: 8px; }
    .town-player-avatar { position: relative; width: 167px; height: 199px; max-width: 100%; margin: 2px auto 0; display: grid; place-items: center; }
    .town-player-avatar app-character-viewer { position: absolute; inset: 0; }
    .town-player-initial { font: 64px Georgia; color: #6f5d49; }
    .town-player-title { display: flex; flex-direction: column; align-items: center; border-bottom: 1px solid #38281b; padding-bottom: 8px; }
    .town-player-title strong { color: #dfcfb3; font: 38px Georgia; }
    .town-player-title span { color: #7b6a56; font: 16px Arial; letter-spacing: 1px; }
    .town-player-actions { display: flex; flex-direction: column; gap: 6px; }
    .town-action { width: 100%; padding: 8px 10px; background: #100c09; border: 1px solid #493521; color: #d2ba86; font: 20px Arial; cursor: pointer; min-height: var(--nm-control-h); }
    .town-action:hover:not(:disabled) { border-color: #8a6a3e; color: #f0dcae; }
    .town-action:disabled { opacity: 0.45; cursor: not-allowed; }
  `],
})
export class TownPlayerCardComponent {
  readonly entry = input.required<TownRosterEntry>();

  readonly locale = inject(LocaleService);
  private readonly party = inject(PartyStore);
  private readonly characters = inject(CharacterStore);
  private readonly notices = inject(ChatNoticeService);
  private readonly catalog = inject(CatalogService);
  readonly busy = signal(false);
  readonly viewerFailed = signal(false);
  readonly idle = IDLE;

  readonly model = computed(() => {
    const e = this.entry();
    return portraitModel({ sex: e.sex, heightCm: e.heightCm, appearance: e.appearance, dominantHand: e.dominantHand ?? 'right' });
  });
  /** What the selected player wears (older servers only send the two hand items). */
  readonly equipment = computed<VisibleEquipment>(() => {
    const e = this.entry();
    return e.equipment ?? { ...(e.mainHandItemId ? { mainHand: e.mainHandItemId } : {}), ...(e.offHandItemId ? { offHand: e.offHandItemId } : {}) };
  });
  readonly hands = computed(() => {
    const e = this.entry();
    const equipment = [
      ...(e.mainHandItemId ? [{ slot: 'mainHand', itemId: e.mainHandItemId }] : []),
      ...(e.offHandItemId ? [{ slot: 'offHand', itemId: e.offHandItemId }] : []),
    ];
    return portraitHandTypes(equipment, (id) => this.catalog.item?.(id) as { weaponType?: string } | undefined);
  });
  initial(): string { return (this.entry().name || '?').slice(0, 1).toUpperCase(); }

  /** Same rules as before: hidden for myself, for someone already in my group, and when my group is full. */
  readonly canOfferInvite = computed(() => {
    const target = this.entry().characterId;
    const members = this.party.members() ?? [];
    if (target === this.characters.character()?.id) return false;
    if (members.some((m: { characterId: string }) => m.characterId === target)) return false;
    return members.length < TOWN_PARTY_LIMIT;
  });

  async invite(): Promise<void> {
    if (this.busy() || !this.entry().online) return;
    this.busy.set(true);
    try {
      const ok = await this.party.invite({ candidateId: this.entry().characterId });
      if (!ok) {
        const code = this.party.lastErrorCode();
        if (code === 'CANDIDATE_ALREADY_IN_PARTY') this.notices.error(this.locale.t('The character is already in a group.'));
        else this.notices.error(this.locale.t(code || this.party.error() || 'Unable to update group.'));
      }
    } finally {
      this.busy.set(false);
    }
  }
}
