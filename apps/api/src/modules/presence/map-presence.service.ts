import { Injectable, Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character } from '../../database/entities/character.entity';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';

export interface MapPresencePayload {
  mapId: string;
  playersOnMap: number;
}

/**
 * Authoritative gameplay map presence.
 *
 * PostgreSQL decides whether a character belongs on a map. Redis is only the
 * fast, self-healing runtime cache, and this service publishes absolute
 * population snapshots through Redis pub/sub for the Socket.IO gateway.
 */
@Injectable()
export class MapPresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MapPresenceService.name);
  private readonly staleMs = 30_000;
  private readonly reconciliationIntervalMs = 10_000;
  private readonly channel = 'gateway:map:presence';
  private readonly transitionChannel = 'gateway:map:transition';
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private startupReconciled = false;
  private reconciliationInProgress: Promise<void> | null = null;

  constructor(
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    // Startup reconciliation is sequenced by BattleRecoveryService while the
    // BattleQueueGateService keeps all workers closed. Periodic repair cannot race it.
    this.reconciliationTimer = setInterval(() => {
      if (this.startupReconciled) void this.reconcileAuthoritativePresence();
    }, this.reconciliationIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
  }

  /** Returns the gameplay map a character should currently count on. */
  getActiveMapId(character: Pick<Character, 'currentMapId' | 'pendingMapTransition'>): string | null {
    return character.currentMapId && !character.pendingMapTransition ? character.currentMapId : null;
  }

  /**
   * Synchronize one character after an authoritative Character state change.
   * previousMapId is the map occupied before the DB mutation.
   * Future movement code should call this after changing currentMapId/status.
   */
  async syncCharacter(characterId: string, previousMapId: string | null = null): Promise<void> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) return;

    const nextMapId = this.getActiveMapId(character);

    if (previousMapId && previousMapId !== nextMapId) {
      await this.removeAndPublishIfChanged(characterId, previousMapId);
    }

    if (nextMapId) {
      await this.addAndPublishIfChanged(characterId, nextMapId);
    }
    if (previousMapId !== nextMapId) {
      await this.redis.publish(this.transitionChannel, JSON.stringify({ characterId, previousMapId, nextMapId }));
    }
  }

  async countActiveGrinders(mapId: string): Promise<number> {
    return this.characterRepo.count({
      where: {
        currentMapId: mapId,
        status: 'grinding' as any,
        pendingMapTransition: null,
      },
    });
  }

  async addPlayerToMap(characterId: string, mapId: string): Promise<void> {
    await this.redis.hset('map:players:' + mapId, characterId, Date.now());
  }

  async removePlayerFromMap(characterId: string, mapId: string): Promise<void> {
    await this.redis.hdel('map:players:' + mapId, characterId);
  }

  async getPlayersOnMap(mapId: string): Promise<number> {
    const key = 'map:players:' + mapId;
    const entries = await this.redis.hgetall(key);
    const now = Date.now();

    for (const [characterId, rawTimestamp] of Object.entries(entries)) {
      const timestamp = Number(rawTimestamp);
      if (!Number.isFinite(timestamp) || now - timestamp >= this.staleMs) {
        const current = await this.redis.hget(key, characterId);
        if (current === rawTimestamp) {
          await this.redis.hdel(key, characterId);
        }
      }
    }

    return this.redis.hlen(key);
  }

  async publishMapPresence(mapId: string): Promise<void> {
    const playersOnMap = await this.getPlayersOnMap(mapId);
    await this.redis.publish(
      this.channel,
      JSON.stringify({ mapId, playersOnMap }),
    );
  }

  /**
   * Full authoritative rebuild used by startup recovery and periodic repair.
   * Removes stale Redis-only memberships and excludes every pending transition.
   * Throws on Redis/DB failure so startup cannot open the worker gate on bad presence.
   */
  async reconcileAllPresenceOrThrow(): Promise<void> {
    if (this.reconciliationInProgress) return this.reconciliationInProgress;
    const run = async () => {
      const characters = await this.characterRepo.find({ select: ['id', 'currentMapId', 'pendingMapTransition'] });
      const desired = new Map<string, string[]>();
      for (const character of characters) {
        const mapId = this.getActiveMapId(character as Pick<Character, 'currentMapId' | 'pendingMapTransition'>);
        if (!mapId) continue;
        const ids = desired.get(mapId) ?? [];
        ids.push(character.id);
        desired.set(mapId, ids);
      }

      const existingKeys = new Set<string>();
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', 'map:players:*', 'COUNT', 500);
        cursor = next;
        for (const key of keys) existingKeys.add(key);
      } while (cursor !== '0');

      const oldCounts = new Map<string, number>();
      const allMapIds = new Set<string>();
      for (const key of existingKeys) {
        const mapId = key.slice('map:players:'.length);
        allMapIds.add(mapId);
        oldCounts.set(mapId, await this.redis.hlen(key));
      }
      for (const mapId of desired.keys()) allMapIds.add(mapId);

      if (existingKeys.size) await this.redis.del(...existingKeys);
      const timestamp = Date.now();
      for (const [mapId, ids] of desired) {
        const key = 'map:players:' + mapId;
        if (!ids.length) continue;
        const fields: string[] = [];
        for (const id of ids) fields.push(id, String(timestamp));
        await this.redis.hset(key, ...fields);
      }

      for (const mapId of allMapIds) {
        const nextCount = desired.get(mapId)?.length ?? 0;
        if (oldCounts.get(mapId) !== nextCount) {
          await this.redis.publish(this.channel, JSON.stringify({ mapId, playersOnMap: nextCount }));
        }
      }
      this.logger.log(`Authoritative map presence rebuilt: ${characters.length} characters, ${desired.size} active map(s), ${existingKeys.size} stale/current Redis key(s) replaced`);
    };
    this.reconciliationInProgress = run();
    try { await this.reconciliationInProgress; }
    finally { this.reconciliationInProgress = null; }
  }

  /** Enable periodic repair only after queue recovery and job reconciliation have succeeded. */
  enablePeriodicReconciliation(): void { this.startupReconciled = true; }

  /** Periodic safety net. Startup uses reconcileAllPresenceOrThrow directly. */
  async reconcileAuthoritativePresence(): Promise<void> {
    try { await this.reconcileAllPresenceOrThrow(); }
    catch (error) {
      this.logger.warn('Map presence reconciliation failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async addAndPublishIfChanged(characterId: string, mapId: string): Promise<void> {
    const before = await this.getPlayersOnMap(mapId);
    await this.addPlayerToMap(characterId, mapId);
    const after = await this.getPlayersOnMap(mapId);
    if (after !== before) {
      await this.publishMapPresence(mapId);
    }
  }

  private async removeAndPublishIfChanged(characterId: string, mapId: string): Promise<void> {
    const before = await this.getPlayersOnMap(mapId);
    await this.removePlayerFromMap(characterId, mapId);
    const after = await this.getPlayersOnMap(mapId);
    if (after !== before) {
      await this.publishMapPresence(mapId);
    }
  }
}