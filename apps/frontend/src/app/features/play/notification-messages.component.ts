import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChatNoticeService } from '../../core/chat-notice.service';
import { GameSocketService } from '../../core/game.socket.service';
import { CatalogService } from '../../core/catalog.service';
import { LocaleService } from '../../core/locale.service';
import { formatServerAnnounce, type AnnounceRow } from '../../core/server-announce-text';

type Notice = { id: string; message: string; announce?: AnnounceRow };

@Component({
  selector: 'app-notification-messages',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="notification-messages" aria-live="polite" aria-relevant="additions">
      <div class="notification-stack upper-notifications">
        <div class="notification-message" *ngFor="let notice of upper()" [class.announce-message]="!!notice.announce" [attr.data-notice-id]="notice.id">{{text(notice)}}</div>
      </div>
      <div class="notification-stack lower-notifications">
        <div class="notification-message error-message" *ngFor="let notice of lower()" [attr.data-notice-id]="notice.id">{{notice.message}}</div>
      </div>
    </div>
  `,
  styles: [`
    :host{position:fixed;inset:0;z-index:2500;pointer-events:none}
    .notification-messages{position:absolute;top:27vh;left:50%;transform:translateX(-50%);width:min(680px,calc(100vw - 28px));display:flex;flex-direction:column;align-items:center;gap:10px}
    .notification-stack{display:flex;flex-direction:column;align-items:center;gap:7px;width:100%}
    .notification-message{box-sizing:border-box;max-width:100%;padding:9px 16px;border:1px solid #b68b4a;border-radius:3px;background:linear-gradient(180deg,#281d12f2,#110d0bf2);box-shadow:0 4px 18px #000c;color:#f1d79e;text-align:center;font:600 16px/1.35 Georgia,serif;text-shadow:0 1px 2px #000;overflow-wrap:anywhere;animation:notification-enter .18s ease-out}
    .announce-message{border-color:#c9a227;color:#ffe14d}
    .error-message{border-color:#a84c43;background:linear-gradient(180deg,#321613f5,#170c0bf5);color:#ff8e82}
    @keyframes notification-enter{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
    @media(max-width:600px){.notification-messages{top:21vh}.notification-message{font-size:14px;padding:8px 11px}}
  `],
})
export class NotificationMessagesComponent implements OnInit, OnDestroy {
  readonly upper = signal<Notice[]>([]);
  readonly lower = signal<Notice[]>([]);
  private readonly subscriptions: Subscription[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private sequence = 0;
  private announceActive = false;
  private readonly announceQueue: Notice[] = [];

  private readonly locale = inject(LocaleService);
  private readonly catalog = inject(CatalogService);

  constructor(private readonly socket: GameSocketService, private readonly chatNotices: ChatNoticeService) {}

  /** Announcements follow the current language (pt-BR / en-US); other notices show as sent. */
  text(notice: Notice): string {
    if (!notice.announce) return notice.message;
    const mapName = (id: string) => this.catalog.mapList()?.find((m: any) => m?.id === id)?.name ?? id;
    return formatServerAnnounce(notice.announce, this.locale.locale(), (id) => this.catalog.itemName(id), mapName);
  }

  ngOnInit(): void {
    this.subscriptions.push(this.socket.on<any>('chat:message').subscribe(row => {
      if (row?.type === 'server_announce') { this.queueAnnounce(row); return; }
      if (!this.announceActive && (row?.channel === 'crafts' || row?.channel === 'market')) this.pushUpper(String(row.id ?? `upper-${++this.sequence}`), row.message);
    }));
    this.subscriptions.push(this.socket.on<any>('chat:journal').subscribe(row => {
      if (row?.severity === 'error') this.pushLower(String(row.id ?? `lower-${++this.sequence}`), row.message);
    }));
    this.subscriptions.push(this.chatNotices.notices$.subscribe(notice => this.pushLower(`local-${++this.sequence}`, notice.message)));
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
  }

  private pushUpper(id: string, rawMessage: unknown): void { this.push(this.upper, id, rawMessage); }
  private pushLower(id: string, rawMessage: unknown): void { this.push(this.lower, id, rawMessage); }

  private queueAnnounce(row: any): void {
    if (typeof row.message !== 'string' || !row.message.trim()) return;
    this.announceQueue.push({ id: String(row.id ?? `announce-${++this.sequence}`), message: row.message, announce: { key: row.key, params: row.params, message: row.message } });
    this.showNextAnnounce();
  }

  private showNextAnnounce(): void {
    if (this.announceActive || !this.announceQueue.length) return;
    const notice = this.announceQueue.shift()!;
    this.announceActive = true;
    this.upper.set([notice]);
    const key = 'announce';
    this.timers.set(key, setTimeout(() => {
      this.upper.set([]);
      this.timers.delete(key);
      this.announceActive = false;
      this.showNextAnnounce();
    }, 10_000));
  }

  private push(target: typeof this.upper, id: string, rawMessage: unknown): void {
    const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';
    if (!message) return;
    const key = `${target === this.upper ? 'upper' : 'lower'}:${id}`;
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    target.update(rows => [...rows.filter(row => row.id !== id), { id, message }].slice(-4));
    this.timers.set(key, setTimeout(() => {
      target.update(rows => rows.filter(row => row.id !== id));
      this.timers.delete(key);
    }, 10_000));
  }
}
