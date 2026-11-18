import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/** Local-only System lines for the idle chat (red, never sent to the server). */
@Injectable({ providedIn: 'root' })
export class ChatNoticeService {
  private readonly subject = new Subject<{ message: string }>();
  readonly notices$: Observable<{ message: string }> = this.subject.asObservable();

  error(message: string): void {
    if (message) this.subject.next({ message });
  }
}
