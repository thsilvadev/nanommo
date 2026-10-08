import { Injectable, Inject, Logger } from '@nestjs/common';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';

export interface BattleResolvedPayload {
  entryId: string;
  outcome: 'win' | 'loss';
  xpGain: number;
  goldGain: number;
  drops: Array<{ itemId: string; quantity: number }>;
  stateRevision: number;
  characterAfter: any;
  inventoryAfter: any[];
}

export interface CharacterLeveledUpPayload {
  newLevel: number;
  unspentAttributePoints: number;
}

export interface CharacterDiedPayload {
  deathLog: any;
}

export interface BattleQueueUpdatedPayload {
  entries: any[];
  stateRevision?: number;
  characterAfter?: any;
  inventoryAfter?: any[];
}

/**
 * GatewayService — publishes server events to Redis pub/sub.
 * NanommoGateway consumes those channels and emits the corresponding Socket.IO events.
 */
@Injectable()
export class GatewayService {
  private logger = new Logger('GatewayService');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Emit battle:resolved event via Redis pub/sub to all instances
   * (Actual Socket.IO emission handled by gateway listening to this channel)
   */
  async publishBattleResolved(
    characterId: string,
    payload: BattleResolvedPayload,
  ): Promise<void> {
    const channel = `gateway:battle:resolved:${characterId}`;
    await this.redis.publish(channel, JSON.stringify(payload));
    this.logger.debug(
      `Published battle:resolved for ${characterId}: ${payload.outcome}`,
    );
  }

  /**
   * Emit character:leveledUp event
   */
  async publishCharacterLeveledUp(
    characterId: string,
    payload: CharacterLeveledUpPayload,
  ): Promise<void> {
    const channel = `gateway:character:leveledUp:${characterId}`;
    await this.redis.publish(channel, JSON.stringify(payload));
    this.logger.debug(
      `Published character:leveledUp for ${characterId}: level ${payload.newLevel}`,
    );
  }

  /**
   * Emit character:died event
   */
  async publishCharacterDied(
    characterId: string,
    payload: CharacterDiedPayload,
  ): Promise<void> {
    const channel = `gateway:character:died:${characterId}`;
    await this.redis.publish(channel, JSON.stringify(payload));
    this.logger.debug(`Published character:died for ${characterId}`);
  }

  /**
   * Emit battle:queueUpdated event
   */
  async publishBattleQueueUpdated(
    characterId: string,
    entries: any[],
    state?: Pick<BattleQueueUpdatedPayload, 'stateRevision' | 'characterAfter' | 'inventoryAfter'>,
  ): Promise<void> {
    const channel = `gateway:battle:queueUpdated:${characterId}`;
    const payload: BattleQueueUpdatedPayload = { entries, ...state };
    await this.redis.publish(channel, JSON.stringify(payload));
    this.logger.debug(
      `Published battle:queueUpdated for ${characterId}: ${entries.length} entries`,
    );
  }


  /**
   * Emit mail:newItem event
   */
  async publishMailNewItem(
    characterId: string,
    payload: { mailId: string; itemId?: string; quantity?: number; subject: string },
  ): Promise<void> {
    const channel = `gateway:mail:newItem:${characterId}`;
    await this.redis.publish(channel, JSON.stringify(payload));
    this.logger.debug(
      `Published mail:newItem for ${characterId}: ${payload.subject}`,
    );
  }

  /**
   * Emit market:orderFilled event
   */
  async publishMarketOrderFilled(
    characterId: string,
    payload: {
      orderId: string;
      type: 'buy' | 'sell';
      itemId: string;
      quantity: number;
      pricePerUnit: number;
      matchCount: number;
    },
  ): Promise<void> {
    const channel = `gateway:market:orderFilled:${characterId}`;
    await this.redis.publish(channel, JSON.stringify(payload));
    this.logger.debug(
      `Published market:orderFilled for ${characterId}: ${payload.matchCount} matches`,
    );
  }
}
