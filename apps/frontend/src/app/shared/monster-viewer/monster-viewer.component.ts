import { ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, effect, inject, input, output } from '@angular/core';
import type * as THREE from 'three';
import type { MonsterAnimationState } from './monster-animation-state';
import { MonsterModel, loadMonsterThree, type Three } from './monster-model';
import type { MonsterWeapon } from './monster-weapon';

// The loading and clip rules live in MonsterModel (shared with the battle arena); re-exported for existing callers.
export { loadMonsterManifest, monsterAttackStyle, monsterManifestKey, type MonsterManifestEntry } from './monster-model';

/**
 * A monster's 3D model in a small transparent canvas, posed every frame from
 * `animation(now)` (the battle log, see monster-animation-state.ts). Emits `loaded`
 * once it shows the model and `failed` when there is none (the caller keeps its sprite).
 */
@Component({
  selector: 'app-monster-viewer', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '', styles: [':host{display:block;position:relative;overflow:hidden}:host ::ng-deep canvas{display:block;width:100%!important;height:100%!important}'],
})
export class MonsterViewerComponent implements OnDestroy {
  readonly monsterId = input.required<string>();
  readonly animation = input.required<(nowMs: number) => MonsterAnimationState>();
  readonly loaded = output<void>();
  readonly failed = output<void>();

  private readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private readonly zone = inject(NgZone);
  private renderer: THREE.WebGLRenderer | null = null;
  private frame = 0;
  private generation = 0;
  private resize: ResizeObserver | null = null;
  private model: MonsterModel | null = null;
  /** The shown model (tests read its pose). */
  private root: THREE.Object3D | null = null;
  /** The hand item of the shown model, if any (tests read it). */
  private weapon: MonsterWeapon | null = null;

  constructor() {
    effect(() => { const id = this.monsterId(); void this.show(id); });
  }

  ngOnDestroy(): void { this.generation++; cancelAnimationFrame(this.frame); this.resize?.disconnect(); this.model?.dispose(); this.renderer?.dispose(); this.renderer?.domElement.remove(); }

  private async show(id: string): Promise<void> {
    const gen = ++this.generation;
    cancelAnimationFrame(this.frame);
    try {
      const [{ three }, model] = await Promise.all([loadMonsterThree(), MonsterModel.load(id)]);
      if (gen !== this.generation) { model.dispose(); return; }
      this.zone.runOutsideAngular(() => this.start(three, model, gen));
      this.loaded.emit();
    } catch {
      if (gen === this.generation) this.failed.emit();
    }
  }

  private start(three: Three, model: MonsterModel, gen: number): void {
    if (!this.renderer) {
      this.renderer = new three.WebGLRenderer({ alpha: true, antialias: true });
      this.renderer.outputColorSpace = three.SRGBColorSpace;
      this.host.appendChild(this.renderer.domElement);
    }
    const renderer = this.renderer;
    const scene = new three.Scene();
    scene.add(new three.HemisphereLight('#ffffff', '#4a3a2a', 2.2));
    const sun = new three.DirectionalLight('#ffffff', 2); sun.position.set(-3, 6, 5); scene.add(sun);
    this.model?.dispose();
    this.model = model;
    this.root = model.object3d;
    this.weapon = model.weapon;
    scene.add(model.object3d);

    // frame the Idle pose: whole body, a little room above, turned toward the player (left)
    const size = model.frameBox.getSize(new three.Vector3()), center = model.frameBox.getCenter(new three.Vector3());
    const camera = new three.PerspectiveCamera(30, 1, 0.05, 200);
    const span = Math.max(size.y, size.x * 0.8, size.z * 0.8) * 1.35;
    const dist = span / (2 * Math.tan((15 * Math.PI) / 180));
    const yaw = (-35 * Math.PI) / 180;
    camera.position.set(center.x + Math.sin(yaw) * dist, center.y + span * 0.12, center.z + Math.cos(yaw) * dist);
    camera.lookAt(center.x, center.y, center.z);

    const fit = () => {
      const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    this.resize?.disconnect(); this.resize = new ResizeObserver(fit); this.resize.observe(this.host); fit();

    const tick = () => {
      if (gen !== this.generation) return;
      const now = Date.now();
      model.drive(this.animation()(now), now);
      renderer.render(scene, camera);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
