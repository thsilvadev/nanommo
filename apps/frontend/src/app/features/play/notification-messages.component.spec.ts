import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { GameSocketService } from '../../core/game.socket.service';
import { ChatNoticeService } from '../../core/chat-notice.service';
import { LocaleService } from '../../core/locale.service';
import { CatalogService } from '../../core/catalog.service';
import { NotificationMessagesComponent } from './notification-messages.component';

describe('NotificationMessagesComponent server announcements', () => {
  let events: Map<string, Subject<any>>;
  let locale: LocaleService;

  beforeEach(() => {
    events = new Map();
    const socket = { on: (event: string) => { if (!events.has(event)) events.set(event, new Subject()); return events.get(event)!; } };
    TestBed.configureTestingModule({
      imports: [NotificationMessagesComponent],
      providers: [
        { provide: GameSocketService, useValue: socket },
        { provide: ChatNoticeService, useValue: { notices$: new Subject() } },
        { provide: CatalogService, useValue: { itemName: (id: string) => id, mapList: () => [] } },
      ],
    });
    locale = TestBed.inject(LocaleService);
  });

  afterEach(() => { try { localStorage.removeItem('nanommo.chat.journal.enabled'); } catch { /* storage may be blocked */ } });

  it('shows a yellow, localized announcement even when the chat System channel is hidden', () => {
    localStorage.setItem('nanommo.chat.journal.enabled', 'false');
    locale.setLocale('pt-BR');
    const fixture = TestBed.createComponent(NotificationMessagesComponent);
    fixture.detectChanges();
    events.get('chat:message')!.next({ id: 'server:1', channel: 'journal', type: 'server_announce', key: 'event.smashingSpree.soon', params: { minutes: 5 }, message: 'The Smashing Spree starts in 5 minutes! Head to any town.' });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('.announce-message');
    expect(el).not.toBeNull();
    expect(el.textContent!.trim()).toBe('O Quebra-Quebra começa em 5 minutos! Vá para qualquer cidade.');
    expect(getComputedStyle(el).color).toBe('rgb(255, 225, 77)');
    locale.setLocale('en-US');
    fixture.destroy();
  });

  it('a gem find line is chat-only (no popup)', () => {
    const fixture = TestBed.createComponent(NotificationMessagesComponent);
    fixture.detectChanges();
    events.get('chat:message')!.next({ id: 'event-find:1', channel: 'journal', type: 'event_find', key: 'event.smashingSpree.found', params: { name: 'A', itemId: 'x', mapId: 'y' }, message: 'A found x in y!' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.notification-message').length).toBe(0);
    fixture.destroy();
  });
});
