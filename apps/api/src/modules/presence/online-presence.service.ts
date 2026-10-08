import { Injectable, Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';

/**
 * Online/socket presence is separate from gameplay map presence.
 * This is the reusable home for the future heartbeat used by friend/online lists.
 */
@Injectable()
export class OnlinePresenceService {
  private readonly PRESENCE_EXPIRE_SECONDS = 3600;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async updateLocation(characterId: string, location: string): Promise<void> {
    await this.redis.setex(
      'presence:' + characterId,
      this.PRESENCE_EXPIRE_SECONDS,
      location,
    );
  }

  async setOnline(characterId: string): Promise<void> {
    await this.redis.sadd('players:online', characterId);
  }

  async setOffline(characterId: string): Promise<void> {
    await this.redis.srem('players:online', characterId);
    await this.redis.del('presence:' + characterId);
  }

  async getOnlineCount(): Promise<number> {
    return this.redis.scard('players:online');
  }

  /** Future heartbeat hook: refresh online TTL without changing gameplay state. */
  async touch(characterId: string, location = 'unknown'): Promise<void> {
    await this.updateLocation(characterId, location);
    await this.setOnline(characterId);
  }
}