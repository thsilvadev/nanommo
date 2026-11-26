import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, firstValueFrom } from 'rxjs';
import { CharacterStore } from './game.store';
import { ApiService } from './api.service';
import { GameSocketService } from './game.socket.service';
import { SharedBattleView } from './party-projection';
export interface PartyMember { characterId: string; name: string; orderIndex: number; pendingLeave: boolean; hp?: number; sp?: number; maxHp?: number; maxSp?: number; consumableCooldowns?:Record<string,string>; cooldownDurations?:Record<string,number>; statusEffects?: Array<{id?:string;type?:string;stacks?:number;expiresAt?:string;expiresAtTick?:number}>; /** How the member looks (battle arena); null without an appearance. */ look?: import('../features/play/arena/arena-battle').SharedActorLook | null }
export interface PartyTeleport { destinationMapId: string; startedAt: string; elapsedMs: number; lastAccruedAt: string|number; paused: boolean; generation: number|string; participantIds: string[] }
export interface PartyRouteActivity { kind:'route'; segmentStartedAt:number; segmentDueAt:number; remainingMs:number; paused:boolean }
export interface PartyView { id: string; kind: 'manual'|'auto'; leaderCharacterId: string; mapId: string; revision: number; members: PartyMember[]; teleport?: PartyTeleport|null; routeActivity?:PartyRouteActivity|null }
export interface PartyInvite { id:string; inviterId:string; candidateId:string; inviterName?:string; candidateName?:string; status:string; expiresAt:string; mode:string; revision?:number }
export interface PartyAction { id:string; kind:string; status:'pending'|'applied'|'failed'|'cancelled'; message?:string; result?:{message?:string}; revision?:number }
export interface PartyState { party:PartyView|null; invites:PartyInvite[]; actions:PartyAction[]; battle?:SharedBattleView|null; autoPartyEnabled:boolean; /** When the party's next encounter is due (ISO): the battle arena times its walk-in against it. */ nextEncounterAt?:string|null }
@Injectable({providedIn:'root'})
export class PartyStore {
  private readonly api = inject(ApiService);
  private readonly socket = inject(GameSocketService);
  private readonly character = inject(CharacterStore);
  readonly party = signal<PartyView|null>(null);
  readonly invites = signal<PartyInvite[]>([]);
  readonly actions = signal<PartyAction[]>([]);
  readonly battle = signal<SharedBattleView|null>(null);
  /** Epoch ms of the party's next encounter (null: not searching / unknown). */
  readonly nextEncounterAt = signal<number|null>(null);
  readonly autoPartyEnabled = signal(false);
  readonly error = signal('');
  /** Machine-readable code of the last failed mutation (e.g. CANDIDATE_ALREADY_IN_PARTY), '' when none. */
  readonly lastErrorCode = signal('');
  readonly busy = signal(false);
  readonly connection = signal<'connected'|'disconnected'|'reconnecting'>('disconnected');
  readonly members = computed(() => [...(this.party()?.members ?? [])].sort((a,b) => a.orderIndex-b.orderIndex));
  private subscriptions: Subscription[] = [];
  private refreshSequence = 0;
  private snapshotGeneration = 0;
  private lifecycleGeneration = 0;

  start(): void {
    if (this.subscriptions.length) return;
    this.socket.connect();
    for (const event of ['party:updated', 'party:invite', 'party:actionUpdated', 'battle:sharedUpdated']) {
      this.subscriptions.push(this.socket.on<Partial<PartyState>>(event).subscribe({ next: payload => {
        // Event notifications invalidate reads that started before the notification.
        this.snapshotGeneration++;
        if (payload && 'party' in payload && Array.isArray(payload.invites) && Array.isArray(payload.actions)) {
          this.applySnapshot(payload as PartyState);
        }
        void this.refresh();
        if(event === 'party:actionUpdated')void this.character.load();
      }, error: () => this.connection.set('disconnected') }));
    }
    this.subscriptions.push(this.socket.onConnectionState().subscribe(state => {
      this.connection.set(state);
      if (state === 'connected') void this.refresh();
    }));
    void this.refresh();
  }

