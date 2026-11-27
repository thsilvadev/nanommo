import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { GmAccessService, type GmRoleQueryExecutor } from './gm-access.service';

/** Server-owned, per-character mode. Role revocation is effective on every read/use. */
@Injectable()
export class GmTeleportModeService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis, private readonly access: GmAccessService) {}
  private key(characterId: string): string { return `gm:teleport:${characterId}`; }
  async enabled(userId: string, characterId: string, executor?: GmRoleQueryExecutor): Promise<boolean> {
    return await this.access.isGm(userId, executor) && await this.redis.get(this.key(characterId)) === '1';
  }
  async assertEnabled(userId: string, characterId: string, executor?: GmRoleQueryExecutor): Promise<void> {
    if (!await this.enabled(userId, characterId, executor)) throw new ForbiddenException('GM teleport mode is not enabled');
  }
  async toggle(userId: string, characterId: string): Promise<boolean> {
    if (!await this.access.isGm(userId)) throw new ForbiddenException('GM access required');
    // Atomic even when two slash commands arrive together.
    return Number(await this.redis.eval("if redis.call('GET', KEYS[1]) == '1' then redis.call('DEL', KEYS[1]); return 0 else redis.call('SET', KEYS[1], '1'); return 1 end", 1, this.key(characterId))) === 1;
  }
}
