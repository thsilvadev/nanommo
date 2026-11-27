import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, InjectionToken, NgZone, OnDestroy, ViewChild, ViewEncapsulation, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { teleportActivityOf, teleportStartedAtMs } from '../../../core/party-projection';
import type { VisibleEquipment } from '@nanommo/shared';
import { BattleStore, CharacterStore, InventoryStore } from '../../../core/game.store';
import { CatalogService } from '../../../core/catalog.service';
import { LocaleService } from '../../../core/locale.service';
import { PartyStore } from '../../../core/party.store';
import { ServerClockService } from '../../../core/server-clock.service';
import { isWebglAvailable } from '../../../shared/character-viewer/appearance-catalog';
import { loadMonsterManifest, monsterAttackStyle, monsterManifestKey, type MonsterManifestEntry } from '../../../shared/monster-viewer/monster-model';
import { portraitEquipment, portraitHandTypes, portraitRefinement } from '../character-portrait';
import { ArenaFeedbackOwner } from './arena-feedback-owner.service';
import { ArenaMonsterWarmup } from './arena-monster-warmup.service';
import { arenaMapFade, nextMapChange, settleMapChange, type ArenaMapChange } from './arena-map-fade';
import { arenaRegionOf } from './arena-region';
import { ARENA_CAMERA_PITCH_DEG, arenaFocusOrder, arenaFocusSlot, clampOrbit } from './arena-camera';
import { ArenaSceneSource, type ArenaResolvedEntry, type ArenaSourceInputs } from './arena-scene-source';
import type { ArenaFrameInput, ArenaRuntimeHandle, ArenaRuntimeInit } from './arena-runtime';
import type { ArenaBattleOptions, ArenaCharacterLook } from './arena.types';
import { arenaLook } from './arena-battle';

export interface ArenaSceneEnv {
  webglAvailable: () => boolean;
  /** three.js and the runtime load only when the arena is first shown. */
  createRuntime: (host: HTMLElement, init: ArenaRuntimeInit) => Promise<ArenaRuntimeHandle>;
}
export const ARENA_SCENE_ENV = new InjectionToken<ArenaSceneEnv>('ARENA_SCENE_ENV', {
  providedIn: 'root',
  factory: () => ({ webglAvailable: isWebglAvailable, createRuntime: async (host, init) => (await import('./arena-runtime')).createArenaRuntime(host, init) }),
});

/** HUD refresh rate (positions follow the 3D anchors; the canvas itself runs at the display rate). */
const HUD_MS = 33;
/** One wheel notch of zoom (0…1), and the zoom a focus key brings at least. */
const ZOOM_STEP = 0.2;
const FOCUS_ZOOM = 0.6;
/** Degrees the camera turns per pixel dragged. */
const ORBIT_DEG_PER_PX = 0.35;
/** A key typed into a field (chat, search) is text, not a camera command. */
const typing = (target: EventTarget | null): boolean => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The battle arena view of the world panel: hosts the three.js runtime and an HTML
 * HUD over it (names, HP/SP/cast bars, floating numbers, the party-wipe fade). It
 * owns the floating numbers and hit flashes while it is shown (ArenaFeedbackOwner).
 */
@Component({
  selector: 'app-arena-scene', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './arena-scene.component.html', styleUrl: './arena-scene.component.css',
  // The HUD is written straight to the DOM (no change detection at 30 Hz), so its styles cannot be
  // emulated-encapsulated: every selector is scoped under `app-arena-scene` instead.
  encapsulation: ViewEncapsulation.None,
})
export class ArenaSceneComponent implements AfterViewInit, OnDestroy {
  readonly active = input(false);
  readonly mapId = input<string | null>(null);
  @ViewChild('stage', { static: true }) stage!: ElementRef<HTMLElement>;
  @ViewChild('hudLayer', { static: true }) hudLayer!: ElementRef<HTMLElement>;
  @ViewChild('wipe', { static: true }) wipe!: ElementRef<HTMLElement>;
  @ViewChild('flash', { static: true }) flash!: ElementRef<HTMLElement>;

