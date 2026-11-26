import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bull';
import { DataService } from '../data/data.service';
import { GmCommandError, type GmSchedulableEvent } from '../gm/gm.types';
import { manualSchedule, MANUAL_MAX_MINUTES } from './smashing-spree.logic';
import { TownEventService } from './town-event.service';
import { SMASHING_SPREE_GM_PHASE, TOWN_EVENT_QUEUE } from './town-event.processor';

/** `/start-event smashing-spree <minutes>`: a one-off Smashing Spree with its countdown, on the town-event queue. */
@Injectable()
export class SmashingSpreeGmEvent implements GmSchedulableEvent {
  readonly code = 'smashing-spree';
  readonly name = 'Smashing Spree (Quebra-Quebra)';
  private readonly logger = new Logger(SmashingSpreeGmEvent.name);

  constructor(
    @InjectQueue(TOWN_EVENT_QUEUE) private readonly queue: Queue,
    private readonly dataService: DataService,
    private readonly townEvents: TownEventService,
  ) {}

  async schedule(minutesToStart: number): Promise<{ startsAt: number; endsAt: number; announcements: number[] }> {
    const cfg = this.dataService.getSmashingSpreeConfig();
    if (!Number.isInteger(minutesToStart) || minutesToStart < 0 || minutesToStart > MANUAL_MAX_MINUTES) {
      throw new GmCommandError(`minutesToEvent must be a whole number from 0 to ${MANUAL_MAX_MINUTES}`);
    }
    // Starting over a live one would replace its vases mid-event.
    if (minutesToStart === 0 && (await this.townEvents.activeEvent(cfg.townMapId))) {
      throw new GmCommandError('A Smashing Spree is running right now; wait for it to end or schedule this one later');
    }
    const now = Date.now();
    const phases = manualSchedule(now, minutesToStart, cfg);
    for (const { phase, runAt } of phases) {
      const suffix = phase.kind === 'announce' ? `${phase.kind}-${phase.minutes}` : phase.kind;
      await this.queue.add(SMASHING_SPREE_GM_PHASE, { phase, runAt }, {
        delay: Math.max(0, runAt - now), jobId: `${phase.eventKey}:${suffix}`,
        removeOnComplete: true, removeOnFail: 50, attempts: 3, backoff: { type: 'fixed', delay: 5000 },
      });
    }
    const start = phases.find((p) => p.phase.kind === 'start')!.phase as { startMs: number; endsAt: number; eventKey: string };
    const announcements = phases.flatMap((p) => (p.phase.kind === 'announce' ? [p.phase.minutes] : []));
    this.logger.warn(`GM Smashing Spree ${start.eventKey} scheduled: starts in ${minutesToStart} min, countdown ${announcements.join(',') || 'none'}`);
    return { startsAt: start.startMs, endsAt: start.endsAt, announcements };
  }
}
