import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, InjectionToken, NgZone, OnDestroy, ViewChild, effect, inject, input, signal, untracked } from '@angular/core';
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
import { ArenaSceneSource, type ArenaSourceInputs } from './arena-scene-source';
import type { ArenaFrameInput, ArenaRuntimeHandle, ArenaRuntimeInit } from './arena-runtime';
import type { ArenaCharacterLook } from './arena.types';

export interface ArenaSceneEnv {
  webglAvailable: () => boolean;
  /** three.js and the runtime load only when the arena is first shown. */
  createRuntime: (host: HTMLElement, init: ArenaRuntimeInit) => Promise<ArenaRuntimeHandle>;
}
export const ARENA_SCENE_ENV = new InjectionToken<ArenaSceneEnv>('ARENA_SCENE_ENV', {
  providedIn: 'root',
  factory: () => ({ webglAvailable: isWebglAvailable, createRuntime: async (host, init) => (await import('./arena-runtime')).createArenaRuntime(host, init) }),
});

export interface ArenaHudItem { id: string; x: number; y: number; name: string; team: 'a' | 'b'; hp: number; sp: number; hasSp: boolean; cast: number | null }
export interface ArenaNumber { key: string; x: number; y: number; text: string; style: string; offset: number }
/** HUD refresh rate (positions follow the 3D anchors; the canvas itself runs at the display rate). */
const HUD_MS = 33;

/**
 * The battle arena view of the world panel: hosts the three.js runtime and an HTML
 * HUD over it (names, HP/SP/cast bars, floating numbers, the party-wipe fade). It
 * owns the floating numbers and hit flashes while it is shown (ArenaFeedbackOwner).
 */
@Component({
  selector: 'app-arena-scene', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './arena-scene.component.html', styleUrl: './arena-scene.component.css',
})
export class ArenaSceneComponent implements AfterViewInit, OnDestroy {
  readonly active = input(false);
  readonly mapId = input<string | null>(null);
  @ViewChild('stage', { static: true }) stage!: ElementRef<HTMLElement>;

  readonly hud = signal<ArenaHudItem[]>([]);
  readonly numbers = signal<ArenaNumber[]>([]);
  readonly fade = signal(0);
  readonly failed = signal(false);
  readonly locale = inject(LocaleService);

  private readonly env = inject(ARENA_SCENE_ENV);
  private readonly character = inject(CharacterStore);
  private readonly inventory = inject(InventoryStore);
  private readonly battles = inject(BattleStore);
  private readonly party = inject(PartyStore);
  private readonly catalog = inject(CatalogService);
  private readonly clock = inject(ServerClockService);
  private readonly owner = inject(ArenaFeedbackOwner);
  private readonly zone = inject(NgZone);
  private runtime: ArenaRuntimeHandle | null = null;
  private manifest: Record<string, MonsterManifestEntry> = {};
  private readonly source = new ArenaSceneSource({
    monsterStyle: (id) => monsterAttackStyle(this.manifest[monsterManifestKey(id)]),
    handTypes: (equipment) => portraitHandTypes(rows(equipment), (id) => this.catalog.item(id) as { weaponType?: string } | undefined),
  });
  private latest: ArenaFrameInput | null = null;
  private hudTimer: ReturnType<typeof setInterval> | null = null;
  private gatherAtMs: number | null = null;
  private lastCycle: number | null = null;
  private shared: { id: string; atMs: number } | null = null;
  private destroyed = false;

  constructor() {
    // A completed gather (the cycle index grows): the viewing character kneels.
    effect(() => {
      const cycle = Number(this.character.character()?.gatheringCycle?.cycleIndex);
      if (!Number.isFinite(cycle)) return;
      if (this.lastCycle !== null && cycle > this.lastCycle) this.gatherAtMs = this.clock.now();
      this.lastCycle = cycle;
    });
    // Party battles are only known once created: remember when this client first saw each one.
    effect(() => {
      const battle = this.party.battle();
      if (battle && battle.id !== this.shared?.id) this.shared = { id: battle.id, atMs: Math.max(this.clock.now(), Date.parse(battle.startAt)) };
    });
    effect(() => {
      const active = this.active();
      untracked(() => { this.runtime?.setActive(active); this.owner.arenaVisible.set(active && !!this.runtime); });
    });
    void loadMonsterManifest().then((m) => { this.manifest = m; });
  }

