import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { GameSocketService } from '../../core/game.socket.service';
import { ChatNoticeService } from '../../core/chat-notice.service';
import { CharacterStore } from '../../core/game.store';
import { LocaleService } from '../../core/locale.service';
import { TownStore } from '../../core/town.store';
import { CatalogService } from '../../core/catalog.service';
import { formatServerAnnounce } from '../../core/server-announce-text';

type ChatRow = {
  id: string;
  channel: 'global' | 'journal' | 'crafts' | 'market';
  message: string;
  sentAt: string;
  username?: string;
  characterId?: string;
  severity?: 'success' | 'error';
  /** `server_announce` (yellow, also on screen) or `event_find` (yellow, chat only). */
  type?: string;
  key?: string;
  params?: Record<string, unknown>;
};

@Component({
  selector: 'app-idle-chat',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './idle-chat.component.html',
  styleUrl: './idle-chat.component.css',
})
export class IdleChatComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('history') history?: ElementRef<HTMLDivElement>;
  readonly messages = signal<ChatRow[]>([]);
  readonly connectedUsersOnline = signal(0);
  readonly craftsEnabled = signal(localStorage.getItem('nanommo.chat.crafts.enabled') !== 'false');
  setCraftsEnabled(enabled: boolean): void { this.craftsEnabled.set(enabled); localStorage.setItem('nanommo.chat.crafts.enabled', String(enabled)); if (enabled) this.scrollToBottom(); }
  readonly journalEnabled = signal(localStorage.getItem('nanommo.chat.journal.enabled') !== 'false');
  readonly marketEnabled = signal(localStorage.getItem('nanommo.chat.market.enabled') !== 'false');
  setMarketEnabled(enabled: boolean): void { this.marketEnabled.set(enabled); localStorage.setItem('nanommo.chat.market.enabled', String(enabled)); if (enabled) this.scrollToBottom(); }
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly error = signal('');
  readonly fontSizeLevel = signal(Math.max(0, Math.min(2, Number(localStorage.getItem('nanommo.chat.font-size') ?? 0) || 0)));
  readonly visibleMessages = computed(() => this.messages()
    .filter(row => (row.channel !== 'journal' || this.journalEnabled()) && (row.channel !== 'crafts' || this.craftsEnabled()) && (row.channel !== 'market' || this.marketEnabled()))
    .slice(-40));
  private readonly subscriptions: Subscription[] = [];
  private wasAtBottom = true;
  private viewReady = false;
  private noticeSeq = 0;
  private readonly notices = inject(ChatNoticeService);
  private readonly town = inject(TownStore);
  private readonly characters = inject(CharacterStore);
  private readonly locale = inject(LocaleService);
  private readonly catalog = inject(CatalogService);

  constructor(private readonly api: ApiService, private readonly socket: GameSocketService) {}

  ngOnInit(): void {
    this.socket.connect();
    this.subscriptions.push(this.socket.on<ChatRow>('chat:message').subscribe(row => this.append(row)));
    this.subscriptions.push(this.socket.on<{ connectedUsersOnline: number }>('chat:connectedUsers').subscribe(payload => {
      const count = Number(payload?.connectedUsersOnline);
      if (Number.isFinite(count) && count >= 0) this.connectedUsersOnline.set(Math.floor(count));
    }));
    this.subscriptions.push(this.socket.on<ChatRow>('chat:journal').subscribe(row => this.append({ ...row, channel: 'journal' })));
    this.subscriptions.push(this.notices.notices$.subscribe(notice => this.appendLocalError(notice.message)));
    this.subscriptions.push(this.socket.on<{ candidateName?: string | null; reason?: string }>('party:inviteDeclined').subscribe(notice => {
      const text = notice?.reason === 'expired' ? '{name} did not answer the invite.' : '{name} declined the invite.';
      this.notices.error(this.locale.t(text).replace('{name}', notice?.candidateName || '?'));
    }));
    this.subscriptions.push(this.socket.onConnectionState().subscribe(state => {
      if (state === 'connected') void this.loadHistory();
    }));
    void this.loadHistory();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.scrollToBottom();
  }

  ngOnDestroy(): void { for (const subscription of this.subscriptions) subscription.unsubscribe(); }

  async loadHistory(): Promise<void> {
    const followBottom = this.wasAtBottom;
    const [globalResult, systemResult, craftResult, marketResult] = await Promise.all([
      this.api.get<ChatRow[]>('/chat/history/global?limit=40').toPromise()
        .then(rows => ({ rows: rows ?? [], error: '' }))
        .catch(() => ({ rows: [] as ChatRow[], error: 'Unable to load Global chat history.' })),
      this.api.get<ChatRow[]>('/chat/history/journal?limit=40').toPromise()
        .then(rows => ({ rows: rows ?? [], error: '' }))
        .catch(() => ({ rows: [] as ChatRow[], error: 'Unable to load System history.' })),
      this.api.get<ChatRow[]>('/chat/history/crafts?limit=40').toPromise().then(rows => ({ rows: rows ?? [], error: '' })).catch(() => ({ rows: [] as ChatRow[], error: 'Unable to load Crafts history.' })),
      this.api.get<ChatRow[]>('/chat/history/market?limit=40').toPromise().then(rows => ({ rows: rows ?? [], error: '' })).catch(() => ({ rows: [] as ChatRow[], error: 'Unable to load Market history.' })),
    ]);
    this.merge([
      ...globalResult.rows,
      ...craftResult.rows,
      ...marketResult.rows,
      ...systemResult.rows.map(row => ({ ...row, channel: 'journal' as const })),
    ]);
    this.error.set([globalResult.error, systemResult.error, craftResult.error, marketResult.error].filter(Boolean).join(' '));
    if (systemResult.rows.some(row => row.severity === 'error')) {
      this.setChannelEnabled('journal', true);
    } else if (followBottom) {
      this.scrollToBottom();
    }
  }

  changeFontSize(delta: number): void {
    const next = Math.max(0, Math.min(2, this.fontSizeLevel() + delta));
    this.fontSizeLevel.set(next);
    localStorage.setItem('nanommo.chat.font-size', String(next));
    this.scrollToBottom();
  }

  setJournalEnabled(enabled: boolean): void {
    this.setChannelEnabled('journal', enabled);
  }

  /** Shared activation behavior for channel toggles, so future channels follow the same UX. */
  private setChannelEnabled(channel: ChatRow['channel'], enabled: boolean): void {
    if (channel === 'journal') {
      this.journalEnabled.set(enabled);
      localStorage.setItem('nanommo.chat.journal.enabled', String(enabled));
    }
    if (enabled) this.scrollToBottom();
  }

  onScroll(): void {
    const el = this.history?.nativeElement;
    if (el) this.wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 8;
  }

  onDraftInput(event: Event): void { this.draft.set((event.target as HTMLInputElement).value); }

  async send(): Promise<void> {
    const text = this.draft().trim();
    if (!text || this.sending()) return;
    // Slash commands are local intents: they never reach the Global channel.
    if (text.startsWith('/')) { this.draft.set(''); await this.runCommand(text); return; }
    if (text.length > 200) { this.error.set('Messages may contain at most 200 characters.'); return; }
    if (!this.socket.connected) { this.error.set('Chat is disconnected; message was not sent.'); return; }
    this.sending.set(true);
    this.error.set('');
    try {
      const result: any = await this.socket.emit<any>('chat:send', { channel: 'global', message: text });
      if (result?.error || result?.success === false) throw new Error(String(result?.error ?? 'Message was rejected.'));
      const accepted: any = result?.message?.id ? result.message : result;
      if (!accepted?.id || accepted?.channel !== 'global' || typeof accepted?.message !== 'string' || !accepted?.sentAt) {
        throw new Error('The server did not confirm this message; it was not added to chat.');
      }
      this.append(accepted);
      this.draft.set('');
    } catch (error: any) {
      if (error?.message === 'PROHIBITED_CHAT_MESSAGE') {
        this.draft.set('');
        this.notices.error(this.locale.t('Wash your mouth out with soap!'));
      } else {
        this.error.set(error?.message ?? 'Message was not accepted.');
      }
    } finally {
      this.sending.set(false);
    }
  }

  private async runCommand(text: string): Promise<void> {
    const command = text.slice(1).trim().split(/\s+/)[0].toLowerCase();
    if (command !== 'sleep' && command !== 'dance' && command !== 'sit') { await this.runServerCommand(text); return; }
    const notInTown = command === 'sleep' ? 'You can only sleep in town.' : 'You can only do that in town.';
    if (!this.town.isTown(this.characters.character()?.currentMapId)) { this.notices.error(this.locale.t(notInTown)); return; }
    try {
      if (command === 'sleep') await this.town.sleep();
      else await this.town.emote(command);
    } catch (error: any) {
      const code = String(error?.message ?? '');
      this.notices.error(this.locale.t(code === 'NOT_IN_TOWN' ? notInTown : code || 'Unknown command.'));
    }
  }

  /**
   * Any other slash command goes to the server as a GM command. Accounts that are
   * not GMs (and unknown commands) get UNKNOWN_COMMAND, shown like before; a GM
   * sees the answer as a System line.
   */
  private async runServerCommand(text: string): Promise<void> {
    if (!this.socket.connected) { this.error.set('Chat is disconnected; message was not sent.'); return; }
    let reply: { success?: boolean; message?: string; error?: string } | null = null;
    try { reply = await this.socket.emit<any>('gm:command', { line: text }); } catch { reply = null; }
    if (reply?.success && typeof reply.message === 'string') { this.appendLocalNotice(reply.message); return; }
    const error = reply?.error;
    if (!error || error === 'UNKNOWN_COMMAND') { this.notices.error(this.locale.t('Unknown command.')); return; }
    this.appendLocalError(error);
  }

  /** A System line that is not an error (GM command answers); shown even if System was hidden. */
  private appendLocalNotice(message: string): void {
    this.append({ id: `local-notice-${Date.now()}-${++this.noticeSeq}`, channel: 'journal', severity: 'success', message, sentAt: new Date().toISOString() });
    if (!this.journalEnabled()) this.setChannelEnabled('journal', true);
    this.scrollToBottom();
  }

  private appendLocalError(message: string): void {
    this.append({ id: `local-notice-${Date.now()}-${++this.noticeSeq}`, channel: 'journal', severity: 'error', message, sentAt: new Date().toISOString() });
  }

  rowLabel(row: ChatRow): string { return row.username || 'Unknown'; }

  isAnnounce(row: ChatRow): boolean { return row.type === 'server_announce' || row.type === 'event_find'; }

  /** Server announcements are localized from their key; everything else shows as sent. */
  rowText(row: ChatRow): string {
    if (!row.key) return row.message;
    const mapName = (id: string) => this.catalog.mapList()?.find((m: any) => m?.id === id)?.name ?? id;
    return formatServerAnnounce(row, this.locale.locale(), (id) => this.catalog.itemName(id), mapName);
  }
  trackRow(_index: number, row: ChatRow): string { return row.id; }

  private append(row: ChatRow): void {
    if (!row || typeof row.message !== 'string' || !(['global', 'journal', 'crafts', 'market'] as string[]).includes(row.channel)) return;
    const follow = this.wasAtBottom;
    const isSystemError = row.channel === 'journal' && row.severity === 'error';
    this.merge([row]);
    if (isSystemError) {
      // Important System errors must be visible even when the user had hidden System
      // or scrolled up; activate the channel and bring the newest message into view.
      const wasEnabled = this.journalEnabled();
      this.setChannelEnabled('journal', true);
      if (wasEnabled) this.scrollToBottom();
    } else if (follow && this.viewReady) {
      this.scrollToBottom();
    }
  }

  private merge(rows: ChatRow[]): void {
    const all = new Map<string, ChatRow>();
    for (const row of [...this.messages(), ...rows]) {
      if (!row?.id || !row.sentAt || typeof row.message !== 'string') continue;
      const channel: ChatRow['channel'] = row.channel === 'journal' || row.channel === 'crafts' || row.channel === 'market' ? row.channel : 'global';
      all.set(row.id, { ...row, channel });
    }
    const merged = [...all.values()].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.id.localeCompare(b.id));
    const globalRows = merged.filter(row => row.channel === 'global').slice(-40);
    const journalRows = merged.filter(row => row.channel === 'journal').slice(-40);
    const craftRows = merged.filter(row => row.channel === 'crafts').slice(-40);
    const marketRows = merged.filter(row => row.channel === 'market').slice(-40);
    this.messages.set([...globalRows, ...journalRows, ...craftRows, ...marketRows].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.id.localeCompare(b.id)));
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      const el = this.history?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
        this.wasAtBottom = true;
      }
    });
  }
}
