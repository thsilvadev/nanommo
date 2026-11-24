import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild, AfterViewInit, inject } from '@angular/core';
import { LocaleService } from '../../core/locale.service';
import type { ConnectionTip } from '../../core/connection-tips.service';

@Component({
  selector: 'app-connection-tip', standalone: true, imports: [CommonModule],
  templateUrl: './connection-tip.component.html', styleUrl: './connection-tip.component.css',
})
export class ConnectionTipComponent implements AfterViewInit {
  readonly locale = inject(LocaleService);
  @Input({ required: true }) tip!: ConnectionTip;
  @Output() close = new EventEmitter<void>();
  @ViewChild('closeButton') closeButton?: ElementRef<HTMLButtonElement>;
  private previousFocus: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => this.closeButton?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape') onEscape(): void { this.dismiss(); }
  dismiss(): void { this.close.emit(); queueMicrotask(() => this.previousFocus?.focus()); }
}
