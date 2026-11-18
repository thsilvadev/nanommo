import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy } from '@angular/core';

/** Follow new rows only while the reader remains at the bottom. */
@Directive({ selector: '[followLog]', standalone: true })
export class FollowLogDirective implements AfterViewInit, OnDestroy {
  private following = true;
  private frame = 0;
  private observer?: MutationObserver;
  constructor(private readonly element: ElementRef<HTMLElement>) {}
  @HostListener('scroll') onScroll(): void {
    const el = this.element.nativeElement;
    this.following = el.scrollHeight - el.clientHeight - el.scrollTop <= 8;
  }
  ngAfterViewInit(): void {
    this.observer = new MutationObserver(() => this.follow());
    this.observer.observe(this.element.nativeElement, { childList: true, subtree: true, characterData: true });
    this.follow();
  }
  private follow(): void {
    if (!this.following || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.following) this.element.nativeElement.scrollTop = this.element.nativeElement.scrollHeight;
    });
  }
  ngOnDestroy(): void { this.observer?.disconnect(); cancelAnimationFrame(this.frame); }
}