  readonly failed = signal(false);
  private readonly hudViews = new Map<string, HudView>();
  /** Floating numbers on screen, by feedback key (each removes itself when its animation ends). */
  private readonly shownNumbers = new Map<string, HTMLElement>();
  readonly locale = inject(LocaleService);

  /** The player's camera: zoom 0 (automatic frame) … 1 (close shot), on `focusId` (null: their own character). */
  private zoom = 0;
  private focusId: string | null = null;
  /** The player's orbit round the centred fighter (click and drag); the broadcast camera at 0 / the default pitch. */
  private yawDeg = 0;
  private pitchDeg = ARENA_CAMERA_PITCH_DEG;
  private orbitDrag: { id: number; x: number; y: number } | null = null;
  private readonly env = inject(ARENA_SCENE_ENV);
  private readonly character = inject(CharacterStore);
  private readonly inventory = inject(InventoryStore);
  private readonly battles = inject(BattleStore);
  private readonly party = inject(PartyStore);
  private readonly catalog = inject(CatalogService);
  private readonly clock = inject(ServerClockService);
  private readonly owner = inject(ArenaFeedbackOwner);
  private readonly warmup = inject(ArenaMonsterWarmup);
  private readonly zone = inject(NgZone);
  private runtime: ArenaRuntimeHandle | null = null;
  private manifest: Record<string, MonsterManifestEntry> = {};
  private readonly battleOptions: ArenaBattleOptions = {
    monsterStyle: (id) => monsterAttackStyle(this.manifest[monsterManifestKey(id)]),
    handTypes: (equipment) => portraitHandTypes(rows(equipment), (id) => this.catalog.item(id) as { weaponType?: string } | undefined),
  };
  private readonly source = new ArenaSceneSource(this.battleOptions);
  /** The party members' looks, converted once per party snapshot (the frame loop reads them 60 times a second). */
  private memberLooksOf: { members: unknown; looks: Record<string, ArenaCharacterLook | null> } | null = null;
  private latest: ArenaFrameInput | null = null;
  private hudTimer: ReturnType<typeof setInterval> | null = null;
  private gatherAtMs: number | null = null;
  private lastCycle: number | null = null;
  private lastCycleMapId: string | null = null;
  /** The last map change (white fade, scene swapped at the peak) and the map seen before any change. */
  private mapChange: ArenaMapChange | null = null;
  private seenMapId: string | null = null;
  private shared: { id: string; atMs: number } | null = null;
  /**
   * Recently resolved solo entries (a flee or cancellation cuts the cached battle short). Read from the
   * store, which updates it with the queue in one handler: a frame never sees an entry gone from the queue
   * whose resolution is not known yet (the arena would take it for a deleted battle).
   */
  private readonly resolved = computed<ArenaResolvedEntry[]>(() => this.battles.recentResolved().map((r) => ({ entryId: r.entryId, cancelledAt: r.cancelledAt ?? null, cancellationReason: r.cancellationReason ?? null })));
  private destroyed = false;

  constructor() {
    // A completed gather (the cycle index grows on the same map): the viewing character kneels.
    // Entering a map also starts a new cycle (map.service), which is not a gather.
    effect(() => {
      const c = this.character.character();
      const cycle = Number(c?.gatheringCycle?.cycleIndex);
      if (!Number.isFinite(cycle)) return;
      const mapId = c?.currentMapId ?? null;
      if (this.lastCycle !== null && cycle > this.lastCycle && mapId === this.lastCycleMapId) this.gatherAtMs = this.clock.now();
      this.lastCycle = cycle;
      this.lastCycleMapId = mapId;
    });
    // A map change fades the arena to white and swaps the scene at the peak.
    effect(() => {
      const mapId = this.mapId() ?? this.character.character()?.currentMapId ?? null;
      if (!mapId) return;
      untracked(() => {
        const shown = this.mapChange ? this.mapChange.toMapId : this.seenMapId;
        if (shown === mapId) return;
        if (this.seenMapId === null) { this.seenMapId = mapId; return; }
        this.mapChange = nextMapChange(this.mapChange, mapId, this.clock.now(), this.seenMapId);
      });
    });
    // Party battles are only known once created: remember when this client first saw each one.
    effect(() => {
      const battle = this.party.battle();
      if (battle && battle.id !== this.shared?.id) this.shared = { id: battle.id, atMs: Math.max(this.clock.now(), Date.parse(battle.startAt)) };
    });
    effect(() => {
      const active = this.active();
      untracked(() => { const usable = active && !!this.runtime && !this.failed(); this.runtime?.setActive(usable); this.owner.arenaVisible.set(usable); });
    });
    // The species the player can meet soon: textures uploaded and shaders linked before they appear.
    effect(() => {
      const ids = this.warmup.wanted();
      untracked(() => { const runtime = this.runtime; if (runtime && !this.failed()) this.zone.runOutsideAngular(() => void runtime.warmMonsters(ids)); });
    });
    void loadMonsterManifest().then((m) => { this.manifest = m; });
  }

