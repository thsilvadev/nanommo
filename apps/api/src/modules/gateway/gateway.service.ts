import { Injectable, Inject, Logger } from '@nestjs/common';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';

export interface BattleResolvedPayload {
  entryId: string;
  outcome: 'victory' | 'defeat';
  xpGain: number;
  goldGain: number;
  drops: Array<{ itemId: string; quantity: number }>;
  characterAfter: {
    id: string;
    level: number;
    xp: number;
    hpCurrent: number;
    spCurrent: number;
    gold: number;
    status: string;
  };
}

export interface CharacterLeveledUpPayload {
  newLevel: number;
  unspentAttributePoints: number;
}

export interface CharacterDiedPayload {
  deathLog: any;
}

/**
 * GatewayService — handles event emission and presence tracking
 * Injected into NanommoGateway for WebSocket emission
 * Also available to other modules (battle, chat, market) for event triggers
 */
@Injectable()
export class GatewayService {
  private logger = new Logger('GatewayService');
  private readonly PRESENCE_EXPIRE_SECONDS = 3600; // 1 hour

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
  ): Promise<void> {
    const channel = `gateway:battle:queueUpdated:${characterId}`;
    await this.redis.publish(channel, JSON.stringify({ entries }));
    this.logger.debug(
      `Published battle:queueUpdated for ${characterId}: ${entries.length} entries`,
    );
  }

  /**
   * Update character presence in Redis
   */
  async updatePresence(
    characterId: string,
    location: string, // 'town' or mapId
  ): Promise<void> {
    await this.redis.setex(
      `presence:${characterId}`,
      this.PRESENCE_EXPIRE_SECONDS,
      location,
    );
  }

  /**
   * Add character to online set
   */
  async setOnline(characterId: string): Promise<void> {
    await this.redis.sadd('players:online', characterId);
  }

  /**
   * Remove character from online set
   */
  async setOffline(characterId: string): Promise<void> {
    await this.redis.srem('players:online', characterId);
    await this.redis.del(`presence:${characterId}`);
  }

  /**
   * Get online player count
   */
  async getOnlineCount(): Promise<number> {
    return this.redis.scard('players:online');
  }

  /**
   * Get players on a specific map
   */
  async getPlayersOnMap(mapId: string): Promise<number> {
    return this.redis.hlen(`map:players:${mapId}`);
  }

  /**
   * Add player to map
   */
  async addPlayerToMap(characterId: string, mapId: string): Promise<void> {
    await this.redis.hset(`map:players:${mapId}`, characterId, Date.now());
  }

  /**
   * Remove player from map
   */
  async removePlayerFromMap(
    characterId: string,
    mapId: string,
  ): Promise<void> {
    await this.redis.hdel(`map:players:${mapId}`, characterId);
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
