import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bull';
import { DataService } from '../data/data.service';
import { TownEventService } from './town-event.service';
import { phaseAt, SmashingSpreePhase } from './smashing-spree.logic';

export const TOWN_EVENT_QUEUE = 'town-event';
export const SMASHING_SPREE_TICK = 'smashing-spree-tick';
/** Dev-only: run a given phase now (maintenance/smashing-spree-start-now). Ignored in production. */
export const SMASHING_SPREE_RUN_PHASE = 'smashing-spree-run-phase';
/** A phase of a GM-scheduled event (`/start-event smashing-spree <minutes>`); runs in every environment. */
export const SMASHING_SPREE_GM_PHASE = 'smashing-spree-gm-phase';
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
    await this.queue.add(SMASHING_SPREE_TICK, {}, { repeat: { cron: EVERY_MINUTE, tz }, jobId: SMASHING_SPREE_TICK, removeOnComplete: true, removeOnFail: 50, attempts: 3, backoff: { type: 'fixed', delay: 5000 } });
    this.logger.log(`Smashing Spree tick scheduled (${EVERY_MINUTE}, ${tz})`);
  }
}

/** Each tick runs the phase of its scheduled minute; runPhase guards every step, so retries redo only what failed. */
@Processor('town-event')
export class TownEventProcessor {
  private logger = new Logger(TownEventProcessor.name);

  constructor(
    private readonly townEvents: TownEventService,
    private readonly dataService: DataService,
  ) {}

  @Process(SMASHING_SPREE_RUN_PHASE)
  async handleRunPhase(job: Pick<Job<{ phase: SmashingSpreePhase }>, 'data'>): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      this.logger.warn('Ignoring a manual Smashing Spree phase in production');
      return;
    }
    if (job.data?.phase) await this.townEvents.runPhase(job.data.phase);
  }

  /**
   * A GM-scheduled phase. Like the tick, a start that is processed late still
   * runs while the event would be live, and a countdown more than a minute
   * late (API down at its time) is dropped instead of announcing a wrong time.
   */
  @Process(SMASHING_SPREE_GM_PHASE)
  async handleGmPhase(job: Pick<Job<{ phase: SmashingSpreePhase; runAt: number }>, 'data'>): Promise<void> {
    const phase = job.data?.phase;
    if (!phase) return;
    const now = Date.now();
    if (phase.kind === 'start' && now >= phase.endsAt) return;
    if (phase.kind === 'announce' && now - Number(job.data.runAt) > 60_000) return;
    try {
      await this.townEvents.runPhase(phase);
    } catch (error) {
      this.logger.error(`GM Smashing Spree ${phase.kind} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * The phase comes from the minute the job was scheduled for (a repeat job is
   * created with `delay` up to its cron time), not from when it runs: a tick
   * processed late (API restarting at 09:30) still starts the event while it
   * would be live. A countdown more than a minute late is dropped.
   */
  @Process(SMASHING_SPREE_TICK)
  async handleTick(job: Partial<Pick<Job, 'timestamp' | 'opts'>>): Promise<void> {
    const now = Date.now();
    const scheduled = Number(job?.timestamp) + Number(job?.opts?.delay ?? 0);
    const at = job?.opts?.repeat && Number.isFinite(scheduled) && scheduled > 0 ? scheduled : now;
    const phase = phaseAt(at, this.dataService.getSmashingSpreeConfig());
    if (!phase) return;
    if (phase.kind === 'start' && now >= phase.endsAt) return;
    if (phase.kind === 'announce' && now - Math.floor(at / 60_000) * 60_000 > 60_000) return;
    try {
      await this.townEvents.runPhase(phase);
    } catch (error) {
      this.logger.error(`Smashing Spree ${phase.kind} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
