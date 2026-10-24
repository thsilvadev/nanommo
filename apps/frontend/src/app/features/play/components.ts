import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, OnDestroy, HostListener, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CharacterStore, BattleStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { VendorStore } from '../../core/vendor.store';
import { VendorStockItem, effectiveFoodStatValue, TOWN_MAP_ID, projectStatusTimeline } from '@nanommo/shared';
import { GameSocketService } from '../../core/game.socket.service';
import { ApiService } from '../../core/api.service';
import { TooltipPositionDirective } from './tooltip-position.directive';
import { CdkDrag, CdkDropList, CdkDropListGroup, CdkDragDrop, CdkDragStart, CdkDragPreview, CdkDragPlaceholder } from '@angular/cdk/drag-drop';

@Component({ selector: 'app-character-summary', standalone: true, imports: [CommonModule, CdkDrag, CdkDropList, CdkDragPreview, CdkDragPlaceholder, TooltipPositionDirective], templateUrl: './character-summary.html', styleUrl: './character-summary.css' })
export class CharacterSummary implements OnDestroy {
  readonly character = inject(CharacterStore); readonly inventory = inject(InventoryStore); readonly battle = inject(BattleStore); readonly catalog = inject(CatalogService); readonly router = inject(Router); readonly battleDisplayNow = signal(Date.now()); private readonly battleDisplayTimer = setInterval(() => this.battleDisplayNow.set(Date.now()), 250);
  private lastDietBoundary = 0;
  private readonly townTimer = setInterval(() => { const c = this.character.character(); if (c?.status === 'town' && Date.parse(c.lastSeenAt) + 10000 <= Date.now()) void this.character.load(); this.checkDietBoundary() }, 1000);
  // Fires once per digestUntil the server reported, so a slot empties at the boundary
  // instead of waiting for the next poll, snapshot or battle resolve. Nothing is decided
  // locally; this only schedules a re-read of authoritative state.
  private checkDietBoundary() { const entries = this.character.character()?.diet ?? []; const now = Date.now(); for (const e of entries) { const t = Date.parse(e.digestUntil); if (!Number.isFinite(t) || t > now || t <= this.lastDietBoundary) continue; this.lastDietBoundary = t; void this.character.refreshDiet(); return } }
  slots = [{ key: 'head', label: 'Head', icon: '/assets/ui/helmet.svg' }, { key: 'body', label: 'Body', icon: '/assets/ui/armor.svg' }, { key: 'mainHand', label: 'Weapon', icon: '/assets/ui/sword.svg' }, { key: 'offHand', label: 'Shield', icon: '/assets/ui/shield.svg' }, { key: 'shoes', label: 'Shoes', icon: '/assets/ui/boots.svg' }, { key: 'cape', label: 'Cape', icon: '/assets/ui/cape.svg' }, { key: 'accessoryLeft', label: 'Ring', icon: '/assets/ui/ring.svg' }, { key: 'accessoryRight', label: 'Ring', icon: '/assets/ui/ring.svg' }];
  dietSlots = [0, 1, 2]; dietRainDrops = [0, 1, 2, 3, 4, 5]; equipmentPredicates = Object.fromEntries(this.slots.map(s => [s.key, (drag: CdkDrag) => this.canEnterEquipmentSlot(s.key, drag)]));
  initial() { return (this.character.character()?.name || '?').slice(0, 1).toUpperCase() }
  displayHp() { const now = this.battleDisplayNow(); const projected = this.battle.currentBattleCharacterResources(now); return projected?.hp ?? this.character.character()?.hpCurrent ?? null }
  displaySp() { const now = this.battleDisplayNow(); const projected = this.battle.currentBattleCharacterResources(now); return projected?.sp ?? this.character.character()?.spCurrent ?? null }
  hpPct() { const c = this.character.character(); const hp = this.displayHp(); return c?.maxHp && hp !== null ? Math.max(0, Math.min(100, hp / c.maxHp * 100)) : 0 }
  spPct() { const c = this.character.character(); const sp = this.displaySp(); return c?.maxSp && sp !== null ? Math.max(0, Math.min(100, sp / c.maxSp * 100)) : 0 }
  statusLabel() { const s = this.character.character()?.status; return s === 'grinding' ? 'Grinding' : s === 'dead_pending_return' ? 'Dead — return pending' : 'In Town' }
  activeStatusEffects(target: 'character' | 'monster' = 'character') {
    const entry: any = this.battle.active(); const now = this.battleDisplayNow();
    if (!entry) return [];
    const startMs = Date.parse(entry.startAt);
    if (now < startMs || now >= Date.parse(entry.endAt)) return [];
    const tick = Math.floor((now - startMs) / 1000);
    const snapshot = target === 'character' ? entry.log?.header?.characterSnapshot : entry.log?.header?.monsterSnapshot;
    const active = projectStatusTimeline(snapshot?.statusEffects, entry.log?.events, target, tick);
    return [...active.entries()].map(([id, stacks]) => {
      const def: any = this.catalog.statusEffect(id) ?? {name:id, maxStacks:1};
      const durations = stacks.map(status => Number.isFinite(status.expiresAtTick) ? Math.max(0, Math.ceil((startMs + status.expiresAtTick * 1000 - now) / 1000)) : Number.POSITIVE_INFINITY);
      const remaining = Math.max(0, ...durations);
      const movePenalty = Number(def.moveSpeedPenaltyPerStack ?? def.moveSpeedPenalty ?? 0);
      const attackPenalty = Number(def.attackSpeedPenaltyPerStack ?? def.attackSpeedPenalty ?? 0);
      const timeLabel = Number.isFinite(remaining) ? `${remaining}s remaining` : 'until removed';
      return { id, name:String(def.name ?? id.replace(/_/g,' ')), stacks:stacks.length, maxStacks:Number(def.maxStacks ?? 1), durations, remaining, movePenalty, attackPenalty, tooltip:`${String(def.name ?? id)} · ${stacks.length}/${Number(def.maxStacks ?? 1)} stacks · ${timeLabel}${movePenalty ? ` · Move Speed -${movePenalty * stacks.length}` : ''}${attackPenalty ? ` · Attack Speed -${attackPenalty * stacks.length}` : ''}` };
    }).filter(status => status.stacks > 0 && status.remaining > 0);
  }
  trackStatusEffect(_index: number, status: { id: string }) { return status.id; }
  freezeStatus() { return this.activeStatusEffects('character').find(status => status.id === 'freeze') ?? null; }

