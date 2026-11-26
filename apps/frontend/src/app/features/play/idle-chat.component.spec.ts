import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ChatNoticeService } from '../../core/chat-notice.service';
import { GameSocketService } from '../../core/game.socket.service';
import { CharacterStore } from '../../core/game.store';
import { LocaleService } from '../../core/locale.service';
import { TownStore } from '../../core/town.store';
import { IdleChatComponent } from './idle-chat.component';

describe('IdleChatComponent slash commands', () => {
  let socket: any;
  let events: Map<string, Subject<any>>;
  let town: jasmine.SpyObj<TownStore>;
  let character: ReturnType<typeof signal<any>>;

  function create() {
    const fixture = TestBed.createComponent(IdleChatComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    try { localStorage.setItem('nanommo.locale', 'en-US'); } catch { /* ignore */ }
    events = new Map();
    socket = {
      connected: true,
      connect: () => {},
      on: (event: string) => { const s = new Subject(); events.set(event, s); return s; },
      onConnectionState: () => new Subject(),
      emit: jasmine.createSpy('emit').and.resolveTo({}),
    };
    town = jasmine.createSpyObj('TownStore', ['isTown', 'sleep', 'emote']);
    town.sleep.and.resolveTo();
    town.emote.and.resolveTo();
    character = signal<any>({ id: 'hero', currentMapId: 'map_town' });
    TestBed.configureTestingModule({
      imports: [IdleChatComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of([]) } },
        { provide: GameSocketService, useValue: socket },
        { provide: TownStore, useValue: town },
        { provide: CharacterStore, useValue: { character } },
      ],
    });
  });

  // setLocale persists to localStorage; never leak pt-BR into other specs.
  afterEach(() => {
    try { localStorage.setItem('nanommo.locale', 'en-US'); } catch { /* ignore */ }
    TestBed.inject(LocaleService).setLocale('en-US');
  });

  const errorRows = (chat: IdleChatComponent) => chat.messages().filter(r => r.channel === 'journal' && r.severity === 'error');

  it('/sleep in town calls TownStore.sleep and never sends to global chat', async () => {
    town.isTown.and.returnValue(true);
    const chat = create();
    chat.draft.set('/sleep');
    await chat.send();
    expect(town.isTown).toHaveBeenCalledWith('map_town');
    expect(town.sleep).toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalledWith('chat:send', jasmine.anything());
    expect(chat.draft()).toBe('');
    expect(errorRows(chat).length).toBe(0);
  });

  it('/sleep outside town adds a red System line and enables the journal', async () => {
    town.isTown.and.returnValue(false);
    const chat = create();
    chat.journalEnabled.set(false);
    chat.draft.set('/sleep');
    await chat.send();
    expect(town.sleep).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(errorRows(chat).map(r => r.message)).toEqual(['You can only sleep in town.']);
    expect(chat.journalEnabled()).toBeTrue();
  });

  it('/dance and /sit in town ask TownStore for the emote, never global chat', async () => {
    town.isTown.and.returnValue(true);
    const chat = create();
    chat.draft.set('/dance');
    await chat.send();
    chat.draft.set('/SIT');
    await chat.send();
    expect(town.emote.calls.allArgs()).toEqual([['dance'], ['sit']]);
    expect(socket.emit).not.toHaveBeenCalledWith('chat:send', jasmine.anything());
    expect(errorRows(chat).length).toBe(0);
  });

  it('/dance outside town is refused with a red System line', async () => {
    town.isTown.and.returnValue(false);
    const chat = create();
    chat.draft.set('/dance');
    await chat.send();
    expect(town.emote).not.toHaveBeenCalled();
    expect(errorRows(chat).map(r => r.message)).toEqual(['You can only do that in town.']);
  });

  it('an unknown command asks the server (GM commands) and shows "Unknown command." when it is not one', async () => {
    socket.emit.and.resolveTo({ success: false, error: 'UNKNOWN_COMMAND' });
    const chat = create();
    chat.draft.set('/xyz');
    await chat.send();
    expect(socket.emit).toHaveBeenCalledOnceWith('gm:command', { line: '/xyz' });
    expect(errorRows(chat).map(r => r.message)).toEqual(['Unknown command.']);
    expect(chat.draft()).toBe('');
  });

  it('a GM command answer shows as a System line, never in global chat', async () => {
    socket.emit.and.resolveTo({ success: true, message: 'Smashing Spree starts in 20 min.' });
    const chat = create();
    chat.setJournalEnabled(false);
    chat.draft.set('/start-event smashing-spree 20');
    await chat.send();
    expect(socket.emit).toHaveBeenCalledOnceWith('gm:command', { line: '/start-event smashing-spree 20' });
    const rows = chat.messages().filter(r => r.channel === 'journal' && r.severity === 'success');
    expect(rows.map(r => r.message)).toEqual(['Smashing Spree starts in 20 min.']);
    expect(chat.journalEnabled()).toBeTrue();
  });

  it('a rejected GM command shows its error and usage in red', async () => {
    socket.emit.and.resolveTo({ success: false, error: '/start-event: Unknown event code.\nUsage: /start-event <event-code> <minutesToEvent>' });
    const chat = create();
    chat.draft.set('/start-event party 5');
    await chat.send();
    expect(errorRows(chat).map(r => r.message)).toEqual(['/start-event: Unknown event code.\nUsage: /start-event <event-code> <minutesToEvent>']);
  });

  it('ChatNoticeService errors become red System lines', () => {
    const chat = create();
    TestBed.inject(ChatNoticeService).error('The character is already in a group.');
    expect(errorRows(chat).map(r => r.message)).toEqual(['The character is already in a group.']);
  });

  it('party:inviteDeclined shows the decline or the timeout, localized', () => {
    TestBed.inject(LocaleService).setLocale('pt-BR');
    const chat = create();
    events.get('party:inviteDeclined')!.next({ inviteId: 'i1', candidateId: 'c', candidateName: 'Ana', reason: 'declined' });
    events.get('party:inviteDeclined')!.next({ inviteId: 'i2', candidateId: 'c', candidateName: 'Bia', reason: 'expired' });
    expect(errorRows(chat).map(r => r.message)).toEqual(['Ana recusou o convite.', 'Bia não respondeu ao convite.']);
  });

  it('plain text still goes to global chat', async () => {
    socket.emit.and.resolveTo({ id: 'm1', channel: 'global', message: 'hi', sentAt: new Date().toISOString() });
    const chat = create();
    chat.draft.set('hi');
    await chat.send();
    expect(socket.emit).toHaveBeenCalledWith('chat:send', { channel: 'global', message: 'hi' });
  });
});