  async ngAfterViewInit(): Promise<void> {
    if (!this.env.webglAvailable()) { this.failed.set(true); return; }
    try {
      const runtime = await this.zone.runOutsideAngular(() => this.env.createRuntime(this.stage.nativeElement, {
        assetBase: '/assets/character/', onContextLost: () => this.contextLost(), now: () => this.clock.now(),
      }));
      if (this.destroyed) { runtime.dispose(); return; }
      this.runtime = runtime;
      runtime.setSource((now) => (this.latest = this.source.build(this.inputs(now))));
      runtime.setActive(this.active());
      this.owner.arenaVisible.set(this.active());
      void runtime.warmMonsters(untracked(() => this.warmup.wanted()));
      this.zone.runOutsideAngular(() => { this.hudTimer = setInterval(() => this.refreshHud(), HUD_MS); });
    } catch {
      this.failed.set(true);
    }
  }

  /** Wheel over the arena: zoom in (up) / out (down); all the way out goes back to the automatic frame. */
  onWheel(event: WheelEvent): void {
    if (!this.runtime || !event.deltaY) return;
    event.preventDefault();
    this.zoom = Math.max(0, Math.min(1, this.zoom + (event.deltaY < 0 ? 1 : -1) * ZOOM_STEP));
    if (this.zoom === 0) { this.focusId = null; this.yawDeg = 0; this.pitchDeg = ARENA_CAMERA_PITCH_DEG; }
    this.pushView();
  }

