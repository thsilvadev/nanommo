import { Directive, ElementRef, OnDestroy } from '@angular/core';

@Directive({
  selector: '.item-tooltip',
  standalone: true,
})
export class TooltipPositionDirective implements OnDestroy {
  private readonly tooltip: HTMLElement;
  private readonly anchor: HTMLElement;
  private floating: HTMLElement | null = null;
  private raf = 0;
  private pointer = { x: 0, y: 0 };

  private readonly onEnter = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY };
    this.show();
  };
  private readonly onMove = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY };
    this.position();
  };
  private readonly onLeave = () => this.hide();

  constructor(element: ElementRef<HTMLElement>) {
    this.tooltip = element.nativeElement;
    this.anchor = this.tooltip.parentElement as HTMLElement;
    if (!this.anchor) return;
    this.anchor.addEventListener('pointerenter', this.onEnter);
    this.anchor.addEventListener('pointermove', this.onMove);
    this.anchor.addEventListener('pointerleave', this.onLeave);
  }

  private show() {
    if (!this.floating) {
      this.floating = this.tooltip.cloneNode(true) as HTMLElement;
      this.floating.classList.remove('item-tooltip');
      this.floating.classList.add('nm-floating-tooltip');
      this.floating.removeAttribute('style');
      document.body.appendChild(this.floating);
    }
    this.floating.innerHTML = this.tooltip.innerHTML;
    this.floating.style.display = 'grid';
    this.floating.style.visibility = 'hidden';
    this.position();
  }

  private position() {
    if (!this.floating) return;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.floating) return;
      const el = this.floating, margin = 10, gap = 14;
      el.style.left = '0px'; el.style.top = '0px';
      const rect = el.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const x = this.pointer.x, y = this.pointer.y;
      const right = x + gap, left = x - rect.width - gap;
      const top = y - rect.height - gap, bottom = y + gap;
      const nextLeft = right + rect.width <= vw - margin ? right : left >= margin ? left : Math.max(margin, vw - rect.width - margin);
      const nextTop = top >= margin ? top : bottom + rect.height <= vh - margin ? bottom : Math.max(margin, vh - rect.height - margin);
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
    this.anchor?.removeEventListener('pointerenter', this.onEnter);
    this.anchor?.removeEventListener('pointermove', this.onMove);
    this.anchor?.removeEventListener('pointerleave', this.onLeave);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.floating?.remove();
  }
}
