import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { CharacterStore } from '../../core/game.store';
import { LocaleService } from '../../core/locale.service';
import { PartyStore } from '../../core/party.store';
import { UiClockService } from '../../core/ui-clock.service';

/** A group invitation addressed to me pops up over the game (oldest first) until I accept, decline or it expires. */
@Component({
  selector: 'app-party-invite-popup', standalone: true, imports: [CommonModule],
  template: `
    <div class="invite-popup" *ngIf="invite() as inv" role="alertdialog" aria-modal="false" [attr.aria-label]="locale.t('Group invitation')">
      <strong>{{locale.t('Group invitation')}}</strong>
      <p>{{ locale.t('{name} invites you to a group.').replace('{name}', inv.inviterName || inv.inviterId) }}</p>
      <small *ngIf="secondsLeft(inv) as s">{{s}}s</small>
      <div class="actions">
        <button type="button" class="accept" [disabled]="party.busy()" (click)="party.accept(inv.id)">{{locale.t('Accept')}}</button>
        <button type="button" [disabled]="party.busy()" (click)="party.cancelInvite(inv.id)">{{locale.t('Decline')}}</button>
      </div>
    </div>`,
  styles: [`:host{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:60;pointer-events:none}
    .invite-popup{pointer-events:auto;min-width:260px;max-width:min(360px,calc(100vw - 32px));box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:14px 16px;background:#17110d;border:1px solid #c4a568;box-shadow:0 8px 28px rgba(0,0,0,.6);color:#e3cfaa;font:13px/1.4 Arial;text-align:center}
    strong{color:#f6cf72;letter-spacing:1px;text-transform:uppercase;font-size:12px}p{margin:0}small{color:#a8926f}
    .actions{display:flex;gap:8px;justify-content:center}button{font:12px Arial;color:#e3cfaa;background:#241a11;border:1px solid #78603f;padding:6px 14px;border-radius:2px;cursor:pointer}
    button.accept{background:#554024;border-color:#c4a568}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid #d5b76e;outline-offset:2px}`],
})
export class PartyInvitePopupComponent {
  readonly party = inject(PartyStore);
  readonly character = inject(CharacterStore);
  readonly locale = inject(LocaleService);
  private readonly now = inject(UiClockService).now;
  readonly invite = computed(() => {
    const me = this.character.character()?.id;
    const now = this.now();
    return this.party.invites().find((i) => i.status === 'offered' && i.candidateId === me && Date.parse(i.expiresAt) > now) ?? null;
  });
  secondsLeft(invite: { expiresAt: string }): number { return Math.max(0, Math.ceil((Date.parse(invite.expiresAt) - this.now()) / 1000)); }
}
