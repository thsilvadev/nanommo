import { Directive, ElementRef, OnDestroy } from '@angular/core';

@Directive({
  selector: '.item-tooltip:not(.diet-tooltip):not(.status-tooltip), .diet-slot, .status-icon, .status-effect-icon',
  standalone: true,
})
export class TooltipPositionDirective implements OnDestroy {
  private readonly anchor: HTMLElement;
  private readonly host: HTMLElement;
  private floating: HTMLElement | null = null;
  private raf = 0;
  private pointer = { x: 0, y: 0 };
  private liveContentTimer: ReturnType<typeof setInterval> | null = null;
  private enabled = true;

  private readonly onEnter = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.pointer = { x: e.clientX, y: e.clientY };
    this.show();
  };
  private readonly onMove = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.pointer = { x: e.clientX, y: e.clientY };
    this.position();
  };
  private readonly onLeave = () => this.hide();
  private readonly onFocusIn = (e: FocusEvent) => {
    if (!this.enabled) return;
    const target = e.target instanceof HTMLElement ? e.target : this.anchor;
    const rect = target.getBoundingClientRect();
    this.pointer = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    this.show();
  };
  private readonly onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget;
    if (next instanceof Node && this.anchor.contains(next)) return;
    this.hide();
  };
  private readonly onDragStart = () => {
    this.enabled = false;
    this.hide();
  };
  private readonly onDragEnd = () => {
    // Do not reopen the tooltip automatically: the next pointerenter may show it.
    this.enabled = true;
  };

  constructor(element: ElementRef<HTMLElement>) {
    this.host = element.nativeElement;
    this.anchor = this.host.classList.contains('diet-slot') || this.host.classList.contains('status-icon') || this.host.classList.contains('status-effect-icon')
      ? this.host
      : this.host.parentElement as HTMLElement;
    if (!this.anchor) return;
    this.anchor.addEventListener('pointerenter', this.onEnter);
    this.anchor.addEventListener('pointermove', this.onMove);
    this.anchor.addEventListener('pointerleave', this.onLeave);
    this.anchor.addEventListener('focusin', this.onFocusIn);
    this.anchor.addEventListener('focusout', this.onFocusOut);
    document.addEventListener('nm:drag-start', this.onDragStart);
    document.addEventListener('nm:drag-end', this.onDragEnd);
  }

  private show() {
    if (!this.enabled) return;
    let tooltip: HTMLElement | null = null;
    if (this.host.classList.contains('diet-slot')) {
      tooltip = this.host.querySelector('.diet-tooltip') as HTMLElement;
    } else if (this.host.classList.contains('status-icon') || this.host.classList.contains('status-effect-icon')) {
      tooltip = this.host.querySelector('.status-tooltip') as HTMLElement;
    } else {
      tooltip = this.host;
    }
    if (!tooltip) return;
    if (!this.floating) {
      const isStatusTooltip = tooltip.classList.contains('status-tooltip');
      this.floating = tooltip.cloneNode(true) as HTMLElement;
      this.floating.classList.remove('item-tooltip', 'status-tooltip');
      this.floating.classList.add('nm-floating-tooltip');
      if (isStatusTooltip) this.floating.classList.add('nm-status-tooltip');
      this.floating.removeAttribute('style');
      document.body.appendChild(this.floating);
    }
    this.floating.innerHTML = tooltip.innerHTML;
    this.floating.style.display = 'grid';
    this.floating.style.visibility = 'hidden';
    if (!this.liveContentTimer) {
      this.liveContentTimer = setInterval(() => {
        if (!this.floating || this.floating.style.display === 'none') return;
        this.floating.innerHTML = tooltip?.innerHTML || '';
        this.position();
      }, 250);
    }
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
    if (this.liveContentTimer) {
      clearInterval(this.liveContentTimer);
      this.liveContentTimer = null;
    }
    if (this.floating) {
      this.floating.style.display = 'none';
      this.floating.style.visibility = 'hidden';
    }
  }

  ngOnDestroy() {
    this.anchor?.removeEventListener('pointerenter', this.onEnter);
    this.anchor?.removeEventListener('pointermove', this.onMove);
    this.anchor?.removeEventListener('pointerleave', this.onLeave);
    this.anchor?.removeEventListener('focusin', this.onFocusIn);
    this.anchor?.removeEventListener('focusout', this.onFocusOut);
    document.removeEventListener('nm:drag-start', this.onDragStart);
    document.removeEventListener('nm:drag-end', this.onDragEnd);
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.liveContentTimer) clearInterval(this.liveContentTimer);
    this.floating?.remove();
  }
}
