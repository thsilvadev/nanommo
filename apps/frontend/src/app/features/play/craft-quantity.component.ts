import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-craft-quantity', standalone: true,
  template: `
    <span class="quantity-label">{{label}}</span>
    <button type="button" class="quantity-max" [disabled]="disabled"
      [title]="'Max: ' + maximum" [attr.aria-label]="'Set maximum quantity: ' + maximum"
      (click)="set(maximum)">Max</button>
    <div class="quantity-stepper">
      <input type="number" min="1" [max]="maximum" [value]="value" [disabled]="disabled"
        [attr.aria-label]="label" (input)="onInput($event)">
      <div class="quantity-arrows">
        <button type="button" class="quantity-up" aria-label="Increase quantity"
          [disabled]="disabled || value >= maximum" (click)="set(value + 1)"><i></i></button>
        <button type="button" class="quantity-down" aria-label="Decrease quantity"
          [disabled]="disabled || value <= 1" (click)="set(value - 1)"><i></i></button>
      </div>
    </div>`,
  styleUrl: './craft-quantity.component.css',
})
export class CraftQuantityComponent {
  @Input() max = 1;
  @Input() value = 1;
  @Input() label = 'Quantity';
  @Input() disabled = false;
  @Output() readonly valueChange = new EventEmitter<number>();
  get maximum(): number { return Math.max(1, Math.floor(Number(this.max) || 1)); }
  set(value: number): number {
    const quantity = Math.max(1, Math.min(this.maximum, Math.floor(Number(value) || 1)));
    if (!this.disabled) this.valueChange.emit(quantity);
    return quantity;
  }
  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = String(this.set(Number(input.value)));
  }
}
