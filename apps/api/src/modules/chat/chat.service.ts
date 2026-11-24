import { BadRequestException, Injectable, Logger, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatReport } from '../../database/entities/chat-report.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';
import { GlobalChatHistoryService, TransientChatHistoryService } from './chat-history.service';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { Redis } from 'ioredis';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  constructor(
    @InjectRepository(ChatReport) private readonly chatReportRepo: Repository<ChatReport>,
    @InjectRepository(Character) private readonly characterRepo: Repository<Character>,
    private readonly dataService: DataService,
    private readonly globalHistory: GlobalChatHistoryService,
    private readonly transientHistory: TransientChatHistoryService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async sendChatMessage(characterId: string, channel: string, message: string): Promise<any> {
    if (channel !== 'global') throw new BadRequestException('Only the Global channel accepts player messages');
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) throw new BadRequestException('Message cannot be empty');
    if (text.length > 200) throw new BadRequestException('Message cannot exceed 200 characters');
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) throw new NotFoundException('Character not found');
    // Limit the account rather than the selected Character, so switching Characters cannot bypass the throttle.
    const rateLimitIdentity = String(character.userId ?? character.id);
    const limited = await this.redis.set(`chat:rate:${rateLimitIdentity}`, '1', 'EX', 5, 'NX');
    if (limited !== 'OK') throw new HttpException('You can send one message every five seconds', HttpStatus.TOO_MANY_REQUESTS);
    const saved = await this.globalHistory.append(character.id, character.name, text);
    const dto = { id: saved.id, channel: 'global', senderCharacterId: saved.senderCharacterId, username: saved.senderNameSnapshot, message: saved.message, sentAt: new Date(saved.sentAt).toISOString() };
    this.logger.log(`Global chat message accepted character=${character.id} messageId=${saved.id}`);
    try {
      await this.redis.publish('gateway:chat:global', JSON.stringify(dto));
    } catch (error) {
      this.logger.error(`Global message committed but live fan-out failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return dto;
  }

  async getChatHistory(channel: string, limit = 20, characterId?: string): Promise<any[]> {
    if (channel === 'global') {
      return (await this.globalHistory.list(limit)).map(row => ({ id: row.id, channel: 'global', senderCharacterId: row.senderCharacterId, username: row.senderNameSnapshot, message: row.message, sentAt: new Date(row.sentAt).toISOString() }));
    }
    if (channel === 'crafts') {
      const safe = Math.max(1, Math.min(40, Math.floor(Number(limit) || 40)));
      return (await this.redis.lrange('chat:crafts', 0, safe - 1)).map(row => JSON.parse(row)).reverse();
    }
    if (channel === 'market') {
      const safe = Math.max(1, Math.min(40, Math.floor(Number(limit) || 40)));
      return (await this.redis.lrange('chat:market', 0, safe - 1)).map(row => JSON.parse(row)).reverse();
    }
    if (channel === 'journal') {
      if (!characterId) throw new BadRequestException('Character context is required for Idle Journal');
      const [journal, announces] = await Promise.all([this.transientHistory.listJournal(characterId, limit), this.redis.lrange('chat:server-announces', 0, 39)]);
      return [...journal, ...announces.map(row => JSON.parse(row))].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt)).slice(-Math.max(1, Math.min(40, Number(limit) || 40)));
    }
    throw new BadRequestException('Unsupported chat channel');
  }

  async recordJournal(characterId: string, text: string, dedupeKey?: string): Promise<void> {
    // Journal payloads are transient, bounded and never stored by PostgreSQL.
    const key = dedupeKey ? `chat:journal:dedupe:${characterId}:${dedupeKey}` : undefined;
    if (key) {
      const acquired = await this.redis.set(key, '1', 'EX', 60 * 60 * 24 * 7, 'NX');
      if (acquired !== 'OK') return;
    }
    const row = { id: dedupeKey ?? require('crypto').randomUUID(), channel: 'journal' as const, message: text, sentAt: new Date().toISOString() };
    await this.transientHistory.appendJournal(characterId, row);
  }

  async announceCraft(characterId: string, characterName: string, itemId: string, completionId: string): Promise<void> {
    if (!this.dataService.getCraftAnnouncementItemIds().includes(itemId)) return;
    const item = this.dataService.getItemById(itemId);
    const row = { id: `craft:${completionId}`, channel: 'crafts', senderCharacterId: characterId,
      message: `${characterName} crafted ${item?.name ?? itemId}.`, sentAt: new Date().toISOString() };
    try {
      const accepted = await this.redis.set(`chat:crafts:dedupe:${completionId}`, '1', 'EX', 604800, 'NX');
      if (accepted !== 'OK') return;
      const serialized = JSON.stringify(row);
      await this.redis.multi().lpush('chat:crafts', serialized).ltrim('chat:crafts', 0, 39).exec();
      await this.redis.publish('gateway:chat:global', serialized);
    } catch (error) {
      this.logger.error(`Craft announcement failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async announceMarketListing(characterName: string, itemId: string, quantity: number, pricePerUnit: number, listingId: string): Promise<void> {
    const item = this.dataService.getItemById(itemId);
    const row = { id: `market:${listingId}`, channel: 'market', message: `${characterName} posted ${quantity}x ${item?.name ?? itemId} for ${pricePerUnit} gold each.`, sentAt: new Date().toISOString() };
    try {
      const accepted = await this.redis.set(`chat:market:dedupe:${listingId}`, '1', 'EX', 604800, 'NX');
      if (accepted !== 'OK') return;
      const serialized = JSON.stringify(row);
      await this.redis.multi().lpush('chat:market', serialized).ltrim('chat:market', 0, 39).exec();
      await this.redis.publish('gateway:chat:global', serialized);
    } catch (error) {
      this.logger.error(`Market announcement failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Yellow server announcement (chat System channel + on-screen band). `key`/`params` let clients localize; `message` is the English fallback. */
  async announceServerMessage(message: string, id: string, key?: string, params?: Record<string, unknown>): Promise<void> {
    const row = { id: `server:${id}`, channel: 'journal', type: 'server_announce', message, ...(key ? { key, params: params ?? {} } : {}), sentAt: new Date().toISOString() };
    try { const serialized = JSON.stringify(row); await this.redis.multi().lpush('chat:server-announces', serialized).ltrim('chat:server-announces', 0, 39).exec(); await this.redis.publish('gateway:chat:global', serialized); }
    catch (error) { this.logger.error(`Server message fan-out failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  /** Chat-only line (no on-screen popup) when a Smashing Spree vase held a gem. */
  async announceEventFind(characterName: string, itemId: string, mapId: string, id: string): Promise<void> {
    const item = this.dataService.getItemById(itemId);
    const map = this.dataService.getMaps().find((m: any) => m?.id === mapId);
    const row = {
      id: `event-find:${id}`, channel: 'journal', type: 'event_find', key: 'event.smashingSpree.found',
      params: { name: characterName, itemId, mapId },
      message: `${characterName} found ${item?.name ?? itemId} in ${map?.name ?? mapId}!`, sentAt: new Date().toISOString(),
    };
    try {
      const serialized = JSON.stringify(row);
      await this.redis.multi().lpush('chat:server-announces', serialized).ltrim('chat:server-announces', 0, 39).exec();
      await this.redis.publish('gateway:chat:global', serialized);
    } catch (error) { this.logger.error(`Event find announcement failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  async getAvailableChannels(): Promise<any[]> { return ['global', 'journal', 'crafts', 'market']; }

  async mutePlayer(_characterId: string, _playerId: string, _durationMinutes?: number): Promise<void> { throw new BadRequestException('Player mute is not supported'); }
  async unmutePlayer(_characterId: string, _playerId: string): Promise<void> { throw new BadRequestException('Player mute is not supported'); }
  async getMutedPlayers(_characterId?: string): Promise<string[]> { return []; }
  async reportChatMessage(_reporterId: string, _reportedPlayerId: string, _messageText: string, _reason: string): Promise<ChatReport> {
    throw new BadRequestException('Chat reporting is not supported');
  }
  async getChatReports(limit = 20): Promise<ChatReport[]> {
    return this.chatReportRepo.find({ order: { createdAt: 'DESC' }, take: Math.max(1, Math.min(100, Number(limit) || 20)) });
  }
  async resolveChatReport(_reportId: string, _action: string, _notes?: string): Promise<void> { throw new BadRequestException('Chat report resolution is not supported'); }
  async isPlayerMuted(): Promise<boolean> { return false; }
}
