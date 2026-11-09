import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { LocaleService } from '../../core/locale.service';

@Component({
  selector: 'app-mail-arrival-notice',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mail-arrival-notice.component.html',
  styleUrl: './mail-arrival-notice.component.css',
})
export class MailArrivalNoticeComponent {
  readonly localeService = inject(LocaleService);
  @Input() mail: any = null;
  @Input() hideFuture = false;
  @Output() close = new EventEmitter<void>();
  @Output() hideFutureChange = new EventEmitter<boolean>();
}
