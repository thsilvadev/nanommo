import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { BattleQueueEntry } from '../../database/entities/battle-queue-entry.entity';
import { Character } from '../../database/entities/character.entity';
import { BattleService } from './battle.service';

/**
 * SPEC §7.5 — crash / restart recovery.
 *
 * `BattleQueueEntry` rows are the source of truth, not the BullMQ job state. On
 * boot, every unresolved entry whose `endAt < now()` is resolved in order
 * (oldest first) exactly as the scheduled job would have — applying effects,
 * deaths, drops and level-ups — and then the live queue depth is re-derived and
 * topped back up to 5 for any character still alive and still on a map.
 *
 * This runs from `onApplicationBootstrap`, which Nest fires inside
 * `app.listen()` *before* the HTTP port is bound, so recovery completes before
 * the API accepts its first request.
 */
@Injectable()
export class BattleRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BattleRecoveryService.name);

  constructor(
    @InjectRepository(BattleQueueEntry)
    private readonly battleQueueRepo: Repository<BattleQueueEntry>,
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    private readonly battleService: BattleService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const startedAt = Date.now();
    this.logger.log('SPEC §7.5 crash recovery: scanning for stale unresolved battles');

    try {
      const resolvedCount = await this.resolveStaleBattles();
      const toppedUp = await this.topUpQueues();

      this.logger.log(
        `SPEC §7.5 crash recovery complete in ${Date.now() - startedAt}ms: ` +
          `resolved ${resolvedCount} stale battle(s), topped up ${toppedUp} character queue(s)`,
      );
    } catch (error) {
      // Never block startup on recovery: a failure here must not take the whole
      // API down, and `resolveBattle` is idempotent so the next boot retries
      // whatever is left.
      this.logger.error(
        `SPEC §7.5 crash recovery failed after ${Date.now() - startedAt}ms`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Resolve every unresolved entry whose `endAt` is already in the past,
   * oldest first. Ordering matters: a chain is sequential, so resolving seq=3
   * before seq=0 would apply HP/XP out of order.
   */
  private async resolveStaleBattles(): Promise<number> {
    const stale = await this.battleQueueRepo.find({
      where: { resolved: false, endAt: LessThan(new Date()) },
      order: { endAt: 'ASC', startAt: 'ASC', sequenceIndex: 'ASC' },
    });

    if (stale.length === 0) {
      this.logger.log('No stale unresolved battles found');
      return 0;
    }

    this.logger.log(
      `Found ${stale.length} stale unresolved battle(s) with endAt < now() - resolving oldest first`,
    );

    let resolved = 0;
    for (const battle of stale) {
      try {
        await this.battleService.resolveBattle(battle.id);
        resolved += 1;
      } catch (error) {
        // One bad row must not abort the rest of the recovery pass.
        this.logger.error(
          `Failed to recover battle ${battle.id} (char=${battle.characterId} ` +
            `seq=${battle.sequenceIndex} ${battle.monsterId}): ${
              error instanceof Error ? error.message : 'unknown'
            }`,
        );
      }
    }

    return resolved;
  }

  /**
   * Re-derive live queue depth per character and top it back up to 5 for
   * characters still alive and still on a map (§7.4.3).
   */
  private async topUpQueues(): Promise<number> {
    const characters = await this.characterRepo.find({
      where: { status: 'grinding' },
    });

    let toppedUp = 0;
    for (const character of characters) {
      if (!character.currentMapId) continue;

      try {
        const queue = await this.battleService.getBattleQueue(character.id, 100);
        if (queue.length >= 5) continue;

        await this.battleService.queueBattles(character.id, 5);
        toppedUp += 1;
      } catch (error) {
        this.logger.error(
          `Failed to top up queue for character ${character.id}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }

    return toppedUp;
  }
}
