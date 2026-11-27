import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CharacterStore } from '../../core/game.store';
import { LocaleService } from '../../core/locale.service';
import { PartyStore } from '../../core/party.store';
import { UiClockService } from '../../core/ui-clock.service';
import { PartyInvitePopupComponent } from './party-invite-popup.component';

describe('PartyInvitePopupComponent', () => {
  const now = Date.parse('2026-11-26T20:00:00Z');
  const invites = signal<any[]>([]);
  const store = { invites, busy: signal(false), accept: jasmine.createSpy('accept'), cancelInvite: jasmine.createSpy('cancelInvite') };
  const offer = (extra: any = {}) => ({ id: 'inv', inviterId: 'x', candidateId: 'hero', inviterName: 'Xena', status: 'offered', expiresAt: new Date(now + 45_000).toISOString(), mode: 'manual', ...extra });

  beforeEach(() => {
    invites.set([]);
    store.accept.calls.reset(); store.cancelInvite.calls.reset();
    TestBed.configureTestingModule({
      imports: [PartyInvitePopupComponent],
      providers: [
        { provide: PartyStore, useValue: store },
        { provide: CharacterStore, useValue: { character: () => ({ id: 'hero' }) } },
        { provide: LocaleService, useValue: { t: (v: string) => v } },
        { provide: UiClockService, useValue: { now: signal(now) } },
      ],
    });
  });

  function render() { const f = TestBed.createComponent(PartyInvitePopupComponent); f.detectChanges(); return f; }

  it('shows an offer addressed to me with accept and decline', () => {
    invites.set([offer()]);
    const f = render();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.invite-popup')?.textContent).toContain('Xena invites you to a group.');
    expect(el.textContent).toContain('45s');
    const [accept, decline] = Array.from(el.querySelectorAll('button')) as HTMLButtonElement[];
    accept.click(); decline.click();
    expect(store.accept).toHaveBeenCalledWith('inv');
    expect(store.cancelInvite).toHaveBeenCalledWith('inv');
  });

  it('shows nothing for invites I sent, accepted ones or expired offers', () => {
    invites.set([offer({ inviterId: 'hero', candidateId: 'y' }), offer({ status: 'accepted' }), offer({ expiresAt: new Date(now - 1).toISOString() })]);
    expect(render().nativeElement.querySelector('.invite-popup')).toBeNull();
  });
});
