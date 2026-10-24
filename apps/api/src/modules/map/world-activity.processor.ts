import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { MapService } from './map.service';
import { BattleService } from '../battle/battle.service';
import { BattleQueueGateService } from '../battle/battle-queue-gate.service';
import { TownService } from '../town/town.service';
import { CharacterService } from '../character/character.service';

@Processor('battle-queue')
@Injectable()
export class WorldActivityProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorldActivityProcessor.name);
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recoveryInProgress: Promise<void> | null = null;
  constructor(private readonly maps: MapService, private readonly battles: BattleService, private readonly gate: BattleQueueGateService, private readonly town: TownService, private readonly characters: CharacterService) {}

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
      // A closed/unavailable startup gate is an expected pre-readiness state. Once
      // the gate opens, failures in the actual reconciler must be visible in logs.
      try { await this.gate.assertReadyForProcessing(); }
      catch { return; }
      try {
        const result = await this.maps.recoverPendingActivities();
        await this.town.reconcileCooking();
        const regeneratedCharacters = await this.characters.regenerateOffBattleResourcesForAll();
        for (const characterId of regeneratedCharacters) await this.battles.publishQueueUpdated(characterId);
        if (result.travel || result.gathering || result.flee) this.logger.log(`Recovered world activity jobs: travel=${result.travel} gathering=${result.gathering} flee=${result.flee}`);
        if (regeneratedCharacters.length) this.logger.log(`[off-battle-regen] updated=${regeneratedCharacters.length} characterIds=${regeneratedCharacters.join(',')}`);
      } catch (error) {
        this.logger.error(`[activity-recovery] reconciliation-failed error=${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      }
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
    const p = job.data;
    const attempt = `${Number(job.attemptsMade ?? 0) + 1}/${Number(job.opts.attempts ?? 1)}`;
    this.logger.log(`[world-job] start type=advance-travel jobId=${job.id} attempt=${attempt} characterId=${p.characterId} generation=${Number(p.generation)} scheduleVersion=${p.resumeAfterFlee ? 'resume-after-flee' : Number(p.scheduleVersion ?? 0)} delayMs=${Number(job.opts.delay ?? 0)}`);
    try {
      await this.gate.assertReadyForProcessing();
      await this.maps.advanceTravel(p.characterId, Number(p.generation), p.resumeAfterFlee ? undefined : Number(p.scheduleVersion));
      this.logger.log(`[world-job] handler-finished type=advance-travel jobId=${job.id} characterId=${p.characterId} generation=${Number(p.generation)} scheduleVersion=${Number(p.scheduleVersion ?? 0)}`);
      return { success: true, characterId: p.characterId };
    } catch (error) {
      this.logger.error(`[world-job] handler-error type=advance-travel jobId=${job.id} attempt=${attempt} characterId=${p.characterId} generation=${Number(p.generation)} scheduleVersion=${Number(p.scheduleVersion ?? 0)} error=${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  @Process('attempt-flee')
  async attemptFlee(job: Job<{ characterId: string; battleId: string; generation: number }>) {
    const p = job.data;
    const attempt = `${Number(job.attemptsMade ?? 0) + 1}/${Number(job.opts.attempts ?? 1)}`;
    this.logger.log(`[world-job] start type=attempt-flee jobId=${job.id} attempt=${attempt} characterId=${p.characterId} battleId=${p.battleId} generation=${Number(p.generation)}`);
    try {
      await this.gate.assertReadyForProcessing();
      const result = await this.battles.attemptFlee(p.characterId, Number(p.generation), p.battleId);
      this.logger.log(`[world-job] handler-finished type=attempt-flee jobId=${job.id} characterId=${p.characterId} battleId=${p.battleId} generation=${Number(p.generation)} result=${result}`);
      return { success: true, battleId: p.battleId, result };
    } catch (error) {
      this.logger.error(`[world-job] handler-error type=attempt-flee jobId=${job.id} attempt=${attempt} characterId=${p.characterId} battleId=${p.battleId} generation=${Number(p.generation)} error=${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  @Process('advance-stationary-activity')
  async advanceStationaryActivity(job: Job<{ characterId: string; cycleIndex: number }>) {
    const p = job.data;
    const attempt = `${Number(job.attemptsMade ?? 0) + 1}/${Number(job.opts.attempts ?? 1)}`;
    this.logger.log(`[world-job] start type=advance-stationary-activity jobId=${job.id} attempt=${attempt} characterId=${p.characterId} cycleIndex=${Number(p.cycleIndex)} delayMs=${Number(job.opts.delay ?? 0)}`);
    try {
      await this.gate.assertReadyForProcessing();
      await this.maps.advanceStationaryActivity(p.characterId, Number(p.cycleIndex));
      this.logger.log(`[world-job] handler-finished type=advance-stationary-activity jobId=${job.id} characterId=${p.characterId} expectedCycleIndex=${Number(p.cycleIndex)}`);
      return { success: true, characterId: p.characterId };
    } catch (error) {
      this.logger.error(`[world-job] handler-error type=advance-stationary-activity jobId=${job.id} attempt=${attempt} characterId=${p.characterId} cycleIndex=${Number(p.cycleIndex)} error=${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  @Process('complete-cooking')
  async completeCooking(job: Job<{ characterId: string; sessionId: string; generation: string }>) {
    await this.gate.assertReadyForProcessing();
    return this.town.completeCooking(job.data.characterId, job.data.sessionId);
  }

}
