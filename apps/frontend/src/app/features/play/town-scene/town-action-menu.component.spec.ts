import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { TownRosterEntry } from '@nanommo/shared';
import { ChatNoticeService } from '../../../core/chat-notice.service';
import { CharacterStore } from '../../../core/game.store';
import { PartyStore } from '../../../core/party.store';
import { TownActionMenuComponent } from './town-action-menu.component';

const entry = (characterId: string, extra: Partial<TownRosterEntry> = {}): TownRosterEntry => ({
  characterId, name: characterId.toUpperCase(), level: 3, appearance: null, sex: 'male', heightCm: 180, seed: 1, online: true,
  sleeping: null, wakeFrom: null, lastSeenAt: '2026-11-18T00:00:00.000Z', ...extra,
});

describe('TownActionMenuComponent', () => {
  let party: { members: ReturnType<typeof signal<any[]>>; invite: jasmine.Spy; lastErrorCode: ReturnType<typeof signal<string>>; error: ReturnType<typeof signal<string>> };
  let notices: ChatNoticeService;

  beforeEach(() => {
    try { localStorage.setItem('nanommo.locale', 'en-US'); } catch { /* ignore */ }
    party = { members: signal<any[]>([]), invite: jasmine.createSpy('invite').and.resolveTo(true), lastErrorCode: signal(''), error: signal('') };
    TestBed.configureTestingModule({
      imports: [TownActionMenuComponent],
      providers: [
        { provide: PartyStore, useValue: party },
        { provide: CharacterStore, useValue: { character: signal({ id: 'hero' }) } },
      ],
    });
    notices = TestBed.inject(ChatNoticeService);
  });

  function render(target: TownRosterEntry) {
    const fixture = TestBed.createComponent(TownActionMenuComponent);
    fixture.componentRef.setInput('entry', target);
    fixture.componentRef.setInput('screen', [120, 80]);
    fixture.detectChanges();
    return fixture;
  }
  const items = (fixture: any): HTMLButtonElement[] => [...fixture.nativeElement.querySelectorAll('button.town-action')];
  const members = (...ids: string[]) => ids.map((characterId, orderIndex) => ({ characterId, orderIndex }));

  it('offers "Invite to group" for another online player', () => {
    const fixture = render(entry('ana'));
    expect(items(fixture).map(b => b.textContent!.trim())).toEqual(['Invite to group']);
    expect(items(fixture)[0].disabled).toBeFalse();
  });

  it('target = me → no item', () => {
    expect(items(render(entry('hero'))).length).toBe(0);
  });

  it('target already in my group → no item', () => {
    party.members.set(members('hero', 'ana'));
    expect(items(render(entry('ana'))).length).toBe(0);
  });

  it('my group has 5 members → no item', () => {
    party.members.set(members('hero', 'a', 'b', 'c', 'd'));
    expect(items(render(entry('ana'))).length).toBe(0);
  });

  it('offline target → item disabled with the "offline" hint', () => {
    const fixture = render(entry('ana', { online: false }));
    const [button] = items(fixture);
    expect(button.disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('offline');
  });

  it('invites through the PartyStore and closes', async () => {
    const fixture = render(entry('ana'));
    const closed = jasmine.createSpy('closed');
    fixture.componentInstance.closed.subscribe(closed);
    items(fixture)[0].click();
    await fixture.whenStable();
    expect(party.invite).toHaveBeenCalledWith({ candidateId: 'ana' });
    expect(closed).toHaveBeenCalled();
  });

  it('CANDIDATE_ALREADY_IN_PARTY → red chat line "The character is already in a group."', async () => {
    party.invite.and.callFake(async () => { party.lastErrorCode.set('CANDIDATE_ALREADY_IN_PARTY'); party.error.set('CANDIDATE ALREADY IN PARTY'); return false; });
    const spy = spyOn(notices, 'error');
    const fixture = render(entry('ana'));
    items(fixture)[0].click();
    await fixture.whenStable();
    expect(spy).toHaveBeenCalledWith('The character is already in a group.');
  });

  it('another error → red chat line with the mapped message', async () => {
    party.invite.and.callFake(async () => { party.lastErrorCode.set('PARTY_SAME_MAP_REQUIRED'); return false; });
    const spy = spyOn(notices, 'error');
    const fixture = render(entry('ana'));
    items(fixture)[0].click();
    await fixture.whenStable();
    expect(spy).toHaveBeenCalledWith('Both characters must be on the same map.');
  });

  it('Esc and a click outside close the menu', () => {
    const fixture = render(entry('ana'));
    const closed = jasmine.createSpy('closed');
    fixture.componentInstance.closed.subscribe(closed);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveBeenCalledTimes(1);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(closed).toHaveBeenCalledTimes(2);
    fixture.nativeElement.querySelector('.town-action-menu').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(closed).toHaveBeenCalledTimes(2);
  });
});
