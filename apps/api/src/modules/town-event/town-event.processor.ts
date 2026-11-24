import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bull';
import { DataService } from '../data/data.service';
import { TownEventService } from './town-event.service';
import { phaseAt } from './smashing-spree.logic';

export const TOWN_EVENT_QUEUE = 'town-event';
export const SMASHING_SPREE_TICK = 'smashing-spree-tick';
const EVERY_MINUTE = '* * * * *';

/** Registers the per-minute Smashing Spree tick (Bull keeps one repeatable across API instances). */
@Injectable()
export class TownEventScheduler implements OnModuleInit {
  private readonly logger = new Logger(TownEventScheduler.name);

  constructor(
    @InjectQueue('town-event') private readonly queue: Queue,
    private readonly dataService: DataService,
  ) {}

  async onModuleInit(): Promise<void> {
    const tz = this.dataService.getSmashingSpreeConfig().timezone;
    for (const job of await this.queue.getRepeatableJobs()) {
      if (job.name === SMASHING_SPREE_TICK && (job.cron !== EVERY_MINUTE || job.tz !== tz)) await this.queue.removeRepeatableByKey(job.key);
    }
    await this.queue.add(SMASHING_SPREE_TICK, {}, { repeat: { cron: EVERY_MINUTE, tz }, jobId: SMASHING_SPREE_TICK, removeOnComplete: true, removeOnFail: 50 });
    this.logger.log(`Smashing Spree tick scheduled (${EVERY_MINUTE}, ${tz})`);
  }
}

/** Each tick derives the phase of the current minute; TownEventService.runPhase is idempotent, so retries are safe. */
@Processor('town-event')
export class TownEventProcessor {
  private logger = new Logger(TownEventProcessor.name);

  constructor(
    private readonly townEvents: TownEventService,
    private readonly dataService: DataService,
  ) {}

  @Process(SMASHING_SPREE_TICK)
  async handleTick(_job: Job): Promise<void> {
    const phase = phaseAt(Date.now(), this.dataService.getSmashingSpreeConfig());
    if (!phase) return;
    try {
      await this.townEvents.runPhase(phase);
    } catch (error) {
      this.logger.error(`Smashing Spree ${phase.kind} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
