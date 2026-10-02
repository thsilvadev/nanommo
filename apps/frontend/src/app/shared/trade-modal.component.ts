import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { VendorStore } from '../core/vendor.store';

@Component({
  selector: 'app-trade-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './trade-modal.component.html',
  styleUrl: './trade-modal.component.css',
})
export class TradeModalComponent {
  readonly vendor = inject(VendorStore);
}
