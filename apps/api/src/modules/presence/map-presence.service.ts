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

  constructor(
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    void this.reconcileAuthoritativePresence();
    this.reconciliationTimer = setInterval(() => {
      void this.reconcileAuthoritativePresence();
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
   * Safety-net reconciliation, not the realtime trigger.
   * Normal map transitions call syncCharacter immediately. Reconciliation repairs
   * missed writes/crashes and disconnected grinders without using battle timing.
   */
  async reconcileAuthoritativePresence(): Promise<void> {
    try {
      const characters = await this.characterRepo.find({ select: ['id', 'currentMapId', 'pendingMapTransition'] });

      const mapMembers = new Map<string, Set<string>>();
      for (const character of characters) {
        const activeMapId = this.getActiveMapId(character);
        if (!activeMapId) continue;
        const members = mapMembers.get(activeMapId) ?? new Set<string>();
        members.add(character.id);
        mapMembers.set(activeMapId, members);
      }

      // Reconcile every existing Redis map hash, not only maps represented by
      // current PostgreSQL rows. This is what repairs stale members after a
      // character moves away or a process crashes before cleanup, including
      // Town (which can legitimately have no currently-authoritative member).
      const redisMapIds = new Set<string>();
      let cursor = '0';
      do {
        const result = await this.redis.scan(cursor, 'MATCH', 'map:players:*', 'COUNT', 100);
        cursor = String(result[0]);
        for (const key of result[1]) {
          redisMapIds.add(key.slice('map:players:'.length));
        }
      } while (cursor !== '0');

      for (const mapId of new Set([...mapMembers.keys(), ...redisMapIds])) {
        const key = 'map:players:' + mapId;
        const before = await this.getPlayersOnMap(mapId);
        const expected = mapMembers.get(mapId) ?? new Set<string>();
        const current = await this.redis.hgetall(key);

        for (const characterId of Object.keys(current)) {
          if (!expected.has(characterId)) {
            await this.redis.hdel(key, characterId);
          }
        }
        for (const characterId of expected) {
          await this.addPlayerToMap(characterId, mapId);
        }

        const after = await this.getPlayersOnMap(mapId);
        if (after !== before) {
          await this.publishMapPresence(mapId);
        }
      }
    } catch (error) {
      this.logger.warn(
        'Map presence reconciliation failed: ' + (error instanceof Error ? error.message : String(error)),
      );
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