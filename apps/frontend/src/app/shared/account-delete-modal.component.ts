import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal } from '@angular/core';

@Component({
  selector: 'app-account-delete-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './account-delete-modal.component.html',
  styleUrl: './account-delete-modal.component.css',
})
export class AccountDeleteModalComponent implements OnChanges {
  @Input() open = false;
  @Input() error: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<void>();
  readonly confirmText = signal('');

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open']?.currentValue === true && changes['open']?.previousValue !== true) this.confirmText.set('');
  }

  confirm() {
    if (this.confirmText() === 'DELETE') this.confirmed.emit();
  }
  reset() {
    this.confirmText.set('');
    this.closed.emit();
  }
}