  itemName(slot: string) { const e = this.equipped(slot); return e ? (this.catalog.item(e.itemId)?.name ?? e.itemId) : '' }
  itemDefinition(slot: string) { const e = this.equipped(slot); return e ? this.catalog.item(e.itemId) : null }
  itemTooltipLines(slot: string) { const e = this.equipped(slot); return e ? this.catalog.itemTooltipLines(e.itemId, e.instanceData, slot) : [] }
  formatItemEffect(effect: any) { if (!effect) return ''; if (effect.status) { const status = String(effect.status).replace(/_/g, ' '); return `Cures ${status}.` } if (effect.type === 'heal_hp') return `Restores ${Number(effect.amount) || 0} HP.`; if (effect.type === 'heal_sp') return `Restores ${Number(effect.amount) || 0} SP.`; if (effect.type === 'food_buff') return `Regenerates HP/SP for ${Math.round((Number(effect.durationSeconds) || 0) / 60)} minutes.`; return String(effect.type ?? '').replace(/_/g, ' ').replace(/^./, x => x.toUpperCase()) + '.' }
  itemTierClass(slot: string) { const tier = Number((this.itemDefinition(slot) as any)?.tier ?? 0); return tier >= 2 && tier <= 5 ? 'tier-' + tier : '' }
  dietEntry(index: number) { return this.character.character()?.diet?.[index] ?? null }
  dietIcon(index: number) { const e = this.dietEntry(index); return e ? this.catalog.itemIcon(e.itemId) : '/assets/ui/food.svg' }
  dietName(index: number) { const e = this.dietEntry(index); return e ? (this.catalog.item(e.itemId)?.name ?? e.itemId) : 'Empty food slot' }
  dietStars(index: number) { const e = this.dietEntry(index); return e ? '★'.repeat(Math.max(0, Math.min(3, e.dietLevel))) : '' }
  dietLevel(index: number) { const e = this.dietEntry(index); return Math.max(0, Math.min(3, Number(e?.dietLevel ?? 0))) }
  dietRainAlpha(index: number) { return Math.min(1, 0.555 + 0.15 * this.dietLevel(index)).toFixed(3) }
  dietRemainingSeconds(index: number) { const e = this.dietEntry(index); if (!e) return 0; return Math.max(0, Math.ceil((Date.parse(e.digestUntil) - this.battleDisplayNow()) / 1000)) }
  dietTimerLabel(index: number) { return Math.ceil(this.dietRemainingSeconds(index) / 60) + 'm' }
  formatDuration(seconds: number) { if (!Number.isFinite(seconds)) return 'Until removed'; const s = Math.max(0, seconds); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60; return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(sec).padStart(2, '0')}s` }
  dietTooltipLines(index: number) { const e = this.dietEntry(index); if (!e) return []; const d: any = this.catalog.item(e.itemId); const effect = d?.effect; if (!effect) return []; const lines: any[] = []; if (effect.type === 'food_buff') { const level = this.dietLevel(index); lines.push({ label: 'HP Regen', value: `+${effectiveFoodStatValue(effect.hpRegenPerTenTicks, level)} / 10 ticks` }); lines.push({ label: 'SP Regen', value: `+${effectiveFoodStatValue(effect.spRegenPerTenTicks, level)} / 10 ticks` }); } lines.push({ label: 'Diet', value: e.dietLevel > 0 ? '★'.repeat(Math.min(3, e.dietLevel)) : '—' }); lines.push({ label: 'Remaining', value: this.formatDuration(this.dietRemainingSeconds(index)) }); return lines }
  async toggleAutoFeed() { const c = this.character.character(); if (!c) return; try { await this.character.setAutoFeed(!c.autoFeed) } catch { } }
  foodLabel() { const now = this.battleDisplayNow(); const count = (this.character.character()?.diet ?? []).filter(e => { const digestUntil = Date.parse(e.digestUntil); return Number.isFinite(digestUntil) && digestUntil > now }).length; return count <= 0 ? 'HUNGRY' : count === 1 ? 'FED' : count === 2 ? 'SATISFIED' : 'FULL' }
  go(p: string) { void this.router.navigateByUrl(p) } equipped(slot: string) { return this.inventory.equipment().find(x => x.slot === slot) } canEnterEquipmentSlot(slot: string, drag: CdkDrag) { const data: any = drag?.data; if (data?.source !== 'inventory') return false; const item: any = this.catalog.item(data.itemId); return item?.type === 'equipment' && (item.slot === slot || (slot === 'offHand' && item.secondaryHand === true) || (item.slot === 'accessory' && (slot === 'accessoryLeft' || slot === 'accessoryRight'))) } itemIcon(slot: string, fallback: string) { const e = this.equipped(slot); return e ? this.catalog.itemIcon(e.itemId) : fallback } slotDropId(slot: string) { return `character-slot-${slot}` } isSlotFocused(slot: string) { const id = this.inventory.draggedItemId(); const item: any = id ? this.catalog.item(id) : null; return item?.type === 'equipment' && (item.slot === slot || (slot === 'offHand' && item.secondaryHand === true) || (item.slot === 'accessory' && (slot === 'accessoryLeft' || slot === 'accessoryRight'))) } onEquipmentDragStart(itemId: string) { this.inventory.beginDrag(itemId); document.dispatchEvent(new Event('nm:drag-start')) } onEquipmentDragEnd() { this.inventory.endDrag(); document.dispatchEvent(new Event('nm:drag-end')) } equipDragData(slot: string, it: any) { return { source: 'equipment', slot, ...it } } async dropEquipment(slot: string, ev: CdkDragDrop<any>) { const data = ev.item.data; try { if (data?.source === 'inventory') { await this.inventory.equip(slot, data.itemId) } } catch { } finally { this.inventory.endDrag() } } async unequip(slot: string) { try { await this.inventory.unequip(slot) } catch { } } ngOnDestroy() { clearInterval(this.townTimer); clearInterval(this.battleDisplayTimer) }
}

@Component({ selector: 'app-map-board', standalone: true, imports: [CommonModule], templateUrl: './map-board.html', styleUrl: './map-board.css' })
export class MapBoard implements OnDestroy {
  readonly character = inject(CharacterStore); readonly battle = inject(BattleStore); private readonly api = inject(ApiService); private readonly socket = inject(GameSocketService);
  maps: any[] = []; readonly cells = Array.from({length:195},(_,i)=>({col:i%15,row:Math.floor(i/15),x:i%15-7,y:6-Math.floor(i/15)}));
  readonly selected = signal<string|null>(null); readonly error = signal<string|null>(null); readonly mapTransitionPending = signal(false); readonly destinationMapId = signal<string|null>(null); readonly routeOriginMapId = signal<string|null>(null);
  readonly cameraX = signal(0); readonly cameraY = signal(0); readonly zoom = signal(1); readonly hoveredMap = signal<any|null>(null); readonly activityNow = signal(Date.now()); readonly fleeNotice = signal<string|null>(null); readonly pinArrivalFromMapId = signal<string|null>(null); private discovered = new Set<string>(); private readonly activityTimer = setInterval(() => this.activityNow.set(Date.now()), 250);
  private pinArrivalCharacterId: string|null = null; private pinArrivalMapId: string|null = null; private pinArrivalPreviousIntent: any = null;
  private tooltipEl: HTMLElement|null = null; private tooltipPointer = {x:0,y:0};
  private mapRequestSequence=0; private latestMapRequestSequence=0; private lastRequestedAt=0; private transitionOriginMapId:string|null=null;
  private transitionPoll:ReturnType<typeof setInterval>|null=null; private transitionPollBusy=false; private fleeNoticeTimeout:ReturnType<typeof setTimeout>|null=null; private lastFleeNoticeEntryId:string|null=null;
  private drag: {id:number; startX:number; startY:number; cameraX:number; cameraY:number; moved:boolean}|null = null; private suppressClickUntil = 0; private lastCenteredMapId: string|null = null;
  private readonly worldWidth=2295; private readonly worldHeight=1989; private readonly viewportWidth=761; private readonly viewportHeight=660; private readonly zoomMin=.5; private readonly zoomMax=1;
  constructor() {
    // lastResolved is a retained store snapshot; don't replay an old FLEE toast
    // merely because Grind was mounted again after navigation.
    this.lastFleeNoticeEntryId=this.battle.lastResolved()?.entryId??null;
    this.api.get<any[]>('/maps').subscribe({next:m=>{this.maps=m;this.rebuildDiscovery();this.centerOnCurrentMap();},error:e=>this.error.set(e?.error?.message??'Unable to load maps')});
    effect(()=>{
      const c=this.character.character();
      if(!c)return;
      this.trackLocationArrival(c);
      this.rebuildDiscovery(c.discoveredMapIds);
      this.centerOnCurrentMap();
      this.reconcileDestinationPreview(c);
    });
    effect(()=>{
      const resolved=this.battle.lastResolved();
      if(!resolved||resolved.entryId===this.lastFleeNoticeEntryId)return;
      this.lastFleeNoticeEntryId=resolved.entryId;
      if(resolved.cancellationReason!=='flee')return;
      this.fleeNotice.set('You managed to flee battle!');
      if(this.fleeNoticeTimeout!==null)clearTimeout(this.fleeNoticeTimeout);
      this.fleeNoticeTimeout=setTimeout(()=>{this.fleeNotice.set(null);this.fleeNoticeTimeout=null;},4500);
    });
  }
  private destinationRequestedAt:string|null=null;
  private destinationTransitionWasDeferred=false;
  private readonly suppressedPendingTransitionKeys=new Set<string>();

  private transitionIntentKey(destinationMapId:string,requestedAt?:string|null){
    const normalizedAt=requestedAt&&Number.isFinite(Date.parse(requestedAt))
      ?new Date(requestedAt).toISOString()
      :requestedAt||'legacy';
    return `${destinationMapId}|${normalizedAt}`;
  }
  private isPendingTransitionSuppressed(pending:any){
    return !!pending?.destinationMapId&&this.suppressedPendingTransitionKeys.has(
      this.transitionIntentKey(String(pending.destinationMapId),pending.requestedAt??null),
    );
  }
  private suppressPendingTransition(destinationMapId:string,requestedAt?:string|null){
    this.suppressedPendingTransitionKeys.add(this.transitionIntentKey(destinationMapId,requestedAt));
    while(this.suppressedPendingTransitionKeys.size>64){
      const oldest=this.suppressedPendingTransitionKeys.values().next().value;
      if(oldest===undefined)break;
      this.suppressedPendingTransitionKeys.delete(oldest);
    }
  }
  private pendingIntentIsNewerThan(pending:any,referenceAt?:string|null,referenceDestination?:string|null){
    if(!pending?.requestedAt)return false;
    const pendingAt=Date.parse(pending.requestedAt);
    const referenceTime=Date.parse(String(referenceAt??''));
    if(!Number.isFinite(pendingAt))return false;
    if(!Number.isFinite(referenceTime)||pendingAt>referenceTime)return true;
    // Independent clients can generate the same millisecond timestamp. If the targets
    // differ, preserve the currently reported server intent rather than guessing that
    // the in-flight HTTP response is newer.
    return pendingAt===referenceTime&&!!referenceDestination&&pending.destinationMapId!==referenceDestination;
  }
  private pendingTransitionIsNewer(pending:any){
    return this.pendingIntentIsNewerThan(pending,this.destinationRequestedAt,this.destinationMapId());
  }
  private mapIntentResponseFreshness(latestCharacter:any,origin:string,characterPatch:any,responseIntentAt:string,responseDestination:string){
    return {
      newerRealtimeIntent:this.pendingIntentIsNewerThan(latestCharacter?.pendingMapTransition,responseIntentAt,responseDestination),
      responseBehindLocation:!!latestCharacter
        &&!!characterPatch?.currentMapId
        &&characterPatch.currentMapId===origin
        &&latestCharacter.currentMapId!==origin,
    };
  }
  private finishDestinationPreview(pending?:any){
    const destination=this.destinationMapId();
    if(destination)this.suppressPendingTransition(destination,this.destinationRequestedAt);
    if(pending?.destinationMapId)this.suppressPendingTransition(String(pending.destinationMapId),pending.requestedAt??null);
    this.clearDestinationPreview();
    this.destinationRequestedAt=null;
    this.destinationTransitionWasDeferred=false;
    this.mapTransitionPending.set(false);
    this.stopTransitionPoll();
    this.transitionOriginMapId=null;
  }
  private reconcileDestinationPreview(c:any){
    const travel=c.travelIntent??null;
    const pending=travel?{destinationMapId:String(travel.destinationMapId??''),requestedAt:travel.requestedAt??null,waitingForBattle:travel.waitingForBattle===true,routeMapIds:travel.routeMapIds,segmentIndex:travel.segmentIndex}:c.pendingMapTransition??null;
    let destination=this.destinationMapId();

    // Another accepted intent can supersede the one currently drawn. Only a newer
    // server request timestamp may replace the local destination; old snapshots must
    // never roll the route back to a previous map.
    if(destination&&pending&&pending.destinationMapId!==destination&&(!!travel||this.pendingTransitionIsNewer(pending))){
      // An active server travelIntent is the latest authoritative route. Do not let an
      // old local pending-transition timestamp or suppression key override it.
      destination=String(pending.destinationMapId);
      this.destinationMapId.set(destination);
      this.destinationRequestedAt=pending.requestedAt??null;
      this.routeOriginMapId.set(c.currentMapId);
      this.transitionOriginMapId=c.currentMapId;
      this.destinationTransitionWasDeferred=true;
    }

    if(destination){
      const origin=this.routeOriginMapId()??this.transitionOriginMapId;
      // Unlike legacy pendingMapTransition metadata, travelIntent remains live across
      // battle resolution and intermediate segment commits. Historical suppression only
      // applies after the server has no active travel intent.
      const activeTravelMatchesDestination=!!travel
        &&String(travel.destinationMapId??'')===destination
        &&c.currentMapId!==destination;
      const pendingIsSuppressed=travel?false:this.isPendingTransitionSuppressed(pending);
      const pendingMatchesDestination=activeTravelMatchesDestination|| (!!pending
        &&pending.destinationMapId===destination
        &&!pendingIsSuppressed
        &&(!pending.requestedAt||!this.destinationRequestedAt
          ||Date.parse(pending.requestedAt)>=Date.parse(this.destinationRequestedAt)));

      // The only arrival rule is map identity. It deliberately does not branch on
      // Town/Grind/activity status, and stale pending metadata cannot undo the arrival.
      if(c.currentMapId===destination){
        this.finishDestinationPreview(pending);
        return;
      }

      // A server-directed fallback/redirect completed somewhere other than both the
      // origin and requested destination. This is also type-independent.
      if(origin&&c.currentMapId!==origin&&!pendingMatchesDestination){
        this.finishDestinationPreview(pending);
        return;
      }

      if(pending&&!pendingMatchesDestination&&!this.pendingTransitionIsNewer(pending)){
        this.suppressPendingTransition(String(pending.destinationMapId),pending.requestedAt??null);
      }
      if(pendingMatchesDestination){
        this.destinationRequestedAt=this.destinationRequestedAt??pending.requestedAt??null;
        this.destinationTransitionWasDeferred=true;
        this.transitionOriginMapId=origin??c.currentMapId;
        if(travel&&Array.isArray(travel.routeMapIds)&&travel.routeMapIds[Number(travel.segmentIndex??0)]===c.currentMapId)this.routeOriginMapId.set(c.currentMapId);
        this.mapTransitionPending.set(travel?travel.waitingForBattle===true:true);
      }else{
        // If a previously confirmed deferred intent disappeared but the character is
        // still at its origin, the server has ended/cancelled that transition.
        if(this.destinationTransitionWasDeferred&&!pending&&(!origin||c.currentMapId===origin)){
          this.finishDestinationPreview();
          return;
        }
        this.mapTransitionPending.set(false);
      }
      this.startTransitionPoll();
      return;
    }

    // On reload there is no local preview yet. Resume a genuine pending intent, but
    // never show a route if the character is already at that destination.
    if(pending&&(travel||!this.isPendingTransitionSuppressed(pending))){
      const pendingDestination=String(pending.destinationMapId);
      if(c.currentMapId===pendingDestination){
        this.finishDestinationPreview(pending);
        return;
      }
      this.destinationMapId.set(pendingDestination);
      this.destinationRequestedAt=pending.requestedAt??null;
      this.routeOriginMapId.set(c.currentMapId);
      this.transitionOriginMapId=c.currentMapId;
      this.destinationTransitionWasDeferred=true;
      this.mapTransitionPending.set(travel?travel.waitingForBattle===true:true);
      this.startTransitionPoll();
    }
  }
  private key(x:number,y:number){return `${x},${y}`}
  private rebuildDiscovery(ids?:string[]){const c=this.character.character();this.discovered=new Set(Array.isArray(ids??c?.discoveredMapIds)?(ids??c?.discoveredMapIds??[]):[TOWN_MAP_ID]);if(!this.discovered.size)this.discovered.add(TOWN_MAP_ID);if(c?.currentMapId)this.discovered.add(c.currentMapId);if(c?.currentMapId===TOWN_MAP_ID&&[...this.discovered].every(id=>id===TOWN_MAP_ID||id==='map_green_grounds_4'))this.discovered.delete('map_green_grounds_4');}
  trackMap(_i:number,m:any){return m.id} trackCell(_i:number,c:any){return `${c.x},${c.y}`}
  gridColumn(map:any){return Number(map?.coordinates?.x??0)+7} gridRow(map:any){return 6-Number(map?.coordinates?.y??0)}
  private activeBattleAt(now=this.activityNow()){const b=this.battle.active();return !!b&&now>=Date.parse(String(b.startAt))&&now<Date.parse(String(b.endAt));}
  private nonBattleElapsedSeconds(fromMs:number,toMs:number){
    if(!Number.isFinite(fromMs)||!Number.isFinite(toMs)||toMs<=fromMs)return 0;
    const intervals:Array<{start:number;end:number}>=[
      ...this.battle.queue().map((entry:any)=>({
        start:Date.parse(String(entry.startAt??'')),
        end:Date.parse(String(entry.cancellationReason==='flee'&&entry.cancelledAt?entry.cancelledAt:entry.endAt??'')),
      })),
      ...this.battle.recentBattleIntervals().map((entry:any)=>({start:Date.parse(String(entry.startAt??'')),end:Date.parse(String(entry.endAt??''))})),
    ].filter(interval=>Number.isFinite(interval.start)&&Number.isFinite(interval.end)&&interval.end>interval.start)
      .sort((a,b)=>a.start-b.start);
    let busyMs=0;let unionStart:number|null=null;let unionEnd:number|null=null;
    for(const interval of intervals){
      const start=Math.max(fromMs,interval.start);const end=Math.min(toMs,interval.end);
      if(end<=start)continue;
      if(unionStart===null){unionStart=start;unionEnd=end;continue;}
      if(start<=Number(unionEnd)){unionEnd=Math.max(Number(unionEnd),end);continue;}
      busyMs+=Number(unionEnd)-unionStart;unionStart=start;unionEnd=end;
    }
    if(unionStart!==null)busyMs+=Number(unionEnd)-unionStart;
    return Math.max(0,(toMs-fromMs-busyMs)/1000);
  }
  activityKind():'traveling'|'gathering'|null{const c=this.character.character();if(!c)return null;if(c.travelIntent)return 'traveling';return c.status==='grinding'&&this.currentMap()?.type==='grind'?'gathering':null;}
  activityGaugeVisible(){return this.activityKind()!==null;}
  activityLabel(){return this.activityKind()==='traveling'?'Traveling…':'Gathering…';}
  activityProgress(){
    const c:any=this.character.character();const now=this.activityNow();if(!c)return 0;
    const activeBattle=this.activeBattleAt(now);let progress=0;let duration=300;
    if(c.travelIntent){const intent=c.travelIntent;progress=Math.max(0,Math.min(1,Number(intent.segmentProgress??0)));duration=Number(intent.lastDurationSeconds??30);const last=Date.parse(String(intent.lastAccruedAt??now));if(!activeBattle&&!intent.waitingForBattle&&intent.speedPaused!==true&&Number.isFinite(duration)&&duration>0&&Number.isFinite(last))progress=Math.min(1,progress+Math.max(0,now-last)/1000/duration);}
    else{const map=this.currentMap();const cycle=c.gatheringCycle??{};const population=Math.max(1,this.playersInMap());duration=Math.max(30,12*Number(map?.mapLength??25)+30*(population-1)-(Math.max(1,Number(c.gatheringLevel??1))-1))+Math.max(0,Number(cycle.varianceSeconds??0));progress=Math.max(0,Math.min(1,Number(cycle.progress??0)));const last=Date.parse(String(cycle.lastUpdatedAt??now));if(Number.isFinite(last)&&duration>0)progress=Math.min(1,progress+this.nonBattleElapsedSeconds(last,now)/duration);}
    return Math.round(progress*1000)/10;
  }
  currentMap(){return this.maps.find(m=>m.id===this.character.character()?.currentMapId)??this.maps.find(m=>m.id===TOWN_MAP_ID)??null}
  mapName(){return this.currentMap()?.name??'Unknown'}
  private pinArrivalStorageKey(characterId:string){return `nanommo:location-pin-arrival:${characterId}`}
  private trackLocationArrival(character:any){
    const characterId=String(character?.id??'');const mapId=String(character?.currentMapId??'');
    if(!characterId||!mapId)return;
    const intent=character.travelIntent?{kind:character.travelIntent.kind,routeMapIds:Array.isArray(character.travelIntent.routeMapIds)?[...character.travelIntent.routeMapIds]:[],segmentIndex:Number(character.travelIntent.segmentIndex??0)}:null;
    if(characterId!==this.pinArrivalCharacterId){
      this.pinArrivalCharacterId=characterId;this.pinArrivalMapId=mapId;this.pinArrivalPreviousIntent=intent;
      try{const stored=JSON.parse(localStorage.getItem(this.pinArrivalStorageKey(characterId))??'null');this.pinArrivalFromMapId.set(stored?.mapId===mapId&&typeof stored?.fromMapId==='string'?stored.fromMapId:null);}catch{this.pinArrivalFromMapId.set(null);}
      return;
    }
    if(this.pinArrivalMapId&&this.pinArrivalMapId!==mapId){
      const oldMapId=this.pinArrivalMapId;const oldIntent=this.pinArrivalPreviousIntent;
      const expectedNext=oldIntent?.kind==='route'?oldIntent.routeMapIds?.[Number(oldIntent.segmentIndex??0)+1]:null;
      if(expectedNext===mapId){
        this.pinArrivalFromMapId.set(oldMapId);
        try{localStorage.setItem(this.pinArrivalStorageKey(characterId),JSON.stringify({mapId,fromMapId:oldMapId}));}catch{}
      }else{
        this.pinArrivalFromMapId.set(null);
        try{localStorage.removeItem(this.pinArrivalStorageKey(characterId));}catch{}
      }
      this.pinArrivalMapId=mapId;
    }
    this.pinArrivalPreviousIntent=intent;
  }
  /** Whether the icon is currently traversing a valid, cardinal server route leg. */
  isLocationPinTraveling():boolean{
    const character:any=this.character.character();
    const intent:any=character?.travelIntent;
    const routeIds:string[]=Array.isArray(intent?.routeMapIds)?intent.routeMapIds.map(String):[];
    const index=Math.max(0,Math.floor(Number(intent?.segmentIndex??0)));
    if(intent?.kind!=='route'||routeIds[index]!==character?.currentMapId)return false;
    const current=this.maps.find(m=>m.id===routeIds[index]);
    const next=this.maps.find(m=>m.id===routeIds[index+1]);
    if(!current||!next)return false;
    const dx=Math.abs(Number(current.coordinates?.x)-Number(next.coordinates?.x));
    const dy=Math.abs(Number(current.coordinates?.y)-Number(next.coordinates?.y));
    return dx+dy===1;
  }

  /** The 88px marker's artwork sits slightly below the CSS box anchor; compensate only in motion. */
  locationPinRenderY():number{
    return this.locationPinPosition().y-(this.isLocationPinTraveling()?7:0);
  }

  /** Pin follows the current authoritative route leg, not a client-created route/timer. */
  locationPinPosition():{x:number;y:number}{
    const current=this.currentMap();
    if(!current)return{x:0,y:0};
    const left=this.gridColumn(current)*153;const top=this.gridRow(current)*153;
    const center={x:left+76.5,y:top+76.5};
    const character:any=this.character.character();const intent:any=character?.travelIntent;
    const routeIds:string[]=Array.isArray(intent?.routeMapIds)?intent.routeMapIds.map(String):[];
    const segmentIndex=Math.max(0,Math.floor(Number(intent?.segmentIndex??0)));
    if(intent?.kind!=='route'||routeIds[segmentIndex]!==current.id)return this.locationPinArrivalPosition(current,left,top,center);
    const next=this.maps.find(m=>m.id===routeIds[segmentIndex+1]);
    if(!next)return this.locationPinArrivalPosition(current,left,top,center);
    const cx=Number(current.coordinates.x),cy=Number(current.coordinates.y),nx=Number(next.coordinates.x),ny=Number(next.coordinates.y);
    if(Math.abs(cx-nx)+Math.abs(cy-ny)!==1)return center;
    const previous=segmentIndex>0
      ?this.maps.find(m=>m.id===routeIds[segmentIndex-1])
      :this.maps.find(m=>m.id===this.pinArrivalFromMapId());
    const px=Number(previous?.coordinates?.x),py=Number(previous?.coordinates?.y);
    let start={...center};
    if(previous&&Math.abs(cx-px)+Math.abs(cy-py)===1){
      if(px<cx)start={x:left,y:center.y};else if(px>cx)start={x:left+153,y:center.y};
      else if(py>cy)start={x:center.x,y:top};else start={x:center.x,y:top+153};
    }else if(nx>cx)start={x:left,y:center.y};
    else if(nx<cx)start={x:left+153,y:center.y};
    else if(ny>cy)start={x:center.x,y:top+153};
    else start={x:center.x,y:top};
    let end={...center};
    if(nx>cx)end={x:left+153,y:center.y};else if(nx<cx)end={x:left,y:center.y};
    else if(ny>cy)end={x:center.x,y:top};else end={x:center.x,y:top+153};
    const progress=Math.max(0,Math.min(1,this.activityProgress()/100));
    // Move from the entry edge to the center, then to the exit edge. On a
    // corner this creates the same cardinal turn as the map path, never a diagonal.
    if(progress<=0.5){const leg=progress*2;return{x:start.x+(center.x-start.x)*leg,y:start.y+(center.y-start.y)*leg};}
    const leg=(progress-0.5)*2;
    return{x:center.x+(end.x-center.x)*leg,y:center.y+(end.y-center.y)*leg};
  }
  private locationPinArrivalPosition(current:any,left:number,top:number,center:{x:number;y:number}){
    const from=this.maps.find(m=>m.id===this.pinArrivalFromMapId());
    if(!from)return center;
    const cx=Number(current.coordinates.x),cy=Number(current.coordinates.y),fx=Number(from.coordinates.x),fy=Number(from.coordinates.y);
    if(Math.abs(cx-fx)+Math.abs(cy-fy)!==1)return center;
    if(fx<cx)return{x:left,y:center.y};
    if(fx>cx)return{x:left+153,y:center.y};
    if(fy>cy)return{x:center.x,y:top};
    return{x:center.x,y:top+153};
  }
  playersInMap(){const id=this.character.character()?.currentMapId;return id&&this.battle.mapPresence()?.mapId===id?this.battle.mapPresence()?.playersOnMap??0:0}
  isRevealed(x:number,y:number){if(!this.discovered.size)return x===0&&y===0;for(const id of this.discovered){const m=this.maps.find(v=>v.id===id);if(!m)continue;const dx=Math.abs(Number(m.coordinates.x)-x),dy=Math.abs(Number(m.coordinates.y)-y);if(dx+dy<=1)return true;}return false}
  private clampCamera(x:number,y:number,zoom=this.zoom()){const visibleWidth=this.viewportWidth/zoom,visibleHeight=this.viewportHeight/zoom;return {x:Math.max(0,Math.min(this.worldWidth-visibleWidth,x)),y:Math.max(0,Math.min(this.worldHeight-visibleHeight,y))}}
  private centerOnCurrentMap(){const m=this.currentMap();if(!m||this.lastCenteredMapId===m.id)return;this.lastCenteredMapId=m.id;const z=this.zoom();const p=this.clampCamera(this.gridColumn(m)*153+76.5-this.viewportWidth/(2*z),this.gridRow(m)*153+76.5-this.viewportHeight/(2*z),z);this.cameraX.set(p.x);this.cameraY.set(p.y)}
  onPointerDown(e:PointerEvent){if(e.button!==0&&e.pointerType==='mouse')return;this.hideTileTooltip();this.drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,cameraX:this.cameraX(),cameraY:this.cameraY(),moved:false}}
  onPointerMove(e:PointerEvent){const d=this.drag;if(!d||d.id!==e.pointerId)return;const dx=e.clientX-d.startX,dy=e.clientY-d.startY;if(Math.abs(dx)+Math.abs(dy)>5)d.moved=true;if(!d.moved)return;const viewport=e.currentTarget as HTMLElement;if(!viewport.hasPointerCapture(e.pointerId))viewport.setPointerCapture(e.pointerId);const z=this.zoom();const p=this.clampCamera(d.cameraX-dx/z,d.cameraY-dy/z,z);this.cameraX.set(p.x);this.cameraY.set(p.y)}
  onPointerUp(e:PointerEvent){const d=this.drag;if(!d||d.id!==e.pointerId)return;if(d.moved)this.suppressClickUntil=Date.now()+250;this.drag=null}
  onPointerCancel(e:PointerEvent){if(this.drag?.id===e.pointerId)this.drag=null}
  onViewportClick(e:MouseEvent){if(Date.now()<this.suppressClickUntil){e.preventDefault();e.stopPropagation();return}const target=e.target as HTMLElement;const button=target.closest?.('.map-tile') as HTMLButtonElement|null;if(!button||button.disabled)return;const tile=this.maps.find(m=>m.id===button.getAttribute('data-map-id'));if(tile)this.onTileClick(e,tile)}
  onTileClick(e:MouseEvent,tile:any){if(Date.now()<this.suppressClickUntil){e.preventDefault();e.stopPropagation();return}if(!this.isRevealed(tile.coordinates.x,tile.coordinates.y))return;this.selected.set(tile.id);this.enter(tile.id)}
  onWheel(e:WheelEvent){e.preventDefault();const viewport=e.currentTarget as HTMLElement;const rect=viewport.getBoundingClientRect();const localX=e.clientX-rect.left,localY=e.clientY-rect.top;const oldZoom=this.zoom();const nextZoom=Math.max(this.zoomMin,Math.min(this.zoomMax,Number((oldZoom*(e.deltaY>0?.9:1.1)).toFixed(4))));if(nextZoom===oldZoom)return;const worldX=this.cameraX()+localX/oldZoom,worldY=this.cameraY()+localY/oldZoom;const p=this.clampCamera(worldX-localX/nextZoom,worldY-localY/nextZoom,nextZoom);this.zoom.set(nextZoom);this.cameraX.set(p.x);this.cameraY.set(p.y)}
  showTileTooltip(tile:any,e:PointerEvent|FocusEvent){this.hoveredMap.set(tile);if(e instanceof PointerEvent)this.tooltipPointer={x:e.clientX,y:e.clientY};else{const r=(e.target as HTMLElement).getBoundingClientRect();this.tooltipPointer={x:r.left+r.width/2,y:r.top+r.height/2}}this.renderTileTooltip()}
  moveTileTooltip(e:PointerEvent){this.tooltipPointer={x:e.clientX,y:e.clientY};this.positionTileTooltip()}
  hideTileTooltip(){this.hoveredMap.set(null);this.tooltipEl?.remove();this.tooltipEl=null}
  private renderTileTooltip(){const map=this.hoveredMap();this.tooltipEl?.remove();this.tooltipEl=null;if(!map)return;const el=document.createElement('div');el.className='nm-map-tooltip';el.style.cssText='position:fixed;z-index:10000;display:flex;flex-direction:column;gap:5px;min-width:190px;max-width:min(320px,calc(100vw - 20px));padding:12px 15px;background:linear-gradient(145deg,#21170f,#100b07);border:1px solid #a98750;box-shadow:0 6px 22px #000c,inset 0 0 0 1px #4b3521;color:#c9b79a;pointer-events:none;box-sizing:border-box;';const title=document.createElement('strong');title.textContent=map.name;title.style.cssText='color:#f0d9ac;font:bold 25px/1.05 Georgia,serif;letter-spacing:.4px;text-shadow:0 2px 3px #000;';el.appendChild(title);const sub=document.createElement('small');const mapType=String(map.type??'location').replace(/[_-]+/g,' ');sub.textContent=map.type==='grind'?('Recommended level: '+(map.recommendedLevel??1)):mapType.charAt(0).toUpperCase()+mapType.slice(1);sub.style.cssText='color:#b9a17a;font:12px/1.3 Arial,sans-serif;';el.appendChild(sub);document.body.appendChild(el);this.tooltipEl=el;this.positionTileTooltip()}
  private positionTileTooltip(){const el=this.tooltipEl;if(!el)return;const margin=10,gap=14;el.style.left='0px';el.style.top='0px';const r=el.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight;const x=this.tooltipPointer.x+gap+r.width<=vw-margin?this.tooltipPointer.x+gap:Math.max(margin,this.tooltipPointer.x-r.width-gap);const y=this.tooltipPointer.y+gap+r.height<=vh-margin?this.tooltipPointer.y+gap:Math.max(margin,this.tooltipPointer.y-r.height-gap);el.style.left=x+'px';el.style.top=y+'px'}
  enter(id:string){this.requestMapTransition(id)}
  enterTownMap(id:string){this.requestMapTransition(id)}
  enterTown(){this.requestMapTransition(TOWN_MAP_ID)}
  private requestMapTransition(id:string){
    const map=this.maps.find(m=>m.id===id); const current=this.character.character();
    if(!map||!current)return;
    if(current.currentMapId===id&&!current.pendingMapTransition&&!current.travelIntent)return;
    this.error.set(null);
    const requestSequence=++this.mapRequestSequence;
    this.latestMapRequestSequence=requestSequence;
    const previousIntentAt=Date.parse(String(current.pendingMapTransition?.requestedAt??''))||0;
    this.lastRequestedAt=Math.max(Date.now(),this.lastRequestedAt+1,previousIntentAt+1);
    const requestedAt=new Date(this.lastRequestedAt).toISOString();
    const origin=current.currentMapId;
    this.routeOriginMapId.set(origin);this.destinationRequestedAt=requestedAt;this.destinationMapId.set(id);this.mapTransitionPending.set(false);
    this.api.post<any>(`/maps/${id}/enter`,{requestedAt}).subscribe({
      next:async result=>{
        if(requestSequence!==this.latestMapRequestSequence)return;
        const characterPatch=result?.character??{};
        const latestCharacter=this.character.character();
        const responsePending=characterPatch?.pendingMapTransition??null;
        const responseIntentAt=responsePending?.requestedAt??requestedAt;
        const latestPending=latestCharacter?.pendingMapTransition??null;
        const responseDestination=String(result?.destinationMapId??responsePending?.destinationMapId??characterPatch?.currentMapId??id);
        const freshness=this.mapIntentResponseFreshness(latestCharacter,origin,characterPatch,responseIntentAt,responseDestination);
        const newerRealtimeIntent=freshness.newerRealtimeIntent;
        const responseBehindLocation=freshness.responseBehindLocation;

        let acceptedDestination=String(result?.destinationMapId??responsePending?.destinationMapId??characterPatch?.currentMapId??id);
        let acceptedPending=responsePending;
        // Character realtime snapshots can commit the move while this HTTP request is
        // still in flight. Never patch that newer map state back to the origin using an
        // older "deferred" response (a common race during "searching for monsters").
        if(newerRealtimeIntent&&latestPending){
          acceptedPending=latestPending;
          acceptedDestination=String(latestPending.destinationMapId);
        }else if(responseBehindLocation&&latestCharacter){
          acceptedPending=latestPending;
          acceptedDestination=String(latestCharacter.currentMapId);
        }

        this.destinationRequestedAt=acceptedPending?.destinationMapId===acceptedDestination
          ?acceptedPending?.requestedAt??responseIntentAt
          :requestedAt;
        this.routeOriginMapId.set(newerRealtimeIntent&&latestCharacter?latestCharacter.currentMapId:origin);
        this.transitionOriginMapId=latestCharacter?.currentMapId??characterPatch.currentMapId??origin;
        this.destinationTransitionWasDeferred=newerRealtimeIntent||(!responseBehindLocation&&!!result?.deferred);
        this.destinationMapId.set(acceptedDestination);
        if(!newerRealtimeIntent&&!responseBehindLocation)this.character.applyPatch(characterPatch);

        // Reconcile synchronously with the freshest known Character state as well as
        // through the signal effect. Arrival is keyed only by currentMapId and is atomic
        // across Town/Grind/any future location type.
        const acceptedCharacter=this.character.character();
        if(acceptedCharacter)this.reconcileDestinationPreview(acceptedCharacter);
        if(result?.deferred||this.mapTransitionPending()){
          // Keep polling only if there is still an active preview. If a newer state
          // already confirmed arrival, continue the ordinary post-transition refresh
          // instead of leaving early or re-enabling the waiting state.
          if(this.destinationMapId()){
            this.mapTransitionPending.set(true);
            this.startTransitionPoll();
            return;
          }
        }
        await Promise.all([this.character.load(),this.battle.load()]);
        this.rebuildDiscovery();
        this.centerOnCurrentMap();
        const acceptedMap=this.maps.find(candidate=>candidate.id===acceptedDestination);
        if(acceptedMap?.type==='grind'){
          this.battle.beginGrindSession();
          try{await this.socket.emit('map:syncPresence',{mapId:acceptedDestination})}catch{}
        }
      },
      error:e=>{if(requestSequence===this.latestMapRequestSequence){const message=String(e?.error?.message??'Map entry rejected by server');this.error.set(message.startsWith('Town Guard:')?'':message);this.finishDestinationPreview()}}
    });
  }
  private startTransitionPoll(){
    if(this.transitionPoll!==null)return;
    this.transitionPoll=setInterval(()=>{
      if(this.transitionPollBusy)return;
      this.transitionPollBusy=true;
      const previousTarget=this.destinationMapId();
      const previousOrigin=this.routeOriginMapId();
      void this.character.load().then(async()=>{
        const c=this.character.character();
        if(!c)return;

        // Use the exact same, type-agnostic reconciliation as socket/HTTP updates.
        // "Town" is not a special arrival signal: only currentMapId determines arrival.
        this.reconcileDestinationPreview(c);
        const transitionFinished=!!previousTarget&&this.destinationMapId()===null;
        if(!transitionFinished)return;

        const arrivedMap=this.maps.find(m=>m.id===c.currentMapId);
        if(c.currentMapId!==previousOrigin&&arrivedMap?.type==='grind'){
          this.battle.beginGrindSession();
          try{await this.socket.emit('map:syncPresence',{mapId:c.currentMapId})}catch{}
        }
        await this.battle.load();
        this.rebuildDiscovery();
        this.centerOnCurrentMap();
      }).finally(()=>{this.transitionPollBusy=false});
    },1000);
  }
  private clearDestinationPreview(){this.destinationMapId.set(null);this.routeOriginMapId.set(null)}
  private stopTransitionPoll(){if(this.transitionPoll!==null){clearInterval(this.transitionPoll);this.transitionPoll=null}}

  /** Active server travel always wins over local preview bookkeeping that can be stale after battle events. */
  displayDestinationMapId():string|null{
    const character:any=this.character.character();
    const intent:any=character?.travelIntent;
    if(intent?.destinationMapId&&String(intent.destinationMapId)!==String(character?.currentMapId??''))return String(intent.destinationMapId);
    return this.destinationMapId();
  }

  /** Active server route is the source of truth; local BFS is only a preview before the server intent arrives. */
  destinationRoute():Array<{x:number;y:number}>{
    const character:any=this.character.character();
    const intent:any=character?.travelIntent;
    const activeRouteIds:string[]=Array.isArray(intent?.routeMapIds)?intent.routeMapIds.map(String):[];
    const target=this.displayDestinationMapId();
    if(intent&&activeRouteIds.length>1&&activeRouteIds[activeRouteIds.length-1]===target){
      const startIndex=Math.max(0,Math.min(activeRouteIds.length-1,Math.floor(Number(intent.segmentIndex??0))));
      const remaining=activeRouteIds.slice(startIndex);
      const route=remaining.map((id:string)=>this.maps.find(m=>m.id===id)).filter(Boolean) as any[];
      return route.map((map:any)=>({x:(Number(map.coordinates.x)+7)*153+76.5,y:(6-Number(map.coordinates.y))*153+76.5}));
    }
    const routeOriginId=intent?String(character?.currentMapId??''):this.routeOriginMapId();
    const origin=(routeOriginId?this.maps.find(m=>m.id===routeOriginId):null)??this.currentMap();
    const destination=this.maps.find(m=>m.id===target);
    if(!origin||!destination||origin.id===destination.id)return [];
    const pos=(m:any)=>({x:Number(m.coordinates.x),y:Number(m.coordinates.y)});
    const key=(m:any)=>m.id;
    const queue=[origin];const previous=new Map<string,string|null>([[key(origin),null]]);const byId=new Map(this.maps.map(m=>[m.id,m]));
    while(queue.length){
      const current=queue.shift()!;if(current.id===destination.id)break;
      const a=pos(current);
      const neighbors=this.maps.filter(candidate=>candidate.isClickable!==false)
        .filter(candidate=>{const b=pos(candidate);return Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1})
        .sort((left,right)=>left.id.localeCompare(right.id));
      for(const neighbor of neighbors){if(previous.has(key(neighbor)))continue;previous.set(key(neighbor),key(current));queue.push(neighbor)}
    }
    let route:any[]=[];
    if(!previous.has(destination.id))return [];
    let current:string|null=destination.id;
    while(current){const node=byId.get(current);if(node)route.unshift(node);current=previous.get(current)??null}
    return route.map(node=>({x:(Number(node.coordinates.x)+7)*153+76.5,y:(6-Number(node.coordinates.y))*153+76.5}));
  }
  destinationRoutePoints(){return this.destinationRoute().map(point=>`${point.x},${point.y}`).join(' ')}
  destinationPinStyle(map:any){return map.id===this.displayDestinationMapId()}
  ngOnDestroy(){clearInterval(this.activityTimer);this.stopTransitionPoll();this.hideTileTooltip();if(this.fleeNoticeTimeout!==null)clearTimeout(this.fleeNoticeTimeout)}
}

@Component({ selector: 'app-inventory-grid', standalone: true, imports: [CommonModule, CdkDropList, CdkDrag, CdkDragPreview, CdkDragPlaceholder, TooltipPositionDirective], templateUrl: './inventory-grid.html', styleUrl: './inventory-grid.css', styles: [':host-context(.market-inventory-grid) .panel{height:auto;min-height:0;padding:0;background:transparent}:host-context(.market-inventory-grid) .panel-title{font-size:15px;letter-spacing:1px;margin-bottom:5px}:host-context(.market-inventory-grid) .inventory-sort-button{width:25px;height:23px}:host-context(.market-inventory-grid) .inv-grid{grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:none;grid-auto-rows:auto;gap:3px;overflow:auto;max-height:240px;flex:0 1 auto}:host-context(.market-inventory-grid) .inv-slot{min-height:0}:host-context(.market-inventory-grid) .item b{font-size:12px;right:2px;bottom:1px}'] })
export class InventoryGrid implements OnDestroy {
  readonly inventory = inject(InventoryStore); readonly catalog = inject(CatalogService); readonly battle = inject(BattleStore); readonly vendor = inject(VendorStore);
  slots = Array.from({ length: 50 }, (_, i) => i);
  readonly characterSlotIds = ['character-slot-head', 'character-slot-body', 'character-slot-mainHand', 'character-slot-offHand', 'character-slot-shoes', 'character-slot-cape', 'character-slot-accessoryLeft', 'character-slot-accessoryRight'];
  readonly vendorDropListIds = ['vendor-drop-list', 'storage-drop-list', 'market-sell-drop', 'mail-attachment-drop'];
  readonly storageDropListIds = ['storage-drop-list'];
  readonly now = signal(Date.now());
  readonly highlightedSlot = signal<number | null>(null);
  readonly sorting = signal(false);
  readonly sortError = signal<string | null>(null);
  readonly splitItem = signal<any | null>(null);
  readonly splitQuantity = signal(1);
  private readonly timer = setInterval(() => this.now.set(Date.now()), 250);
  item(i: number) { return this.inventory.items().find(x => x.slotIndex === i) }
  itemTitle(i: any) { return this.catalog.item(i.itemId)?.name ?? i.itemId }
  itemDefinition(i: any) { return this.catalog.item(i.itemId) }
  itemTooltipLines(i: any) { return this.catalog.itemTooltipLines(i.itemId, i.instanceData) }
  formatItemEffect(effect: any) { if (!effect) return ''; if (effect.status) { const status = String(effect.status).replace(/_/g, ' '); return `Cures ${status}.` } if (effect.type === 'heal_hp') return `Restores ${Number(effect.amount) || 0} HP.`; if (effect.type === 'heal_sp') return `Restores ${Number(effect.amount) || 0} SP.`; if (effect.type === 'food_buff') return `Regenerates HP/SP for ${Math.round((Number(effect.durationSeconds) || 0) / 60)} minutes.`; return String(effect.type ?? '').replace(/_/g, ' ').replace(/^./, x => x.toUpperCase()) + '.' }
  itemTierClass(i: any) { const tier = Number((this.itemDefinition(i) as any)?.tier ?? 0); return tier >= 2 && tier <= 5 ? 'tier-' + tier : '' }
  glyph(i: any) { return this.catalog.itemIcon(i.itemId) }
  elapsedTick() { const b = this.battle.active(); if (!b) return -1; return Math.max(0, Math.floor((this.now() - Date.parse(b.startAt)) / 1000)) }
  displayQuantity(it: any) { return Number(it.quantity ?? 0) }
  onItemClick(event: MouseEvent, item: any) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    const definition: any = this.catalog.item(item.itemId);
    if (Number(item.quantity) <= 1 || definition?.stackable !== true || Number(definition?.maxStack ?? 1) <= 1) return;
    this.splitItem.set(item);
    this.splitQuantity.set(1);
  }
  setSplitQuantity(event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    this.splitQuantity.set(Number.isFinite(value) ? Math.trunc(value) : 0);
  }
  closeSplitModal() { this.splitItem.set(null); }
  async confirmSplit() {
    const item = this.splitItem();
    if (!item) return;
    const quantity = this.splitQuantity();
    this.splitItem.set(null);
    try { await this.inventory.splitStack(item.id, quantity); }
    catch { /* The API records validation failures in the red System Journal. */ }
  }
  onDragStart(ev: CdkDragStart<any>) {
    this.inventory.beginDrag(ev.source.data.itemId);
    this.sortError.set(null);
    document.dispatchEvent(new Event('nm:drag-start'));
  }
  onDragEnd() {
    this.inventory.endDrag();
    this.highlightedSlot.set(null);
    document.dispatchEvent(new Event('nm:drag-end'));
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent) {
    if (!this.inventory.draggedItemId()) { this.highlightedSlot.set(null); return; }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.inv-slot[data-slot-index]');
    const grid = document.getElementById('inventory-drop-list');
    this.highlightedSlot.set(target && grid?.contains(target) ? Number(target.dataset['slotIndex']) : null);
  }

  private slotAtPoint(x: number, y: number): number | null {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('.inv-slot[data-slot-index]');
    const grid = document.getElementById('inventory-drop-list');
    if (!target || !grid?.contains(target)) return null;
    const slot = Number(target.dataset['slotIndex']);
    return Number.isInteger(slot) && slot >= 0 && slot < 50 ? slot : null;
  }

  async sortInventory() {
    if (this.sorting()) return;
    this.sorting.set(true);
    this.sortError.set(null);
    const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
    const ordered = [...this.inventory.items()].sort((a, b) => {
      const typeA = String(this.catalog.item(a.itemId)?.type ?? 'unknown');
      const typeB = String(this.catalog.item(b.itemId)?.type ?? 'unknown');
      return typeA.localeCompare(typeB, 'en', { sensitivity: 'base' })
        || collator.compare(this.itemTitle(a), this.itemTitle(b))
        || a.itemId.localeCompare(b.itemId)
        || a.id.localeCompare(b.id);
    });
    try {
      await this.inventory.sortInventory(ordered.map(item => item.id));
    } catch (error: any) {
      this.sortError.set(error?.error?.message ?? 'Unable to sort inventory');
    } finally {
      this.sorting.set(false);
    }
  }

  async dropInventory(ev: CdkDragDrop<any>) {
    const data = ev.item.data;
    try {
      if (data?.source === 'inventory') {
        const targetSlot = this.slotAtPoint(ev.dropPoint.x, ev.dropPoint.y);
        if (targetSlot !== null && data.id) await this.inventory.moveItemToSlot(data.id, targetSlot);
      } else if (data?.source === 'equipment') {
        await this.inventory.unequip(data.slot);
      } else if (data?.source === 'vendor') {
        await this.vendor.openBuy(data.stock);
      } else if (data?.source === 'warehouse' && data.id && this.vendor.selectedNpc()?.types.includes('storage')) {
        await this.vendor.transferWarehouseRow(data.id, 'withdraw');
      }
    } catch (error: any) {
      this.sortError.set(error?.error?.message ?? 'Unable to move inventory item');
    } finally {
      this.onDragEnd();
    }
  }
  accessorySlot() { const equipped = this.inventory.equipment(); return equipped.some(x => x.slot === 'accessoryLeft') ? 'accessoryRight' : 'accessoryLeft' }
  async doubleClick(it: any) {
    this.sortError.set(null);
    if (this.vendor.selectedNpc()?.types.includes('storage')) {
      try { await this.vendor.transferWarehouseRow(it.id, 'deposit'); }
      catch (error: any) { this.sortError.set(error?.error?.message ?? 'Unable to transfer item'); }
      return;
    }
    const definition: any = this.catalog.item(it.itemId);
    if (definition?.type === 'consumable' || definition?.type === 'food') {
      try { await this.inventory.useConsumable(it.itemId); }
      catch (error: any) { this.sortError.set(error?.error?.message ?? 'Unable to use item'); }
    } else if (definition?.type === 'equipment' && definition.slot) {
      const slot = definition.slot === 'accessory' ? this.accessorySlot() : definition.slot;
      try { await this.inventory.equip(slot, it.itemId); }
      catch (error: any) { this.sortError.set(error?.error?.message ?? 'Unable to equip item'); }
    }
  }
  dragData(it: any) { return { source: 'inventory', ...it } }
  ngOnDestroy() { clearInterval(this.timer) }
}

@Component({ selector: 'app-vendor-panel', standalone: true, imports: [CommonModule, CdkDropList, CdkDrag, CdkDragPreview, CdkDragPlaceholder, TooltipPositionDirective], templateUrl: './vendor-panel.html', styleUrl: './vendor-panel.css' , styles: [".mailbox-portrait{width:167px;height:199px;display:grid;place-items:center;background:linear-gradient(145deg,#29221a,#100e0c);border:1px solid #80613a;color:#d9b66e;font-size:64px}.mailbox-attachment{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:#d9c39e;font-size:11px}.mailbox-attachment img{width:24px;height:24px;object-fit:contain}.mailbox-tabs{display:flex;gap:5px;margin:10px 0}.mailbox-tabs button,.mailbox-actions button,.mailbox-compose button{background:#28221b;color:#d9c39e;border:1px solid #715532;padding:6px 8px;cursor:pointer}.mailbox-tabs button.active{background:#594225;border-color:#c49a53}.mailbox-compose{display:grid;gap:8px}.mailbox-compose label{display:grid;gap:3px;color:#bfa982;font-size:12px}.mailbox-compose input,.mailbox-compose textarea{width:100%;box-sizing:border-box;background:#100e0c;color:#e5d6b8;border:1px solid #57442d;padding:7px}.mailbox-list{display:grid;gap:7px;max-height:480px;overflow:auto}.mailbox-message{border:1px solid #57442d;background:#17130f;padding:7px}.mailbox-message.unread{border-color:#c49a53}.mailbox-open{display:grid;gap:4px;width:100%;text-align:left;color:#d9c39e;background:transparent;border:0;cursor:pointer}.mailbox-open small{color:#9b8a70}.mailbox-open span{white-space:pre-wrap;overflow-wrap:anywhere}.mailbox-actions{display:flex;gap:5px;margin-top:6px}.mail-attachment-drop{display:flex;align-items:center;justify-content:center;gap:9px;min-height:72px;padding:10px;margin:4px 0 10px;border:1px dashed #8c704a;background:linear-gradient(145deg,#211a13,#100e0c);color:#bca57e;text-align:center;transition:border-color .15s,background .15s}.mail-attachment-drop p{margin:0;font-size:11px;line-height:1.45}.mail-attachment-drop img{width:36px;height:36px;object-fit:contain}.mail-attachment-drop div{display:grid;gap:4px;text-align:left;min-width:0}.mail-attachment-drop small{color:#a9987c;font-size:11px}.mail-attachment-drop button{margin-left:auto;background:transparent;border:1px solid #715532;color:#d9c39e;padding:4px 7px;cursor:pointer}.mail-attachment-drop.cdk-drop-list-receiving{border-color:#d8b66c;background:#302315;box-shadow:0 0 0 2px #c49a5344}.mail-attachment-drop.has-item{border-style:solid;border-color:#78603c}"] })
export class VendorPanel {
  mailAttachment(){ return this.inventory.items().find(row=>row.id===this.vendor.mailboxItemId())??null; }
  dropMailAttachment(event:CdkDragDrop<any>){
    const data=event.item.data;
    if(data?.source!=='inventory'||!data.id)return;
    const row=this.inventory.items().find(item=>item.id===data.id);
    if(!row)return;
    this.vendor.mailboxItemId.set(row.id);
    this.vendor.mailboxItemQuantity.set(String(row.quantity));
  }

  readonly vendor = inject(VendorStore); readonly inventory = inject(InventoryStore); readonly catalog = inject(CatalogService); readonly character = inject(CharacterStore); readonly slots = Array.from({ length: 10 }, (_, i) => i);
  readonly storageDropListIds = ['storage-drop-list'];
  private lastTownMapId: string|null = null;
  constructor() {
    // GrindInfo and its Town panel stay mounted when moving directly between Towns.
    // Reload on physical map identity changes, not only component construction.
    // Angular 18 requires allowSignalWrites when an effect resets store signals.
    effect(() => {
      const c = this.character.character();
      if (!c || c.status !== 'town' || !c.currentMapId || c.currentMapId === this.lastTownMapId) return;
      this.lastTownMapId = c.currentMapId;
      this.vendor.resetForTownEntry();
      void this.vendor.load();
    }, { allowSignalWrites: true });
  }
  npcPortrait(id: string) { return '/assets/npcs/' + id + '.png'; }
  mailTooltip(mail: any) { return this.catalog.itemTooltipLines(mail.itemId, mail.itemInstanceData).map(line => (line.label ? line.label + ': ' : '') + line.value).join(' · '); }
  stockAt(slot: number) { return this.vendor.stock().find(x => x.slotIndex === slot); }
  warehouseAt(slot:number) { return this.vendor.warehouse().find(x=>x.slotIndex===slot); }
  warehouseDragData(row:any) { return { source:'warehouse', ...row }; }
  async doubleClickWarehouse(row:any) { await this.vendor.transferWarehouseRow(row.id,'withdraw'); }
  itemTierClass(itemId: string) { const tier = Number((this.catalog.item(itemId) as any)?.tier ?? 0); return tier >= 2 && tier <= 5 ? 'tier-' + tier : ''; }
  dragData(item: VendorStockItem) { return { source: 'vendor', vendorId: this.vendor.selectedNpcId(), itemId: item.itemId, stock: item }; }
  shouldHighlightDropTarget() {
    return this.inventory.draggedItemId() !== null && !!this.vendor.selectedNpc()?.types.some(type=>type==='vendor'||type==='storage');
  }
  onVendorDragStart(item: { itemId: string }) {
    this.inventory.beginDrag(item.itemId);
    document.dispatchEvent(new Event('nm:drag-start'));
  }
  onVendorDragEnd() {
    this.inventory.endDrag();
    document.dispatchEvent(new Event('nm:drag-end'));
  }
  drop(ev: CdkDragDrop<any>) {
    const data = ev.item.data;
    if (data?.source === 'inventory') { if (this.vendor.selectedNpc()?.types.includes('storage') && data.id) void this.vendor.transferWarehouseRow(data.id,'deposit'); else if (this.vendor.selectedNpc()?.types.includes('vendor')) void this.vendor.openSell(data.itemId, Number(data.quantity), String(data.id ?? '')); }
    this.inventory.endDrag();
    document.dispatchEvent(new Event('nm:drag-end'));
  }
}

@Component({ selector: 'app-battle-progress', standalone: true, imports: [CommonModule], templateUrl: './battle-progress.html', styleUrl: './battle-progress.css' })
export class BattleProgress implements OnDestroy { @Input() entry!: any; readonly now = signal(Date.now()); private readonly timer = setInterval(() => this.now.set(Date.now()), 250); progress() { const s = Date.parse(this.entry.startAt), e = Date.parse(this.entry.endAt); return Math.max(0, Math.min(100, (this.now() - s) / Math.max(1, e - s) * 100)) } remaining() { const sec = Math.max(0, Math.ceil((Date.parse(this.entry.endAt) - this.now()) / 1000)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') } ngOnDestroy() { clearInterval(this.timer) } }

@Component({ selector: 'app-grind-info', standalone: true, imports: [CommonModule, BattleProgress, VendorPanel, TooltipPositionDirective], templateUrl: './grind-info.html', styleUrl: './grind-info.css', styles:[`.foe-mana{height:8px;background:#10131c;border:1px solid #294c70;margin-top:3px}.foe-mana i{display:block;height:100%;background:#3e91df}.mana-label{margin-top:5px}.status-icons,.skill-icons{display:flex;gap:5px;flex-wrap:wrap}.status-icon,.monster-skill-icon{position:relative;width:34px;height:34px;display:grid;place-items:center}.status-icon img,.monster-skill-icon img{width:30px;height:30px;object-fit:contain}.status-icon .status-tooltip,.monster-skill-icon .skill-tooltip{display:none;position:absolute;z-index:100;bottom:calc(100% + 7px);left:0;min-width:180px;max-width:260px;padding:8px;background:#120d09;border:1px solid #80613a;box-shadow:0 4px 14px #000;color:#c9b79a;white-space:normal;pointer-events:none;text-align:left}.monster-skill-icon:hover .skill-tooltip,.monster-skill-icon:focus .skill-tooltip,.monster-skill-icon:focus-within .skill-tooltip{display:flex;flex-direction:column;gap:4px}.status-tooltip strong,.skill-tooltip b{color:#e1cfad;font:15px Georgia}.status-tooltip small,.skill-tooltip small{font:12px Arial;line-height:1.3}.status-icon b{position:absolute;right:-3px;bottom:-3px;font-size:10px}`] })
export class GrindInfo implements OnDestroy {
  isGathering(){return this.character.character()?.lastGrindStance==='gathering' && !this.character.character()?.travelIntent;}
  recentFleeNotice(){const c:any=this.character.character();const raw=c?.encounterCycle?.lastFleeSuccessAt??c?.travelIntent?.lastFleeSuccessAt;const at=Date.parse(String(raw??''));const now=Date.now();return Number.isFinite(at)&&at<=now&&now-at<5000;}

  readonly battle = inject(BattleStore);
  readonly character = inject(CharacterStore);
  readonly inventory = inject(InventoryStore);
  readonly catalog = inject(CatalogService); readonly vendor = inject(VendorStore);
  private readonly api = inject(ApiService);
  readonly now = signal(Date.now());
  readonly savingTown = signal(false);
  readonly townSaveError = signal<string|null>(null);
  private readonly timer = setInterval(() => this.now.set(Date.now()), 250);

  isCurrentTownSaved(){const c=this.character.character();return !!c&&c.status==='town'&&c.currentMapId===c.savedTownMapId;}
  async saveTown(){
    const c=this.character.character();
    if(!c||c.status!=='town'||this.savingTown()||this.isCurrentTownSaved())return;
    this.savingTown.set(true);this.townSaveError.set(null);
    try{const result=await this.api.post<any>('/maps/save-town',{}).toPromise();if(result?.character)this.character.applyPatch(result.character);else if(result?.savedTownMapId)this.character.applyPatch({savedTownMapId:result.savedTownMapId});}
    catch(error:any){this.townSaveError.set(error?.error?.message??'Unable to save this Town');}
    finally{this.savingTown.set(false);}
  }

  stateLabel() { const b = this.battle.active(); if (this.battle.state() === 'reconnecting') return 'RECONNECTING'; if (b && this.isSearching(b)) return 'SEARCHING'; return b ? 'ACTIVE' : 'IDLE' }
  isSearching(entry: any) { return Date.now() < Date.parse(entry.startAt) }
  searchEntry(entry: any) { return { startAt: entry.log?.searchStartAt ?? new Date(Date.parse(entry.startAt) - 2000).toISOString(), endAt: entry.startAt } }
  monsterSnapshot(entry: any) { return (entry.log as any)?.header?.monsterSnapshot ?? {} }
  monsterStatusEffects(entry: any) {
    const now=this.now(); const start=Date.parse(entry.startAt); if(now<start||now>=Date.parse(entry.endAt)) return [];
    const tick=Math.floor((now-start)/1000);
    const active=projectStatusTimeline(this.monsterSnapshot(entry).statusEffects, this.events(entry), 'monster', tick);
    return [...active.entries()].map(([id,stacks])=>{
      const def:any=this.catalog.statusEffect(id)??{name:id,maxStacks:1};
      const expiresAtTick=Math.max(...stacks.map(x=>Number(x.expiresAtTick??tick)));
      const remaining=Number.isFinite(expiresAtTick)?Math.max(0,expiresAtTick-tick):Number.POSITIVE_INFINITY;
      const expiryLabel=Number.isFinite(expiresAtTick)?`Expires at T${expiresAtTick}`:'Duration: until removed';
      const remainingLabel=Number.isFinite(remaining)?`${remaining}s remaining`:'until removed';
      return {id,type:id,stacks:stacks.length,expiresAtTick,expiryLabel,maxStacks:Number(def.maxStacks??1),remaining,name:String(def.name??id.replace(/_/g,' ')),tooltip:`${String(def.name??id)} · ${stacks.length}/${Number(def.maxStacks??1)} stacks · ${remainingLabel}`};
    }).filter(x=>x.stacks>0&&x.remaining>0);
  }
  trackMonsterStatusEffect(_index: number, effect: { id: string }) { return effect.id; }
  monsterSp(entry:any){return Number(this.lastEvent(entry)?.spRemaining?.monster??this.monsterSnapshot(entry).sp??0)}
  monsterMaxSp(entry:any){return Number(this.monsterSnapshot(entry).maxSp??0)}
  monsterSkills(entry:any){const m:any=this.monster(entry.monsterId);const ids=new Set<string>();for(const line of m?.gambit??[]){const a=line?.action??{};const id=String(a.skillId??a.params?.skillId??'');if((a.type==='use_skill'||a.id==='use_skill')&&id)ids.add(id)}return [...ids].map(id=>this.catalog.skills().find((s:any)=>s.id===id)).filter(Boolean)}
  skillTooltip(skill:any){return `${skill.name} · ${Number(skill.spCost??0)} SP · ${Number(skill.baseCastTicks??0)} cast ticks · ${Number(skill.cooldownTicks??0)} cooldown · ${skill.effect?.type??''}`}
  skillIcon(skill:any){return '/assets/ui/skill-icons/'+skill.id+'.svg'}
  monsterStats(entry: any) { const m = this.monsterSnapshot(entry); return [{ label: 'ATK', value: m.atk }, { label: 'MATK', value: m.matk }, { label: 'DEF', value: m.def }, { label: 'MDEF', value: m.mdefPercent + '%' }, { label: 'ACC', value: m.accuracy }, { label: 'EVA', value: m.evasion }, { label: 'CRIT', value: m.critChance + '%' }] }

  isTown() { const c = this.character.character(); return !!c && c.status === 'town' && !c.travelIntent && !c.pendingMapTransition }
  activeGambitTitle() { return this.character.character()?.activeGambitPageId ? 'Configured' : 'Not configured' }
  xpText() { const c = this.character.character(); return c ? `${c.xp} / ${c.xpToNext}` : '—' }
  monster(id: string) { return this.catalog.monster(id) }
  monsterSprite(id: string) { return '/assets/monsters/' + id + '.svg'; }
  consumableItems() { return this.inventory.items().filter(x => this.catalog.item(x.itemId)?.type === 'consumable').slice(0, 3) } displayQuantity(it: any) { return Number(it.quantity ?? 0) }
  elapsedTicks(entry: any) { const start = Date.parse(entry.startAt); const duration = Number(entry.log?.durationTicks ?? Math.max(1, (Date.parse(entry.endAt) - start) / 1000)); return Math.max(0, Math.min(duration, Math.floor((this.now() - start) / 1000))) }
  events(entry: any) { return Array.isArray(entry.log?.events) ? entry.log.events : [] }
  lastEvent(entry: any) { const tick = this.elapsedTicks(entry); let state = entry.log?.header?.characterSnapshot && { tick: -1, hpRemaining: { character: Number(entry.log.header.characterSnapshot.hp ?? 0), monster: Number(entry.log.header.monsterSnapshot?.hp ?? 0) } }; for (const e of this.events(entry)) { if (Number(e.tick ?? 0) <= tick) state = e; else break } return state }
  characterHp(entry: any) { return Number(this.lastEvent(entry)?.hpRemaining?.character ?? entry.hpAfter ?? 0) }
  monsterHp(entry: any) { return Number(this.lastEvent(entry)?.hpRemaining?.monster ?? entry.log?.header?.monsterSnapshot?.hp ?? 0) }
  characterMaxHp(entry: any) { return Number(entry.log?.header?.characterSnapshot?.maxHp ?? 0) }
  monsterMaxHp(entry: any) { return Number(entry.log?.header?.monsterSnapshot?.maxHp ?? entry.log?.header?.monsterSnapshot?.hp ?? 0) }
  monsterLevel(entry: any) { return Number(this.monsterSnapshot(entry).level ?? 0) }
  percent(v: number, max: number) { return max > 0 ? Math.max(0, Math.min(100, v / max * 100)) : 0 }
  recentEvents(entry: any) { const tick = this.elapsedTicks(entry); return this.events(entry).filter((e: any) => e.action !== 'range_blocked' && e.action !== 'action_suppressed' && Number(e.tick ?? 0) <= tick).slice(-4).reverse() }
  eventText(e: any) {
    if (e.action === 'range_blocked') return '';
    const playerName = this.character.character()?.name ?? 'Character';
    const monsterName = this.monster(this.battle.active()?.monsterId ?? '')?.name ?? 'Monster';
    if (e.action === 'move') {
      const actor = e.actor === 'character' ? playerName : monsterName;
      const spaces = Number(e.spacesMoved ?? Math.abs(Number(e.toPosition ?? 0) - Number(e.fromPosition ?? 0)));
      const fromPosition = Number(e.fromPosition);
      const toPosition = Number(e.toPosition);
      const hasPositionDelta = e.fromPosition != null && e.toPosition != null
        && Number.isFinite(fromPosition) && Number.isFinite(toPosition) && fromPosition !== toPosition;
      const arrow = hasPositionDelta
        ? (toPosition > fromPosition ? '-->' : '<--')
        : (e.direction === 'right' || e.direction === 1 || e.direction === '1')
          ? '-->'
          : (e.direction === 'left' || e.direction === -1 || e.direction === '-1')
            ? '<--'
            : '';
      return `${actor} moved ( ${spaces} ) ${arrow}`;
    }
    const actor = e.actor === 'character' ? playerName : monsterName;
    const target = e.target === 'character' ? playerName : e.target === 'monster' ? monsterName : actor;
    if (e.action === 'sp_regen') return `${monsterName} regenerates ${Number(e.amount ?? 0)} SP.`;
    const status = String(e.status ?? 'status').replace(/_/g, ' ').toLowerCase();
    if (e.action === 'status_damage') return `${target} takes ${Number(e.damage ?? 0)} pure ${status} damage`;
    if (e.action === 'freeze_applied') return `${target} is freezing (${Number(e.stackCount ?? 1)})`;
    if (e.action === 'status_stack_applied') return `${target} gains ${status} from ${actor} (${Number(e.stackCount ?? 1)})`;
    if (e.action === 'status_stack_lessened') return `${target}'s ${status} lessens (${Number(e.remainingStacks ?? e.stackCount ?? 0)})`;
    if ((e.sourceSkillId === 'shield_bash' || e.passiveProc === true) && status === 'stun') return `${target} is stunned by Shield Bash.`;
    if (e.action === 'status_ended' || e.action === 'status_expired') return `${target}'s ${status} ended`;
    if (e.action === 'status_applied' || e.action === 'status_refreshed') return `${actor} applies ${status} to ${target}`;
    if (e.action === 'attack') { 
      const damage = Number(e.damage ?? 0);
      if (damage === 0) return actor + ' misses!';
      const critical = e.crit ? ' CRITICAL!' : ''; 
      return actor + ' attacks for ' + damage + critical; 
    }
    if (e.action === 'regen') {
      const resource = String(e.resource ?? 'HP').replace(/_regen$/, '').toUpperCase() || 'HP';
      return `${actor} regenerated ${Number(e.amount ?? 0)} ${resource}.`;
    }
    if (e.action === 'use_item') return (e.actor === 'character' ? playerName + ' uses ' : monsterName + ' uses ') + String(e.itemId ?? 'item').replaceAll('_', ' ');
    if (e.action === 'use_skill') {
      const skill = String(e.skillId ?? 'skill') === 'monster_skill_ice_bolt' ? 'Ice Bolt' : String(e.skillId ?? 'skill').replaceAll('_', ' ');
      const damage = e.damage != null ? ' for ' + Number(e.damage) + ' damage' : '';
      const healing = e.healAmount != null ? ' and healed ' + Number(e.healAmount) + ' HP' : '';
      return actor + ' casts ' + skill + damage + healing;
    }
    return String(e.action ?? 'event');
  }
  sessionDrops() { return this.battle.sessionDrops() }
  sessionDropName(it: any) { return this.catalog.item(it.itemId)?.name ?? it.itemId }
  sessionDropIcon(it: any) { return this.catalog.itemIcon(it.itemId) }
  // Every food digests for the same duration, so the most recent entry always carries the
  // latest digestUntil. That makes the pruned diet length and the authoritative hungry flag
  // the same fact, and the label stays identical to what the slots render.
  foodLabel() { const count = this.character.character()?.diet?.length ?? 0; return count <= 0 ? 'HUNGRY' : count === 1 ? 'FED' : count === 2 ? 'SATISFIED' : 'FULL' }
  ngOnDestroy() { clearInterval(this.timer) }
}
