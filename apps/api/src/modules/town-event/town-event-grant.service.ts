import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { InventoryService } from '../inventory/inventory.service';
import { MailService } from '../mail/mail.service';
import { BattleService } from '../battle/battle.service';
import { GatewayService } from '../gateway/gateway.service';
import type { TownEventPrize } from './smashing-spree.types';

export type PrizeDelivery = 'bag' | 'mail' | 'pending';
export const PENDING_GRANTS_KEY = 'ss:pendingGrants';

/**
 * Delivers a Smashing Spree prize. The caller's `HSETNX` claim guarantees one
 * call per vase (a socket handler, never redelivered). Bag first; on any failure
 * an idempotent system mail keyed by the vase; if that fails too, a Redis
 * pending row an operator can replay.
 */
@Injectable()
export class TownEventGrantService {
  private logger = new Logger(TownEventGrantService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly dataSource: DataSource,
    private readonly inventory: InventoryService,
    private readonly mail: MailService,
    @Inject(forwardRef(() => BattleService)) private readonly battle: BattleService,
    private readonly gateway: GatewayService,
  ) {}

  async grant(characterId: string, eventKey: string, mapId: string, vaseId: string, prize: TownEventPrize): Promise<PrizeDelivery> {
    const sourceKey = `smashing-spree:${eventKey}:${mapId}:${vaseId}`;
    try {
      await this.battle.withCharacterQueueLock(characterId, () => this.dataSource.transaction(async (manager) => {
        await this.inventory.addItem(characterId, prize.itemId, prize.quantity, 'inventory', undefined, manager);
      }));
      return 'bag';
    } catch (error) {
      this.logger.warn(`Smashing Spree prize ${sourceKey} could not go to the bag (${this.describe(error)}); sending by mail`);
    }
    try {
      const message = await this.mail.sendSystemMail(
        characterId, 'Smashing Spree prize', 'Your bag was full, so your Smashing Spree prize is waiting here.', undefined,
        { itemId: prize.itemId, quantity: prize.quantity }, undefined, sourceKey,
      );
      await this.gateway.publishMailNewItem(characterId, { mailId: message.id, itemId: prize.itemId, quantity: prize.quantity, subject: 'Smashing Spree prize' })
        .catch((error) => this.logger.warn(`Mail notice failed for ${sourceKey}: ${this.describe(error)}`));
      return 'mail';
    } catch (error) {
      this.logger.error(`Smashing Spree prize ${sourceKey} could not be mailed (${this.describe(error)}); recorded in ${PENDING_GRANTS_KEY}`);
    }
    await this.redis.lpush(PENDING_GRANTS_KEY, JSON.stringify({ characterId, eventKey, mapId, vaseId, prize, sourceKey, at: new Date().toISOString() }));
    return 'pending';
  }

  private describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }
}
