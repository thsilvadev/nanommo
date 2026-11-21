import {
  ChangeDetectionStrategy, Component, ElementRef, EventEmitter, NgZone, OnDestroy, OnInit, Output, ViewChild, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import type { TownRosterEntry } from '@nanommo/shared';
import { CatalogService } from '../../../core/catalog.service';
import { CharacterStore } from '../../../core/game.store';
import { LocaleService } from '../../../core/locale.service';
import { PartyStore } from '../../../core/party.store';
import { ServerClockService } from '../../../core/server-clock.service';
import { TownStore } from '../../../core/town.store';
import { rankForRender } from './town-render-order';
import { TOWN_SCENE_ENV, type TownPick, type TownSceneRuntimeHandle } from './town-scene.types';

/** A pointer that moved more than this between down and up is a drag, never a click. */
export const TOWN_CLICK_TOLERANCE_PX = 5;

@Component({
  selector: 'app-town-scene',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './town-scene.component.html',
  styleUrl: './town-scene.component.css',
})
export class TownSceneComponent implements OnInit, OnDestroy {
  readonly mapId = input.required<string>();
  /** False while the map view is shown: the scene stays mounted (instant switch) but stops rendering. */
  readonly active = input(true);
  /** Player or NPC wearing the blue selection ring. */
  readonly selection = input<TownPick | null>(null);
  @Output() readonly npcSelected = new EventEmitter<string>();
  @Output() readonly characterSelected = new EventEmitter<{ entry: TownRosterEntry; screen: [number, number] }>();
  @ViewChild('host', { static: true }) private hostRef!: ElementRef<HTMLDivElement>;

  private readonly env = inject(TOWN_SCENE_ENV);
  private readonly town = inject(TownStore);
  private readonly characters = inject(CharacterStore);
  private readonly party = inject(PartyStore);
  private readonly clock = inject(ServerClockService);
  private readonly catalog = inject(CatalogService);
  private readonly zone = inject(NgZone);
  private readonly listeners: Array<() => void> = [];
  readonly locale = inject(LocaleService);

  readonly state = signal<'loading' | 'ready' | 'failed'>('loading');
  /** The pointer is over another player or an NPC: show a pointer cursor. */
  readonly hovering = signal(false);
  private readonly runtime = signal<TownSceneRuntimeHandle | null>(null);
  private readonly selfId = computed(() => this.characters.character()?.id ?? null);
  private readonly rendered = computed(() => {
    const partyIds = new Set((this.party.members() ?? []).map((m: { characterId: string }) => m.characterId));
    return rankForRender(this.town.entries(), this.selfId(), partyIds);
  });
  private generation = 0;
  private destroyed = false;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private press: { x: number; y: number; moved: number } | null = null;
  private pinchDistance: number | null = null;

  constructor() {
    effect(() => {
      const mapId = this.mapId();
      untracked(() => void this.mount(mapId));
    });
    effect(() => {
      const runtime = this.runtime();
      const rendered = this.rendered();
      const selfId = this.selfId();
      // Character models load asynchronously: keep their promise chains out of the Angular zone.
      if (runtime) this.zone.runOutsideAngular(() => runtime.setCharacters(rendered, selfId));
    });
    effect(() => {
      const runtime = this.runtime();
      const active = this.active();
      // Restarts the render loop: it must start outside the zone too.
      if (runtime) this.zone.runOutsideAngular(() => runtime.setActive(active));
    });
    effect(() => {
      const runtime = this.runtime();
      const selection = this.selection();
      runtime?.setSelection(selection);
    });
  }

  /**
   * pointermove and wheel fire dozens of times a second while the pointer is
   * over the scene. Inside the Angular zone each event re-checked the whole app;
   * outside it, only `hovering` (a signal, changed when the hover target
   * changes) reaches Angular.
   */
  ngOnInit(): void {
    const host = this.hostRef.nativeElement;
    this.zone.runOutsideAngular(() => {
      const move = (event: PointerEvent) => this.onPointerMove(event);
      const wheel = (event: WheelEvent) => this.onWheel(event);
      host.addEventListener('pointermove', move);
      host.addEventListener('wheel', wheel, { passive: false });
      this.listeners.push(() => host.removeEventListener('pointermove', move), () => host.removeEventListener('wheel', wheel));
    });
  }

  ngOnDestroy(): void {
    for (const remove of this.listeners.splice(0)) remove();
    this.destroyed = true;
    this.generation++;
    this.runtime()?.dispose();
    this.runtime.set(null);
  }

  // ---- input ----------------------------------------------------------------

  onPointerDown(event: PointerEvent): void {
    this.pointers.set(event.pointerId, this.local(event));
    if (this.pointers.size === 1) this.press = { ...this.local(event), moved: 0 };
    else { this.press = null; this.pinchDistance = this.currentPinch(); }
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) {
      if (this.pointers.size === 0 && event.pointerType !== 'touch') this.hover(this.local(event));
      return;
    }
    const point = this.local(event);
    this.pointers.set(event.pointerId, point);
    const runtime = this.runtime();
    if (this.pointers.size >= 2) {
      const distance = this.currentPinch();
      if (runtime && this.pinchDistance && distance) runtime.zoom(this.pinchDistance / distance, this.pinchCentre());
      this.pinchDistance = distance;
      return;
    }
    const dx = point.x - previous.x, dy = point.y - previous.y;
    if (this.press) this.press.moved += Math.hypot(dx, dy);
    if (this.press && this.press.moved > TOWN_CLICK_TOLERANCE_PX) runtime?.pan(dx, dy);
  }

  onPointerUp(event: PointerEvent): void {
    const point = this.local(event);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = null;
    const press = this.press;
    this.press = null;
    if (!press || event.type === 'pointercancel') return;
    // Path length (wiggles count) or straight distance, whichever is larger.
    const travelled = Math.max(press.moved, Math.hypot(point.x - press.x, point.y - press.y));
    if (travelled > TOWN_CLICK_TOLERANCE_PX) return;
    this.click(point.x, point.y);
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const point = this.local(event);
    this.runtime()?.zoom(Math.exp(event.deltaY * 0.0015), [point.x, point.y]);
  }

  onPointerLeave(): void { this.hovering.set(false); }

  private hover(point: { x: number; y: number }): void {
    const hit = this.runtime()?.pick(point.x, point.y) ?? null;
    this.hovering.set(!!hit && (hit.kind === 'npc' || hit.id !== this.selfId()));
  }

  private click(x: number, y: number): void {
    const runtime = this.runtime();
    const hit = runtime?.pick(x, y);
    if (!hit) {
      // Empty ground: walk there (the server snaps the point to somewhere reachable).
      const ground = runtime?.groundPoint(x, y);
      if (!ground) return;
      runtime!.markDestination(ground[0], ground[1]);
      void this.town.moveTo({ x: ground[0], z: ground[1] }).catch(() => undefined);
      return;
    }
    if (hit.kind === 'npc') {
      this.npcSelected.emit(hit.id);
      void this.town.moveTo({ npcId: hit.id }).catch(() => undefined);
      return;
    }
    const entry = this.town.entries().find((e) => e.characterId === hit.id);
    if (entry) this.characterSelected.emit({ entry, screen: [x, y] });
  }

  // ---- lifecycle ------------------------------------------------------------

  private async mount(mapId: string): Promise<void> {
    const generation = ++this.generation;
    this.runtime()?.dispose();
    this.runtime.set(null);
    this.state.set('loading');
    try {
      if (!this.env.webglAvailable()) throw new Error('WebGL is not available');
      const def = await this.env.loadScene(mapId);
      if (!def) throw new Error(`No town scene for ${mapId}`);
      if (generation !== this.generation || this.destroyed) return;
      const npcNames: Record<string, string> = {};
      for (const npc of this.catalog.npcCatalog?.() ?? []) {
        if (npc?.id) npcNames[npc.id] = this.locale.localized(npc, 'name', npc.name) || npc.id;
      }
      // The render loop (requestAnimationFrame), its ResizeObserver and model loads run outside
      // the Angular zone: inside it, every frame triggered change detection of the whole app.
      const runtime = await this.zone.runOutsideAngular(() => this.env.createRuntime(this.hostRef.nativeElement, {
        def, now: () => this.clock.now(), assetBase: this.env.assetBase ?? '/assets/character/', npcNames, selfId: this.selfId(),
      }));
      if (generation !== this.generation || this.destroyed) { runtime.dispose(); return; }
      this.runtime.set(runtime);
      this.state.set('ready');
    } catch {
      if (generation === this.generation) this.state.set('failed');
    }
  }

  private local(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const box = this.hostRef.nativeElement.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  private currentPinch(): number | null {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  }

  private pinchCentre(): [number, number] | undefined {
    const [a, b] = [...this.pointers.values()];
    return a && b ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : undefined;
  }
}
