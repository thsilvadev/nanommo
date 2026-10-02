import { AfterViewChecked, Component, ElementRef, Input, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-battle-log',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './battle-log.component.html',
  styleUrl: './battle-log.component.css',
})
export class BattleLogComponent implements AfterViewChecked {
  @Input() events: any[] = [];
  @ViewChild('log', { static: true }) private readonly log!: ElementRef<HTMLElement>;
  readonly newLines = signal(0);
  private previousCount = 0;
  private atBottom = true;

  ngAfterViewChecked() {
    const count = this.events.length;
    if (count === this.previousCount) return;
    const added = Math.max(0, count - this.previousCount);
    this.previousCount = count;
    if (this.atBottom) this.scrollToBottom(false);
    else this.newLines.update(value => value + added);
  }

  onScroll() {
    const el = this.log.nativeElement;
    this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
    if (this.atBottom) this.newLines.set(0);
  }

  follow() {
    this.atBottom = true;
    this.newLines.set(0);
    this.scrollToBottom(true);
  }

  private scrollToBottom(smooth: boolean) {
    const el = this.log.nativeElement;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }
}
