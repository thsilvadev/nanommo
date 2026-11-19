import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { TownRosterEntry } from '@nanommo/shared';
import { CatalogService } from '../../../core/catalog.service';
import { ChatNoticeService } from '../../../core/chat-notice.service';
import { CharacterStore } from '../../../core/game.store';
import { PartyStore } from '../../../core/party.store';
import { TownPlayerCardComponent } from './town-player-card.component';

const entry = (characterId: string, extra: Partial<TownRosterEntry> = {}): TownRosterEntry => ({
  characterId, name: characterId.toUpperCase(), level: 3, appearance: null, sex: 'male', heightCm: 180, seed: 1, online: true,
  sleeping: null, wakeFrom: null, lastSeenAt: '2026-11-18T00:00:00.000Z', ...extra,
});

describe('TownPlayerCardComponent', () => {
  let party: { members: ReturnType<typeof signal<any[]>>; invite: jasmine.Spy; lastErrorCode: ReturnType<typeof signal<string>>; error: ReturnType<typeof signal<string>> };
  let notices: ChatNoticeService;

  beforeEach(() => {
    try { localStorage.setItem('nanommo.locale', 'en-US'); } catch { /* ignore */ }
    party = { members: signal<any[]>([]), invite: jasmine.createSpy('invite').and.resolveTo(true), lastErrorCode: signal(''), error: signal('') };
    TestBed.configureTestingModule({
      imports: [TownPlayerCardComponent],
      providers: [
        { provide: PartyStore, useValue: party },
        { provide: CharacterStore, useValue: { character: signal({ id: 'hero' }) } },
        { provide: CatalogService, useValue: { item: (id: string) => (id === 'sword_1' ? { weaponType: 'sword' } : id === 'shield_1' ? { weaponType: 'shield' } : undefined) } },
      ],
    });
    notices = TestBed.inject(ChatNoticeService);
  });

  function render(target: TownRosterEntry) {
    const fixture = TestBed.createComponent(TownPlayerCardComponent);
    fixture.componentRef.setInput('entry', target);
    fixture.detectChanges();
    return fixture;
  }
  const items = (fixture: any): HTMLButtonElement[] => [...fixture.nativeElement.querySelectorAll('button.town-action')];
  const members = (...ids: string[]) => ids.map((characterId, orderIndex) => ({ characterId, orderIndex }));

  it('shows name and level', () => {
    const text = render(entry('ana', { level: 12 })).nativeElement.textContent;
    expect(text).toContain('ANA');
    expect(text).toContain('Lv 12');
  });

  it('maps hand gear to weapon types for the avatar', () => {
    const fixture = render(entry('ana', { mainHandItemId: 'sword_1', offHandItemId: 'shield_1', dominantHand: 'left' }));
    expect(fixture.componentInstance.hands()).toEqual({ main: 'sword', off: 'shield' });
  });

  it('offers "Invite to group" for another online player', () => {
    const fixture = render(entry('ana'));
    expect(items(fixture).map(b => b.textContent!.trim())).toEqual(['Invite to group']);
    expect(items(fixture)[0].disabled).toBeFalse();
  });

  it('target = me → no action', () => {
    expect(items(render(entry('hero'))).length).toBe(0);
  });

  it('target already in my group → no action', () => {
    party.members.set(members('hero', 'ana'));
    expect(items(render(entry('ana'))).length).toBe(0);
  });

  it('my group has 5 members → no action', () => {
    party.members.set(members('hero', 'a', 'b', 'c', 'd'));
    expect(items(render(entry('ana'))).length).toBe(0);
  });

  it('offline target → invite disabled with the "offline" hint', () => {
    const fixture = render(entry('ana', { online: false }));
    expect(items(fixture)[0].disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('offline');
  });

  it('invites through the PartyStore', async () => {
    const fixture = render(entry('ana'));
    items(fixture)[0].click();
    await fixture.whenStable();
    expect(party.invite).toHaveBeenCalledWith({ candidateId: 'ana' });
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
});