  /** Click and drag over the arena: turn the camera round the centred fighter (centring the player first). */
  onPointerDown(event: PointerEvent): void {
    if (!this.runtime || event.button !== 0) return;
    event.stopPropagation();
    this.orbitDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId); } catch { /* a synthetic pointer cannot be captured */ }
    if (this.zoom === 0) { this.zoom = FOCUS_ZOOM; this.pushView(); }
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.orbitDrag;
    if (!drag || drag.id !== event.pointerId) return;
    const orbit = clampOrbit(this.yawDeg - (event.clientX - drag.x) * ORBIT_DEG_PER_PX, this.pitchDeg + (event.clientY - drag.y) * ORBIT_DEG_PER_PX);
    drag.x = event.clientX; drag.y = event.clientY;
    this.yawDeg = orbit.yawDeg; this.pitchDeg = orbit.pitchDeg;
    this.pushView();
  }

  onPointerUp(event: PointerEvent): void {
    if (this.orbitDrag?.id === event.pointerId) this.orbitDrag = null;
  }

  /** 1…9, 0, -, =, [, ], \\ and Numpad1…5: centre on the 1st…20th living fighter (never while typing). */
  @HostListener('window:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (!this.runtime || !this.active() || event.ctrlKey || event.altKey || event.metaKey || typing(event.target)) return;
    const slot = arenaFocusSlot(event);
    if (slot === null) return;
    const actors = this.latest?.scene.frame.actors ?? [];
    const team = (id: string) => this.latest?.visuals.get(id)?.team ?? 'a';
    const id = arenaFocusOrder(actors.map((a) => ({ id: a.id, team: team(a.id), deadAtMs: a.deadAtMs, fleeing: a.fleeing })))[slot];
    if (!id) return;
    event.preventDefault();
    this.focusId = id;
    this.zoom = Math.max(this.zoom, FOCUS_ZOOM);
    this.pushView();
  }

  private pushView(): void {
    this.runtime?.setView({ focusId: this.focusId, selfId: this.character.character()?.id ?? 'self', zoom: this.zoom, yawDeg: this.yawDeg, pitchDeg: this.pitchDeg });
  }

  /** The GPU dropped the arena: show the message and hand the numbers back to the side panels. */
  private contextLost(): void {
    this.failed.set(true);
    this.runtime?.setActive(false);
    this.owner.arenaVisible.set(false);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.hudTimer) clearInterval(this.hudTimer);
    this.owner.arenaVisible.set(false);
    this.runtime?.dispose();
  }

  /** Store snapshot for the frame at `now` (read outside any reactive context). */
  inputs(nowMs: number): ArenaSourceInputs {
    const c = this.character.character();
    const party = this.party.party();
    return {
      nowMs, mapId: (this.mapChange ? arenaMapFade(this.mapChange, nowMs).mapId : null) ?? this.mapId() ?? c?.currentMapId ?? null, selfId: c?.id ?? 'self',
      selfLook: this.selfLook(), selfAttackStyle: this.selfAttackStyle(),
      soloQueue: party ? [] : this.battles.queue(), resolved: this.resolved(),
      shared: party ? this.party.battle() : null,
      sharedReceivedAtMs: this.shared && this.shared.id === this.party.battle()?.id ? this.shared.atMs : null,
      nextEncounterAt: party ? this.party.nextEncounterAt() : null,
      partyIds: party ? this.party.members().map((m) => m.characterId) : [],
      memberLooks: party ? this.memberLooks() : {},
      gatherAtMs: this.gatherAtMs,
      teleportAtMs: teleportStartedAtMs(teleportActivityOf(party, c)),
    };
  }

  /** HUD positions and contents from the latest drawn frame (30 Hz), written straight to the DOM. */
  refreshHud(): void {
    // A region change holds the white until the new scene has loaded (hidden: nothing to wait for).
    if (this.mapChange?.readyAtMs === null) {
      const change = this.mapChange;
      this.mapChange = settleMapChange(change, !this.active() || !!this.runtime?.sceneryReady(arenaRegionOf(change.toMapId)), this.clock.now());
    }
    const frame = this.latest;
    if (!frame || !this.runtime || !this.active()) return;
    const anchors = this.runtime.screenAnchors();
    const now = this.clock.now();
    const scene = frame.scene;
    const seen = new Set<string>();
    if (scene.hud) {
      for (const a of scene.frame.actors) {
        const anchor = anchors.get(a.id);
        const visual = frame.visuals.get(a.id);
        if (!anchor?.visible || !visual || a.deadAtMs !== null || (a.exit ?? 0) > 0) continue;
        seen.add(a.id);
        const maxHp = visual.maxHp ?? 0, maxSp = visual.maxSp ?? 0;
        this.hudView(a.id, visual.name, visual.team).update(anchor.x, anchor.y,
          maxHp > 0 ? a.hp / maxHp : 0, maxSp > 0 ? a.sp / maxSp : null,
          a.cast ? (now - a.cast.startedAtMs) / Math.max(1, a.cast.endsAtMs - a.cast.startedAtMs) : null);
      }
    }
    for (const [id, view] of this.hudViews) if (!seen.has(id)) { view.root.remove(); this.hudViews.delete(id); }
    for (const [i, f] of scene.frame.feedback.entries()) {
      const anchor = anchors.get(f.targetId);
      if (!anchor?.visible || this.shownNumbers.has(f.key)) continue;
      this.showNumber(f.key, anchor.x, anchor.y + 24, f.text === 'Miss' ? this.locale.t('Miss') : f.text, f.style, ((i % 5) - 2) * 12);
    }
    const white = String(Math.round(arenaMapFade(this.mapChange, now).white * 100) / 100);
    if (this.flash.nativeElement.style.opacity !== white) this.flash.nativeElement.style.opacity = white;
    const fade = String(scene.fade);
    if (this.wipe.nativeElement.style.opacity !== fade) this.wipe.nativeElement.style.opacity = fade;
  }

  private hudView(id: string, name: string, team: 'a' | 'b'): HudView {
    let view = this.hudViews.get(id);
    if (!view) { view = new HudView(name, team); this.hudLayer.nativeElement.appendChild(view.root); this.hudViews.set(id, view); }
    return view;
  }

  /** A floating number at the actor, in the panels' style; its CSS animation carries it and it then removes itself. */
  private showNumber(key: string, x: number, y: number, text: string, style: string, offset: number): void {
    const el = document.createElement('span');
    el.className = `floating-damage arena-number floating-damage--${style}`;
    el.textContent = text;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.style.setProperty('--damage-offset-x', `${offset}px`);
    this.hudLayer.nativeElement.appendChild(el);
    this.shownNumbers.set(key, el);
    const remove = () => { el.remove(); setTimeout(() => this.shownNumbers.delete(key), 2000); };
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 1800);
  }

  private memberLooks(): Record<string, ArenaCharacterLook | null> {
    const members = this.party.members();
    if (this.memberLooksOf?.members !== members) {
      this.memberLooksOf = { members, looks: Object.fromEntries(members.filter((m) => m.look !== undefined).map((m) => [m.characterId, arenaLook(m.look ?? null, this.battleOptions)])) };
    }
    return this.memberLooksOf.looks;
  }

  private selfLook(): ArenaCharacterLook | null {
    const c = this.character.character();
    if (!c?.appearance || !c.sex) return null;
    const equipment = this.inventory.equipment();
    const hands = portraitHandTypes(equipment, (id) => this.catalog.item(id) as { weaponType?: string } | undefined);
    return {
      sex: c.sex, heightCm: c.heightCm ?? (c.sex === 'female' ? 168 : 178), appearance: c.appearance, dominantHand: c.dominantHand === 'left' ? 'left' : 'right',
      equipment: portraitEquipment(equipment), refinement: portraitRefinement(equipment), mainHandType: hands.main, offHandType: hands.off,
    };
  }

  private selfAttackStyle(): 'melee' | 'bow' {
    const look = this.selfLook();
    return look?.mainHandType === 'bow' || look?.offHandType === 'bow' ? 'bow' : 'melee';
  }
}

