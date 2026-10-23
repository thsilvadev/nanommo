import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { GlobalChatMessage } from '../../database/entities/global-chat-message.entity';

export function chatRetentionLimit(raw = process.env.CHAT_HISTORY_RETENTION_LIMIT): number {
  if (raw === undefined) return 40;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0) {
    throw new Error('CHAT_HISTORY_RETENTION_LIMIT must be a positive integer');
  }
  return Number(raw);
}

@Injectable()
export class GlobalChatHistoryService {
  readonly retentionLimit = chatRetentionLimit();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GlobalChatMessage) private readonly messages: Repository<GlobalChatMessage>,
  ) {}

  async append(characterId: string, senderName: string, message: string): Promise<GlobalChatMessage> {
    return this.dataSource.transaction(async manager => {
      // Serialize inserts and trimming across replicas so concurrent sends cannot exceed retention.
      await manager.query('SELECT pg_advisory_xact_lock($1)', [1977132601]);
      const repo = manager.getRepository(GlobalChatMessage);
      const row = repo.create({ senderCharacterId: characterId, senderNameSnapshot: senderName, message });
      const saved = await repo.save(row);
      await manager.query(
        'DELETE FROM "global_chat_messages" WHERE "id" IN (SELECT "id" FROM "global_chat_messages" ORDER BY "sent_at" DESC, "id" DESC OFFSET $1)',
        [this.retentionLimit],
      );
      return saved;
    });
  }

  async list(limit = this.retentionLimit): Promise<GlobalChatMessage[]> {
    const safe = Math.max(1, Math.min(this.retentionLimit, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : this.retentionLimit));
    const rows = await this.messages.find({ order: { sentAt: 'DESC', id: 'DESC' }, take: safe });
    return rows.reverse();
  }
}

@Injectable()
export class TransientChatHistoryService {
  private readonly limit = chatRetentionLimit();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async claimJournalKey(characterId: string, key: string): Promise<boolean> {
    return (await this.redis.set(`chat:journal:dedupe:${characterId}:${key}`, '1', 'EX', 604800, 'NX')) === 'OK';
  }

  async appendJournal(characterId: string, row: { id: string; channel: 'journal'; message: string; sentAt: string; severity?: 'success' | 'error' }): Promise<void> {
    const key = `chat:journal:${characterId}`;
    const serialized = JSON.stringify(row);
    await this.redis.multi().lpush(key, serialized).ltrim(key, 0, this.limit - 1).exec();
    await this.redis.publish(`gateway:chat:journal:${characterId}`, serialized);
  }

  async listJournal(characterId: string, limit = this.limit): Promise<any[]> {
    const safe = Math.max(1, Math.min(this.limit, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : this.limit));
    const rows = await this.redis.lrange(`chat:journal:${characterId}`, 0, safe - 1);
    return rows.map(row => JSON.parse(row)).reverse();
  }
}

@Injectable()
export class IdleJournalService {
  private readonly logger = new Logger(IdleJournalService.name);
  constructor(private readonly transientHistory: TransientChatHistoryService) {}

  async record(characterId: string, message: string, dedupeKey?: string, severity: 'success' | 'error' = 'success'): Promise<void> {
    const clean = String(message ?? '').trim();
    if (!characterId || !clean) return;
    try {
      if (dedupeKey) {
        const accepted = await this.transientHistory.claimJournalKey(characterId, dedupeKey);
        if (!accepted) return;
      }
      await this.transientHistory.appendJournal(characterId, {
        id: dedupeKey || require('crypto').randomUUID(),
        channel: 'journal', message: clean, sentAt: new Date().toISOString(), severity,
      });
    } catch (error) {
      this.logger.error(`Failed to append Idle Journal for character ${characterId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  townGuardHungry(characterId: string, key: string) {
    return this.record(characterId, 'Town Guard: You are hungry! Eat something or go cleanse your sins for a change.', key, 'error');
  }

  gathered(characterId: string, quantity: number, itemName: string, mapName: string, key: string) {
    return this.record(characterId, `You have gathered ${quantity}x ${itemName} in ${mapName}`, key);
  }
  passed(characterId: string, monsterName: string, key: string) {
    return this.record(characterId, `You passed by a ${monsterName} and moved on.`, key);
  }
  dodged(characterId: string, monsterName: string, key: string) {
    return this.record(characterId, `${monsterName} found you, but you misled it!`, key);
  }
  fled(characterId: string, monsterName: string, key: string) {
    return this.record(characterId, `You managed to flee the battle against ${monsterName}`, key);
  }
  stolen(characterId: string, monsterName: string, quantity: number, itemName: string, key: string) {
    return this.record(characterId, `${monsterName} has stolen ${quantity}x ${itemName} from you! Such a shame...`, key);
  }
  ate(characterId: string, itemName: string, key: string) {
    return this.record(characterId, `You just ate ${itemName}`, key);
  }
}
