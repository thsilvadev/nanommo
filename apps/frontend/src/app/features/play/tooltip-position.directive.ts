import { Directive, ElementRef, OnDestroy } from '@angular/core';

@Directive({
  selector: '.item-tooltip',
  standalone: true,
})
export class TooltipPositionDirective implements OnDestroy {
  private readonly tooltip: HTMLElement;
  private readonly anchor: HTMLElement;
  private floating: HTMLElement | null = null;
  private observer: MutationObserver | null = null;

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

    this.observer = new MutationObserver(() => {
      if (this.floating) this.floating.innerHTML = this.tooltip.innerHTML;
    });
    this.observer.observe(this.tooltip, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  private show(event: PointerEvent) {
    if (!this.floating) {
      this.floating = this.tooltip.cloneNode(true) as HTMLElement;
      this.floating.classList.add('nm-floating-tooltip');
      this.floating.removeAttribute('style');
      document.body.appendChild(this.floating);
    }

    this.floating.innerHTML = this.tooltip.innerHTML;
    this.floating.style.display = 'grid';
    this.floating.style.visibility = 'hidden';
    this.position(event);
  }

  private position(event: PointerEvent) {
    if (!this.floating) return;

    requestAnimationFrame(() => {
      if (!this.floating) return;

      const el = this.floating;
      const margin = 10;
      const gap = 14;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;

      el.style.left = '0px';
      el.style.top = '0px';

      const rect = el.getBoundingClientRect();
      const x = event.clientX;
      const y = event.clientY;

      const rightX = x + gap;
      const leftX = x - rect.width - gap;
      const fitsRight = rightX + rect.width <= viewportWidth - margin;
      const fitsLeft = leftX >= margin;

      const nextLeft = fitsRight
        ? rightX
        : fitsLeft
          ? leftX
          : Math.max(margin, Math.min(rightX, viewportWidth - rect.width - margin));

      const aboveY = y - rect.height - gap;
      const belowY = y + gap;
      const fitsAbove = aboveY >= margin;
      const fitsBelow = belowY + rect.height <= viewportHeight - margin;

      const nextTop = fitsAbove
        ? aboveY
        : fitsBelow
          ? belowY
          : Math.max(margin, Math.min(aboveY, viewportHeight - rect.height - margin));

      el.style.left = `${nextLeft}px`;
      el.style.top = `${nextTop}px`;
      el.style.visibility = 'visible';
    });
  }

  private hide() {
    if (this.floating) {
      this.floating.style.display = 'none';
      this.floating.style.visibility = 'hidden';
    }
  }

  ngOnDestroy() {
    this.anchor?.removeEventListener('pointerenter', this.onPointerEnter);
    this.anchor?.removeEventListener('pointermove', this.onPointerMove);
    this.anchor?.removeEventListener('pointerleave', this.onPointerLeave);
    this.observer?.disconnect();
    this.floating?.remove();
    this.floating = null;
  }
}