  stop(): void {
    this.lifecycleGeneration++; this.busy.set(false);
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    this.subscriptions = [];
    this.refreshSequence++;
    this.snapshotGeneration++;
    this.party.set(null); this.invites.set([]); this.actions.set([]); this.battle.set(null); this.nextEncounterAt.set(null);
    this.autoPartyEnabled.set(false); this.error.set(''); this.connection.set('disconnected');
  }

  async refresh(): Promise<void> {
    const request = ++this.refreshSequence;
    const generation = this.snapshotGeneration;
    try {
      const state = await firstValueFrom(this.api.get<PartyState>('/party'));
      if (request !== this.refreshSequence || generation !== this.snapshotGeneration) return;
      this.applySnapshot(state);
      this.error.set('');
    } catch (error: any) {
      if (request === this.refreshSequence) this.error.set(String(error?.error?.message ?? 'Unable to load group.'));
    }
  }

  applySnapshot(state: PartyState): void {
    if (!state) return;
    const current = this.party();
    if (current && state.party?.id === current.id && Number(state.party.revision) < Number(current.revision)) return;
    this.snapshotGeneration++;
    this.party.set(state.party ?? null);
    this.invites.set(state.invites ?? []);
    this.actions.set(state.actions ?? []);
    this.autoPartyEnabled.set(!!state.autoPartyEnabled);
    const due = Date.parse(String(state.nextEncounterAt ?? ''));
    this.nextEncounterAt.set(Number.isFinite(due) ? due : null);
    const battle = state.battle ?? null;
    const previous = this.battle();
    if (!battle || !previous || previous.id !== battle.id || Number(battle.revision) >= Number(previous.revision)) this.battle.set(battle);
  }

  private async mutate(request: () => Observable<unknown>): Promise<boolean> {
    if (this.busy()) return false;
    const lifecycle=this.lifecycleGeneration;
    this.busy.set(true); this.error.set(''); this.lastErrorCode.set('');
    try { await firstValueFrom(request()); if(lifecycle!==this.lifecycleGeneration)return false; await this.refresh(); return true; }
    catch (error: any) { if(lifecycle===this.lifecycleGeneration){this.error.set(String(error?.error?.message ?? 'Unable to update group.'));this.lastErrorCode.set(String(error?.error?.code ?? ''));} return false; }
    finally { if(lifecycle===this.lifecycleGeneration)this.busy.set(false); }
  }
  private requestId(): string { return crypto.randomUUID(); }
  invite(candidate: {candidateId?:string;candidateName?:string}): Promise<boolean> {
    return this.mutate(() => this.api.post('/party/invites', {...candidate, clientRequestId:this.requestId()}));
  }
  accept(id:string): Promise<boolean> { return this.mutate(() => this.api.post(`/party/invites/${encodeURIComponent(id)}/accept`,{clientRequestId:this.requestId()})); }
  cancelInvite(id:string): Promise<boolean> { return this.mutate(() => this.api.delete(`/party/invites/${encodeURIComponent(id)}`)); }
  leave(cancel=false): Promise<boolean> { return this.mutate(() => this.api.post('/party/leave',{cancel,clientRequestId:this.requestId()})); }
  kick(id:string): Promise<boolean> { return this.mutate(() => this.api.delete(`/party/members/${encodeURIComponent(id)}`,{body:{clientRequestId:this.requestId()}})); }
  reorder(characterIds:string[]): Promise<boolean> { return this.mutate(() => this.api.put('/party/order',{characterIds,clientRequestId:this.requestId()})); }
  setAuto(enabled:boolean): Promise<boolean> { return this.mutate(() => this.api.put('/party/auto',{enabled,clientRequestId:this.requestId()})); }
  cancelAction(id:string): Promise<boolean> { return this.mutate(() => this.api.delete(`/party/actions/${encodeURIComponent(id)}`)); }
  flee(): Promise<boolean> { return this.mutate(() => this.api.post('/party/flee',{clientRequestId:this.requestId()})); }
  teleport(): Promise<boolean> { return this.mutate(() => this.api.post('/party/teleport',{clientRequestId:this.requestId()})); }
}
