import {
  ChangeDetectionStrategy, Component, ElementRef, InjectionToken, NgZone, OnDestroy, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { resolveHandAttachments, type AppearanceCatalog, type CharacterAppearance, type HandWeaponType, type Sex, type VisibleEquipment, type VisibleRefinement } from '@nanommo/shared';
import type { AnimationSource, CharacterRigHandle, ViewerConfig, ViewerFraming } from './character-viewer.types';
import { DEFAULT_CATALOG_URL, isWebglAvailable, loadAppearanceCatalog } from './appearance-catalog';
// Angular-free module (the battle arena's lazy chunk loads it without Angular); re-exported for existing callers.
export { isWebglAvailable, loadAppearanceCatalog } from './appearance-catalog';

export interface CharacterViewerEnv {
  /** Base URL of the character assets, with a trailing slash. */
  assetBase: string;
  catalogUrl?: string;
  webglAvailable: () => boolean;
  /** Optional wrapper around the glTF loader (tests use it to simulate failures). */
  loadGltf?: (url: string, defaultLoad: (url: string) => Promise<unknown>) => Promise<unknown>;
}

export const CHARACTER_VIEWER_ENV = new InjectionToken<CharacterViewerEnv>('CHARACTER_VIEWER_ENV', {
  providedIn: 'root',
  factory: () => ({ assetBase: '/assets/character/', webglAvailable: isWebglAvailable }),
});

type ViewerState = 'loading' | 'ready' | 'failed';

/**
 * Inputs compared by value: stores hand the viewer fresh objects on every realtime snapshot
 * (every battle in the grind), and each apply rebuilds skin, deformation and gear.
 */
function sameConfig(a: ViewerConfig, b: ViewerConfig): boolean {
  return a === b || stableJson(a) === stableJson(b);
}
/** JSON with object keys sorted, so key order (e.g. equipment rows' order) does not count. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
    : v));
}
const IDLE: AnimationSource = { base: 'Idle' };
interface Rig extends CharacterRigHandle { apply(config: ViewerConfig): Promise<void>; dispose(): void }

/**
 * 3D character preview: body, appearance and hand items, playing `animation`
 * (Idle when none is given, as in the creator).
 *
 * three.js is loaded on demand the first time a viewer is shown. On any failure
 * (no WebGL, an asset that does not load, a lost GPU context) the canvas is
 * removed and `failed` is emitted, so the host can show its own fallback;
 * `retry()` starts again.
 */
@Component({
  selector: 'app-character-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-busy]': "state() === 'loading'" },
  template: `@if (state() === 'loading') { <span class="viewer-spinner" aria-hidden="true"></span> }`,
  styles: [`
    :host { display: block; position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden; }
    :host ::ng-deep canvas { display: block; width: 100%; height: 100%; touch-action: pan-y; }
    .viewer-spinner { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
      border: 2px solid rgba(214, 190, 150, 0.25); border-top-color: rgba(214, 190, 150, 0.85); animation: viewer-spin 0.9s linear infinite; }
    @keyframes viewer-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .viewer-spinner { animation: none; } }
  `],
})
export class CharacterViewerComponent implements OnDestroy {
  readonly sex = input.required<Sex>();
  readonly heightCm = input.required<number>();
  readonly appearance = input.required<CharacterAppearance>();
  readonly dominantHand = input<'right' | 'left'>('right');
  readonly mainHandType = input<HandWeaponType | null>(null);
  readonly offHandType = input<HandWeaponType | null>(null);
  /** Equipped items worn as 3D gear; the creator leaves it null (bare body). */
  readonly equipment = input<VisibleEquipment | null>(null);
  /** Refinement per visible slot (+10/+11 silver shimmer, +12 gold). */
  readonly refinement = input<VisibleRefinement | null>(null);
  /** Drag to rotate (creator). */
  readonly interactive = input(false);
  readonly framing = input<ViewerFraming>('full');
  /**
   * What the character plays: a fixed AnimationState, or a function of the time that
   * the rig evaluates on every frame (the portrait passes one built from the stores).
   */
  readonly animation = input<AnimationSource | null>(null);

