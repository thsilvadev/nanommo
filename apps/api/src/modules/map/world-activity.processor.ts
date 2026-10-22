import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { MapService } from './map.service';
import { BattleService } from '../battle/battle.service';
import { BattleQueueGateService } from '../battle/battle-queue-gate.service';
import { TownService } from '../town/town.service';

@Processor('battle-queue')
@Injectable()
export class WorldActivityProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorldActivityProcessor.name);
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recoveryInProgress: Promise<void> | null = null;
  constructor(private readonly maps: MapService, private readonly battles: BattleService, private readonly gate: BattleQueueGateService, private readonly town: TownService) {}

  onModuleInit(): void {
    // Redis retains delayed jobs across restarts; this reconciler repairs only persisted activity whose job is missing.
    // Startup recovery is explicitly kicked after BattleRecoveryService opens the queue gate.
    // This timer is only a safety net for jobs lost later, never an early boot race.
    this.recoveryTimer = setInterval(() => { void this.recoverActivities(); }, 10_000);
  }
  onModuleDestroy(): void { if (this.recoveryTimer) clearInterval(this.recoveryTimer); this.recoveryTimer = null; }

  private async recoverActivities(): Promise<void> {
    if (this.recoveryInProgress) return this.recoveryInProgress;
    this.recoveryInProgress = (async () => {
      try {
        await this.gate.assertReadyForProcessing();
        const result = await this.maps.recoverPendingActivities();
        await this.town.reconcileCooking();
        if (result.travel || result.gathering || result.flee) this.logger.log(`Recovered world activity jobs: travel=${result.travel} gathering=${result.gathering} flee=${result.flee}`);
      } catch { /* The shared battle-queue gate stays authoritative until normal startup recovery opens it. */ }
    })();
    try { await this.recoveryInProgress; } finally { this.recoveryInProgress = null; }
  }

  @Process('resume-world-activities')
  async resumeWorldActivities(job: Job<{ requestedAt?: string }>) {
    await this.gate.assertReadyForProcessing();
    await this.recoverActivities();
    this.logger.log(`Persisted world activities re-armed${job.data?.requestedAt ? ` after ${job.data.requestedAt}` : ''}`);
    return { success: true };
  }

  @Process('advance-travel')
  async advanceTravel(job: Job<{ characterId: string; generation: number; scheduleVersion?: number; resumeAfterFlee?: boolean }>) {
    await this.gate.assertReadyForProcessing();
    const p = job.data;
    await this.maps.advanceTravel(p.characterId, Number(p.generation), p.resumeAfterFlee ? undefined : Number(p.scheduleVersion));
    return { success: true, characterId: p.characterId };
  }

  @Process('attempt-flee')
  async attemptFlee(job: Job<{ characterId: string; battleId: string; generation: number }>) {
    await this.gate.assertReadyForProcessing();
    const p = job.data;
    const result = await this.battles.attemptFlee(p.characterId, Number(p.generation), p.battleId);
    this.logger.debug(`FLEE attempt ${p.battleId}: ${result}`);
    return { success: true, battleId: p.battleId, result };
  }

  @Process('advance-stationary-activity')
  async advanceStationaryActivity(job: Job<{ characterId: string; cycleIndex: number }>) {
    await this.gate.assertReadyForProcessing();
    const p = job.data;
    await this.maps.advanceStationaryActivity(p.characterId, Number(p.cycleIndex));
    return { success: true, characterId: p.characterId };
  }
  @Process('complete-cooking')
  async completeCooking(job: Job<{ characterId: string; sessionId: string; generation: string }>) {
    await this.gate.assertReadyForProcessing();
    return this.town.completeCooking(job.data.characterId, job.data.sessionId);
  }

}
