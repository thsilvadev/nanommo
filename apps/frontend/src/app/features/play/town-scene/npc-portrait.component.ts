import { ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, effect, inject, input, output, signal } from '@angular/core';
import { isWebglAvailable } from '../../../shared/character-viewer/appearance-catalog';

@Component({
  selector: 'app-npc-portrait', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  styles: [':host{display:block;position:relative;overflow:hidden}:host ::ng-deep canvas{display:block;width:100%!important;height:100%!important}'],
})
export class NpcPortraitComponent implements OnDestroy {
  readonly npcId = input.required<string>();
  readonly loaded = output<void>();
  readonly failed = output<void>();
  readonly ready = signal(false);
  private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly zone = inject(NgZone);
  private generation = 0;
  private portrait: { dispose(): void } | null = null;

  constructor() {
    effect(() => { this.ready.set(false); void this.show(this.npcId()); }, { allowSignalWrites: true });
  }

  private async show(id: string): Promise<void> {
    const generation = ++this.generation;
    this.portrait?.dispose();
    this.portrait = null;
    try {
      if (!isWebglAvailable()) throw new Error('WebGL unavailable');
      const { createNpcPortrait } = await import('./npc-portrait-runtime');
      if (generation !== this.generation) return;
      // Each load owns a host so an outdated async load cannot replace the current NPC.
      const staging = document.createElement('div');
      staging.style.cssText = 'position:absolute;inset:0';
      this.host.appendChild(staging);
      let runtime: { dispose(): void };
      try { runtime = await this.zone.runOutsideAngular(() => createNpcPortrait(staging, id)); }
      catch (error) { staging.remove(); throw error; }
      const portrait = { dispose: () => { runtime.dispose(); staging.remove(); } };
      if (generation !== this.generation) { portrait.dispose(); return; }
      this.portrait = portrait;
      this.ready.set(true);
      this.loaded.emit();
    } catch {
      if (generation === this.generation) this.failed.emit();
    }
  }

  ngOnDestroy(): void { this.generation++; this.portrait?.dispose(); }
}
