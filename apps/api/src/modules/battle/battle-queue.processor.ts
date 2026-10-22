import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BattleService } from './battle.service';
import { CharacterService } from '../character/character.service';
import { BattleQueueGateService } from './battle-queue-gate.service';
import { IdleJournalService } from '../chat/chat-history.service';

/**
 * BattleQueueProcessor - Handles delayed battle resolution via BullMQ
 * Scheduled jobs fire at battle.endAt timestamps and resolve outcomes
 */
@Processor('battle-queue')
@Injectable()
export class BattleQueueProcessor {
  private readonly logger = new Logger(BattleQueueProcessor.name);

  constructor(
    private battleService: BattleService,
    private characterService: CharacterService,
    private readonly queueGate: BattleQueueGateService,
    private readonly idleJournal: IdleJournalService,
  ) {}

  /**
   * Process 'resolve-battle' job
   * Runs when battle endAt timestamp is reached
   */
  @Process('resolve-battle')
  async resolveBattle(job: Job<{ battleId: string }>) {
    const { battleId } = job.data;

    try {
      await this.queueGate.assertReadyForProcessing();
      this.logger.debug(`Resolving battle ${battleId}`);

      // Resolve the battle (apply XP, gold, drops, level-ups, death handling).
      // A duplicate delivery is a successful no-op; do not race the winning
      // caller's post-commit queue rebuild with a second top-up.
      const resolvedByThisCall = await this.battleService.resolveBattle(battleId);
      if (!resolvedByThisCall) {
        return { success: true, battleId, skipped: true };
      }

      // After resolution, fetch the resolved battle to get character ID
      const battle = await this.battleService.getBattleById(battleId);
      if (!battle) {
        this.logger.warn(`Battle ${battleId} not found after resolution`);
        return;
      }

      const character = await this.characterService.getCharacterById(
        battle.characterId,
      );

      if (character && character.status === 'grinding' && character.currentMapId && !character.pendingMapTransition) {
        // Get current queue depth
        const queue = await this.battleService.getBattleQueue(
          battle.characterId,
          100, // Fetch more to get accurate depth
        );

        const unresolvedCount = queue.filter((b: any) => !b.resolved).length;

        // If queue depth < 5, queue more battles
        if (unresolvedCount < 5) {
          this.logger.debug(
            `Queue depth ${unresolvedCount} < 5, generating new battles for character ${character.id}`,
          );
          await this.battleService.queueBattles(battle.characterId, 5);
        }
      }

      this.logger.debug(`Battle ${battleId} resolved successfully`);
      return { success: true, battleId };
    } catch (error) {
      // A battle row can legitimately be gone by the time its job fires: SPEC
      // §7.6 deletes the rest of the chain on death, and the §7.5 boot recovery
      // pass cleans up after a crash. There is nothing to retry in that case, and
      // retrying only produces noise plus a delayed `failed` job.
      if (error instanceof NotFoundException) {
        this.logger.debug(`Battle ${battleId} no longer exists - discarding job`);
        return { success: true, battleId, discarded: true };
      }

      this.logger.error(
        `Failed to resolve battle ${battleId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Throw to trigger retry
      throw error;
    }
  }


  /**
   * Process 'queue-battles' job
   * Generates 5 new battles for a character
   * Used on initial map entry or periodic top-up
   */
  @Process('queue-battles')
  async queueBattles(job: Job<{ characterId: string }>) {
    const { characterId } = job.data;

    try {
      await this.queueGate.assertReadyForProcessing();
      const character = await this.characterService.getCharacterById(characterId);
      const queueable = character?.status === 'grinding' && !!character.currentMapId && !character.pendingMapTransition;
      if (!queueable) return { success: true, characterId, skipped: true, reason: 'Character is not eligible to queue Grind battles' };
      this.logger.debug(`Queueing battles for character ${characterId}`);

      await this.battleService.queueBattles(characterId, 5);

      this.logger.debug(`Queued 5 new battles for character ${characterId}`);
      return { success: true, characterId };
    } catch (error) {
      this.logger.error(
        `Failed to queue battles for character ${characterId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /** Publish a pre-combat Gathering/Travel journal event when its projected encounter interval arrives. */
  @Process('idle-journal-precombat')
  async publishPreCombatJournal(job: Job<{
    characterId: string;
    mapId: string;
    monsterId: string;
    monsterName: string;
    aggressive: boolean;
    key: string;
    occurredAt: string;
    activityKind: 'gathering' | 'travel';
  }>) {
    await this.queueGate.assertReadyForProcessing();
    const event = job.data;
    const character = await this.characterService.getCharacterById(event.characterId);
    const stillInSameActivity = !!character && character.status === 'grinding' && character.currentMapId === event.mapId && (
      event.activityKind === 'travel'
        ? !!character.travelIntent
        : !character.travelIntent && character.lastGrindStance === 'gathering'
    );
    if (!stillInSameActivity) {
      this.logger.debug(`Discarded stale pre-combat Journal event ${event.key}: Character activity changed`);
      return { success: true, skipped: true };
    }

    if (event.aggressive) await this.idleJournal.dodged(event.characterId, event.monsterName, event.key);
    else await this.idleJournal.passed(event.characterId, event.monsterName, event.key);
    this.logger.debug(`Published pre-combat Journal event key=${event.key} occurredAt=${event.occurredAt}`);
    return { success: true, skipped: false };
  }

  /**
   * Job completed handler - for logging/events
   */
  onCompleted(job: Job) {
    this.logger.debug(`Job ${job.id} completed: ${job.name}`);
  }

  /**
   * Job failed handler - logs failures
   */
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `Job ${job.id} failed after ${job.attemptsMade} attempts: ${err.message}`,
    );
  }
}
