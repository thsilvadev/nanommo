import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Output, computed, inject, input, signal } from '@angular/core';
import type { TownRosterEntry } from '@nanommo/shared';
import { ChatNoticeService } from '../../../core/chat-notice.service';
import { CharacterStore } from '../../../core/game.store';
import { LocaleService } from '../../../core/locale.service';
import { PartyStore } from '../../../core/party.store';

/** Current party size limit (server: party_members.orderIndex 0..4). */
export const TOWN_PARTY_LIMIT = 5;

/** Action menu opened by clicking another character in the town scene. */
@Component({
  selector: 'app-town-action-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="town-action-menu" role="menu" [attr.aria-label]="entry().name" [style.left.px]="screen()[0]" [style.top.px]="screen()[1]">
      <header>{{ entry().name }} <small>Lv {{ entry().level }}</small></header>
      @if (canOfferInvite()) {
        <button type="button" role="menuitem" class="town-action" [disabled]="!entry().online || busy()" [attr.title]="entry().online ? null : locale.t('offline')" (click)="invite()">
          {{ locale.t('Invite to group') }}
        </button>
        @if (!entry().online) { <small class="hint">{{ locale.t('offline') }}</small> }
      }
    </div>`,
  styles: [`
    :host { position: absolute; inset: 0; pointer-events: none; z-index: 8; }
    .town-action-menu { position: absolute; transform: translate(12px, -50%); min-width: 170px; pointer-events: auto; display: flex; flex-direction: column; gap: 4px; padding: 8px; border-radius: 8px; background: rgba(18, 14, 26, 0.94); color: #f4ead8; box-shadow: 0 0 0 1px rgba(255, 225, 160, 0.3), 0 8px 22px rgba(0, 0, 0, 0.55); font-size: 13px; }
    header { font-weight: 600; padding: 2px 4px 6px; border-bottom: 1px solid rgba(255, 225, 160, 0.18); }
    header small { opacity: 0.7; font-weight: 400; margin-left: 4px; }
    .town-action { text-align: left; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
    .town-action:hover:not(:disabled) { background: rgba(217, 164, 65, 0.22); }
    .town-action:disabled { opacity: 0.45; cursor: not-allowed; }
    .hint { padding: 0 8px 2px; opacity: 0.7; }
  `],
})
export class TownActionMenuComponent {
  readonly entry = input.required<TownRosterEntry>();
  /** Anchor point, in pixels inside the town scene. */
  readonly screen = input.required<[number, number]>();
  @Output() readonly closed = new EventEmitter<void>();

  readonly locale = inject(LocaleService);
  private readonly party = inject(PartyStore);
  private readonly characters = inject(CharacterStore);
  private readonly notices = inject(ChatNoticeService);
  private readonly element = inject(ElementRef<HTMLElement>);
  readonly busy = signal(false);

  /** Hidden for myself, for someone already in my group, and when my group is full. */
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
      this.closed.emit();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.closed.emit(); }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: Event): void {
    const menu = (this.element.nativeElement as HTMLElement).querySelector('.town-action-menu');
    if (menu && event.target instanceof Node && menu.contains(event.target)) return;
    this.closed.emit();
  }
}
