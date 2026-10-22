import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { GameSocketService } from '../../core/game.socket.service';

type ChatRow = {
  id: string;
  channel: 'global' | 'journal';
  message: string;
  sentAt: string;
  username?: string;
  severity?: 'success' | 'error';
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
  readonly journalEnabled = signal(localStorage.getItem('nanommo.chat.journal.enabled') !== 'false');
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly error = signal('');
  readonly visibleMessages = computed(() => this.messages().filter(row => row.channel !== 'journal' || this.journalEnabled()));
  private readonly subscriptions: Subscription[] = [];
  private wasAtBottom = true;
  private viewReady = false;

  constructor(private readonly api: ApiService, private readonly socket: GameSocketService) {}

  ngOnInit(): void {
    this.socket.connect();
    this.subscriptions.push(this.socket.on<ChatRow>('chat:message').subscribe(row => this.append(row)));
    this.subscriptions.push(this.socket.on<ChatRow>('chat:journal').subscribe(row => this.append({ ...row, channel: 'journal' })));
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
    const [globalResult, systemResult] = await Promise.all([
      this.api.get<ChatRow[]>('/chat/history/global?limit=20').toPromise()
        .then(rows => ({ rows: rows ?? [], error: '' }))
        .catch(() => ({ rows: [] as ChatRow[], error: 'Unable to load Global chat history.' })),
      this.api.get<ChatRow[]>('/chat/history/journal?limit=20').toPromise()
        .then(rows => ({ rows: rows ?? [], error: '' }))
        .catch(() => ({ rows: [] as ChatRow[], error: 'Unable to load System history.' })),
    ]);
    this.merge([
      ...globalResult.rows,
      ...systemResult.rows.map(row => ({ ...row, channel: 'journal' as const })),
    ]);
    this.error.set([globalResult.error, systemResult.error].filter(Boolean).join(' '));
    if (followBottom) this.scrollToBottom();
  }

  setJournalEnabled(enabled: boolean): void {
    this.journalEnabled.set(enabled);
    localStorage.setItem('nanommo.chat.journal.enabled', String(enabled));
  }

  onScroll(): void {
    const el = this.history?.nativeElement;
    if (el) this.wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 8;
  }

  onDraftInput(event: Event): void { this.draft.set((event.target as HTMLInputElement).value); }

  async send(): Promise<void> {
    const text = this.draft().trim();
    if (!text || this.sending()) return;
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
      this.error.set(error?.message ?? 'Message was not accepted.');
    } finally {
      this.sending.set(false);
    }
  }

  rowLabel(row: ChatRow): string { return row.username || 'Unknown'; }
  trackRow(_index: number, row: ChatRow): string { return row.id; }

  private append(row: ChatRow): void {
    if (!row || typeof row.message !== 'string' || (row.channel !== 'global' && row.channel !== 'journal')) return;
    const follow = this.wasAtBottom;
    this.merge([row]);
    if (follow && this.viewReady) this.scrollToBottom();
  }

  private merge(rows: ChatRow[]): void {
    const all = new Map<string, ChatRow>();
    for (const row of [...this.messages(), ...rows]) {
      if (!row?.id || !row.sentAt || typeof row.message !== 'string') continue;
      const channel: 'global' | 'journal' = row.channel === 'journal' ? 'journal' : 'global';
      all.set(row.id, { ...row, channel });
    }
    const merged = [...all.values()].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.id.localeCompare(b.id));
    this.messages.set(merged.slice(-20));
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