function rows(equipment: VisibleEquipment): Array<{ slot: string; itemId: string }> {
  return Object.entries(equipment).filter(([, id]) => !!id).map(([slot, itemId]) => ({ slot, itemId: itemId as string }));
}

/** One combatant's name and bars, updated in place (no Angular in the 30 Hz path). */
class HudView {
  readonly root = document.createElement('div');
  private readonly hp: HTMLElement;
  private readonly sp: HTMLElement;
  private readonly cast: HTMLElement;
  private last = '';
  constructor(name: string, team: 'a' | 'b') {
    this.root.className = `arena-hud${team === 'b' ? ' arena-hud--foe' : ''}`;
    const label = document.createElement('span'); label.className = 'arena-hud-name'; label.textContent = name;
    const bar = (kind: string) => { const outer = document.createElement('span'); outer.className = `arena-bar arena-bar--${kind}`; const inner = document.createElement('i'); outer.appendChild(inner); this.root.appendChild(outer); return inner; };
    this.root.appendChild(label);
    this.hp = bar('hp'); this.sp = bar('sp'); this.cast = bar('cast');
  }
  update(x: number, y: number, hp: number, sp: number | null, cast: number | null): void {
    const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10}%`;
    const key = `${Math.round(x)}|${Math.round(y)}|${pct(hp)}|${sp === null ? '-' : pct(sp)}|${cast === null ? '-' : pct(cast)}`;
    if (key === this.last) return;
    this.last = key;
    this.root.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    this.hp.style.width = pct(hp);
    (this.sp.parentElement as HTMLElement).style.display = sp === null ? 'none' : '';
    if (sp !== null) this.sp.style.width = pct(sp);
    (this.cast.parentElement as HTMLElement).style.display = cast === null ? 'none' : '';
    if (cast !== null) this.cast.style.width = pct(cast);
  }
}