  readonly failed = output<void>();
  readonly loaded = output<void>();

  readonly state = signal<ViewerState>('loading');
  readonly rig = signal<CharacterRigHandle | null>(null);

  private readonly env = inject(CHARACTER_VIEWER_ENV);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);

  private readonly config = computed<ViewerConfig>(() => ({
    sex: this.sex(),
    heightCm: this.heightCm(),
    appearance: this.appearance(),
    hands: resolveHandAttachments(this.dominantHand(), this.mainHandType(), this.offHandType()),
    dominantHand: this.dominantHand(),
    interactive: this.interactive(),
    framing: this.framing(),
    equipment: this.equipment(),
    refinement: this.refinement(),
  }), { equal: sameConfig });

  private instance: Rig | null = null;
  private pending: ViewerConfig | null = null;
  private running = false;
  /** Bumped on failure/destroy so work started earlier stops touching state. */
  private generation = 0;
  private destroyed = false;

  constructor() {
    effect(() => {
      const config = this.config();
      untracked(() => this.request(config));
    });
    effect(() => {
      const animation = this.animation();
      untracked(() => this.instance?.setAnimation(animation ?? IDLE));
    });
  }

  retry(): void {
    if (this.destroyed || this.state() !== 'failed') return;
    this.state.set('loading');
    this.request(this.config());
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.generation++;
    this.pending = null;
    this.instance?.dispose();
    this.instance = null;
    this.rig.set(null);
  }

  private request(config: ViewerConfig): void {
    this.pending = config;
    if (this.state() === 'failed' || this.destroyed) return;
    void this.pump();
  }

  /** Applies configurations one at a time; only the latest pending one matters. */
  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;
    const current = () => generation === this.generation && !this.destroyed;
    try {
      if (this.state() !== 'loading') this.state.set('loading');
      while (this.pending) {
        const rig = this.instance ?? await this.createRig();
        if (!current()) return;
        const config = this.pending;
        this.pending = null;
        await rig.apply(config);
        if (!current()) return;
      }
      this.state.set('ready');
      this.loaded.emit();
    } catch {
      if (current()) this.fail();
    } finally {
      if (generation === this.generation) this.running = false;
    }
  }

  private async createRig(): Promise<Rig> {
    if (!this.env.webglAvailable()) throw new Error('WebGL is not available');
    const [{ CharacterRig }, { GLTFLoader }, { CharacterAssetCache }] = await Promise.all([
      import('./character-rig'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('./character-asset-cache'),
    ]);
    const loader = new GLTFLoader();
    const defaultLoad = (url: string) => loader.loadAsync(url);
    const load = this.env.loadGltf ? (url: string) => this.env.loadGltf!(url, defaultLoad) : defaultLoad;
    // Every viewer (and the town scene) shares the files; a custom loader gets its own cache.
    const cache = this.env.loadGltf ? new CharacterAssetCache(load, this.env.assetBase) : CharacterAssetCache.shared(this.env.assetBase, defaultLoad);
    const catalogUrl = this.env.catalogUrl ?? DEFAULT_CATALOG_URL;
    // The render loop runs outside Angular so animation frames do not trigger change detection.
    const rig = await this.zone.runOutsideAngular(() => CharacterRig.create(this.host, {
      assetBase: this.env.assetBase,
      catalog: () => loadAppearanceCatalog(catalogUrl),
      load,
      cache,
      onContextLost: () => this.zone.run(() => this.fail()),
    }));
    // Before the first apply, so the body's first frame already shows the right pose.
    rig.setAnimation(untracked(() => this.animation()) ?? IDLE);
    this.instance = rig;
    this.rig.set(rig);
    return rig;
  }

  private fail(): void {
    if (this.destroyed || this.state() === 'failed') return;
    this.generation++;
    this.running = false;
    this.instance?.dispose();
    this.instance = null;
    this.rig.set(null);
    this.state.set('failed');
    this.failed.emit();
  }
}
