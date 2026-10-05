import { Directive, ElementRef, OnDestroy, inject } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { DomPortal } from '@angular/cdk/portal';

@Directive({
  selector: '.item-tooltip',
  standalone: true,
})
export class TooltipPositionDirective implements OnDestroy {
  private readonly tooltip: HTMLElement;
  private readonly anchor: HTMLElement;
  private readonly overlay = inject(Overlay);
  private overlayRef: OverlayRef | null = null;
  private portal: DomPortal<HTMLElement> | null = null;

  private readonly onPointerEnter = (event: PointerEvent) => this.show(event);
  private readonly onPointerMove = (event: PointerEvent) => this.position(event);
  private readonly onPointerLeave = () => this.hide();

  constructor(element: ElementRef<HTMLElement>) {
    this.tooltip = element.nativeElement;
    this.anchor = this.tooltip.parentElement as HTMLElement;
    if (!this.anchor) return;
    this.anchor.addEventListener('pointerenter', this.onPointerEnter);
    this.anchor.addEventListener('pointermove', this.onPointerMove);
    this.anchor.addEventListener('pointerleave', this.onPointerLeave);
  }

  private show(event: PointerEvent) {
    if (!this.overlayRef) {
      this.overlayRef = this.overlay.create({
        hasBackdrop: false,
        disposeOnNavigation: false,
        scrollStrategy: this.overlay.scrollStrategies.noop(),
        panelClass: 'nm-tooltip-overlay',
      });
      this.portal = new DomPortal(this.tooltip);
    }
    if (!this.overlayRef.hasAttached() && this.portal) this.overlayRef.attach(this.portal);
    this.tooltip.style.display = 'grid';
    this.tooltip.style.visibility = 'hidden';
    this.position(event);
  }

  private position(event: PointerEvent) {
    if (!this.overlayRef?.hasAttached()) return;

    requestAnimationFrame(() => {
      const rect = this.tooltip.getBoundingClientRect();
      const margin = 14;
      const x = event.clientX;
      const y = event.clientY;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const right = x + margin;
      const left = x - rect.width - margin;
      const top = y - rect.height - margin;
      const bottom = y + margin;

      const nextLeft = right + rect.width <= viewportWidth
        ? right
        : left >= 0
          ? left
          : Math.max(margin, Math.min(right, viewportWidth - rect.width - margin));

      const nextTop = top >= 0
        ? top
        : bottom + rect.height <= viewportHeight
          ? bottom
          : Math.max(margin, Math.min(bottom, viewportHeight - rect.height - margin));

      this.overlayRef!.updatePositionStrategy(
        this.overlay.position().global().left(`${nextLeft}px`).top(`${nextTop}px`),
      );
      this.overlayRef!.updatePosition();
      this.tooltip.style.visibility = 'visible';
    });
  }

  private hide() {
    if (this.overlayRef?.hasAttached()) this.overlayRef.detach();
    this.tooltip.style.display = '';
    this.tooltip.style.visibility = '';
  }

  ngOnDestroy() {
    if (this.anchor) {
      this.anchor.removeEventListener('pointerenter', this.onPointerEnter);
      this.anchor.removeEventListener('pointermove', this.onPointerMove);
      this.anchor.removeEventListener('pointerleave', this.onPointerLeave);
    }
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }
}
