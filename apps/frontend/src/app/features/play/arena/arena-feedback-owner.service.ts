import { Injectable, signal } from '@angular/core';

/**
 * Who shows floating damage numbers and hit flashes: the battle arena while it
 * is visible, the side panels (Character Summary, grind panel) otherwise —
 * never both. The arena scene sets this when it is shown and ready.
 */
@Injectable({ providedIn: 'root' })
export class ArenaFeedbackOwner {
  readonly arenaVisible = signal(false);
}
