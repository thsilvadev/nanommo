import { Inject, Injectable } from '@nestjs/common';
import { DataService } from '../../data/data.service';
import { GM_EVENTS, GmCommandError, intArg, type GmCommand, type GmSchedulableEvent } from '../gm.types';

@Injectable()
export class StartEventCommand implements GmCommand {
  readonly name = 'start-event';
  readonly usage = '<event-code> <minutesToEvent>';
  readonly summary = 'Schedules a server event; the countdown announcements that fit are sent (0 = start now)';
  private readonly events = new Map<string, GmSchedulableEvent>();

  constructor(@Inject(GM_EVENTS) events: GmSchedulableEvent[], private readonly dataService: DataService) {
    for (const event of events) this.events.set(event.code, event);
  }

  async run([code, minutes]: string[]): Promise<string> {
    const event = this.events.get(String(code ?? '').toLowerCase());
    if (!event) throw new GmCommandError(`Unknown event code. Events: ${[...this.events.keys()].join(', ')}`);
    const lead = intArg(minutes, 'minutesToEvent', 0, 24 * 60);
    const { startsAt, endsAt, announcements } = await event.schedule(lead);
    const at = (ms: number) => this.clock(ms);
    const countdown = announcements.length ? `countdown at ${announcements.map((m) => `${m} min`).join(', ')}` : 'no countdown';
    return `${event.name} ${lead ? `starts in ${lead} min` : 'starts now'} (${at(startsAt)}–${at(endsAt)}), ${countdown}.`;
  }

  /** Wall-clock time in the game's event time zone. */
  private clock(ms: number): string {
    const timeZone = this.dataService.getSmashingSpreeConfig().timezone;
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(ms));
  }
}
