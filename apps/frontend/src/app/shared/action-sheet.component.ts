import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface ActionSheetAction {
  id: string;
  label: string;
}

@Component({
  selector: 'app-action-sheet',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './action-sheet.component.html',
  styleUrl: './action-sheet.component.css',
})
export class ActionSheetComponent {
  @Input() itemName = '';
  @Input() itemClass = '';
  @Input() details: Array<{label:string;value:string}> = [];
  @Input() actions: ActionSheetAction[] = [];
  @Output() action = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();
}