  async ngAfterViewInit(): Promise<void> {
    if (!this.env.webglAvailable()) { this.failed.set(true); return; }
    try {
      const runtime = await this.zone.runOutsideAngular(() => this.env.createRuntime(this.stage.nativeElement, {
        assetBase: '/assets/character/', onContextLost: () => this.failed.set(true), now: () => this.clock.now(),
      }));
      if (this.destroyed) { runtime.dispose(); return; }
      this.runtime = runtime;
      runtime.setSource((now) => (this.latest = this.source.build(this.inputs(now))));
      runtime.setActive(this.active());
      this.owner.arenaVisible.set(this.active());
      this.zone.runOutsideAngular(() => { this.hudTimer = setInterval(() => this.refreshHud(), HUD_MS); });
    } catch {
      this.failed.set(true);
    }
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
      nowMs, mapId: this.mapId() ?? c?.currentMapId ?? null, selfId: c?.id ?? 'self',
      selfLook: this.selfLook(), selfAttackStyle: this.selfAttackStyle(),
      soloQueue: party ? [] : this.battles.queue(),
      shared: party ? this.party.battle() : null,
      sharedReceivedAtMs: this.shared && this.shared.id === this.party.battle()?.id ? this.shared.atMs : null,
      nextEncounterAt: party ? this.party.nextEncounterAt() : null,
      partyIds: party ? this.party.members().map((m) => m.characterId) : [],
      gatherAtMs: this.gatherAtMs,
    };
  }

  /** HUD positions and contents from the latest drawn frame (30 Hz). */
  refreshHud(): void {
    const frame = this.latest;
    if (!frame || !this.runtime || !this.active()) return;
    const anchors = this.runtime.screenAnchors();
    const now = this.clock.now();
    const scene = frame.scene;
    const hud: ArenaHudItem[] = [];
    if (scene.hud) {
      for (const a of scene.frame.actors) {
        const anchor = anchors.get(a.id);
        const visual = frame.visuals.get(a.id);
        if (!anchor?.visible || !visual || a.deadAtMs !== null || (a.exit ?? 0) > 0) continue;
        const max = { hp: visual.maxHp ?? 0, sp: visual.maxSp ?? 0 };
        hud.push({
          id: a.id, x: anchor.x, y: anchor.y, name: visual.name, team: visual.team,
          hp: max.hp > 0 ? Math.max(0, Math.min(1, a.hp / max.hp)) : 0, sp: max.sp > 0 ? Math.max(0, Math.min(1, a.sp / max.sp)) : 0, hasSp: max.sp > 0,
          cast: a.cast ? Math.max(0, Math.min(1, (now - a.cast.startedAtMs) / Math.max(1, a.cast.endsAtMs - a.cast.startedAtMs))) : null,
        });
      }
    }
    const numbers: ArenaNumber[] = [];
    for (const [i, f] of scene.frame.feedback.entries()) {
      const anchor = anchors.get(f.targetId);
      if (!anchor?.visible) continue;
      const existing = this.numbers().find((n) => n.key === f.key);
      // A number stays where it appeared (its CSS animation carries it).
      numbers.push(existing ?? { key: f.key, x: anchor.x, y: anchor.y + 24, text: f.text === 'Miss' ? this.locale.t('Miss') : f.text, style: f.style, offset: ((i % 5) - 2) * 12 });
    }
    this.hud.set(hud);
    this.numbers.set(numbers);
    this.fade.set(scene.fade);
  }

  trackId(_: number, item: { id?: string; key?: string }): string { return item.id ?? item.key ?? ''; }

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
