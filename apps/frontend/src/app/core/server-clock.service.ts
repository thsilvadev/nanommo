import { Injectable, inject } from '@angular/core';
import { GameSocketService } from './game.socket.service';

/**
 * Estimate of the server clock, used to animate deterministic town movement
 * the same way on every client. `ping` is a plain keep-alive and carries no
 * time, so this uses the dedicated `time:sync` ack.
 */
@Injectable({ providedIn: 'root' })
export class ServerClockService {
  private readonly socket = inject(GameSocketService);
  /** serverTime - localTime, in ms. */
  private offset = 0;
  private synced = false;

  now(): number {
    return Date.now() + this.offset;
  }

  /** Rough first estimate (e.g. a roster's `serverNow`); ignored once a real sync completed. */
  seed(serverNow: number): void {
    if (this.synced || !Number.isFinite(serverNow)) return;
    this.offset = serverNow - Date.now();
  }

  /** Median of `samples` round trips of (serverNow + RTT/2 - local). Keeps the previous offset on failure. */
  async sync(samples = 5): Promise<void> {
    const estimates: number[] = [];
    for (let i = 0; i < samples; i++) {
      const sentAt = Date.now();
      try {
        const reply = await this.socket.emit<{ serverNow: number }>('time:sync');
        const receivedAt = Date.now();
        if (!Number.isFinite(reply?.serverNow)) continue;
        estimates.push(reply.serverNow + (receivedAt - sentAt) / 2 - receivedAt);
      } catch {
        break;
      }
    }
    if (!estimates.length) return;
    estimates.sort((a, b) => a - b);
    const mid = estimates.length >> 1;
    this.offset = estimates.length % 2 ? estimates[mid] : (estimates[mid - 1] + estimates[mid]) / 2;
    this.synced = true;
  }
}
