import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as webpush from 'web-push';
import { Character } from '../../database/entities/character.entity';
import { PushSubscription } from '../../database/entities/push-subscription.entity';

export type GamePushKind = 'inventory_full' | 'rare_drop_discarded' | 'level_up' | 'market_sale';
export interface GamePushEvent {
  kind: GamePushKind;
  title: { 'pt-BR': string; 'en-US': string };
  body: { 'pt-BR': string; 'en-US': string };
  target: 'inventory' | 'character' | 'inbox';
  data?: Record<string, unknown>;
}
interface PendingPush { id: string; token: string; event: GamePushEvent; createdAt: string; }
interface CharacterNotificationState { acknowledged: string[]; pendingPush: PendingPush | null; }

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private vapidReady = false;
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Character) private readonly characters: Repository<Character>,
    @InjectRepository(PushSubscription) private readonly subscriptions: Repository<PushSubscription>,
  ) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (publicKey && privateKey && subject) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidReady = true;
    } else {
      this.logger.warn('Web Push is disabled: configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.');
    }
  }
  private state(value: any): CharacterNotificationState {
    const raw = value && typeof value === 'object' ? value : {};
    return { acknowledged: Array.isArray(raw.acknowledged) ? raw.acknowledged.filter((x: any) => typeof x === 'string') : [], pendingPush: raw.pendingPush ?? null };
  }
  async getState(characterId: string): Promise<any> {
    const character = await this.characters.findOne({ where: { id: characterId }, select: ['id', 'notificationState'] as any });
    if (!character) throw new NotFoundException('Character not found');
    const state = this.state((character as any).notificationState);
    return { acknowledged: state.acknowledged, push: { enabled: this.vapidReady, publicKey: this.vapidReady ? process.env.VAPID_PUBLIC_KEY : null }, pending: !!state.pendingPush };
  }
  async acknowledge(characterId: string, keys: string[]): Promise<{ acknowledged: string[] }> {
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 100 || keys.some(key => typeof key !== 'string' || !key || key.length > 180)) throw new BadRequestException('Provide 1-100 valid acknowledgement keys');
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(Character);
      const character = await repo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      const state = this.state((character as any).notificationState);
      state.acknowledged = [...new Set([...state.acknowledged, ...keys])].slice(-5000);
      (character as any).notificationState = state;
      await repo.save(character);
      return { acknowledged: state.acknowledged };
    });
  }
  async registerSubscription(characterId: string, subscription: any, locale: string): Promise<void> {
    if (!this.vapidReady) throw new BadRequestException('Browser push notifications are not configured on this server');
    const endpoint = String(subscription?.endpoint ?? '');
    const p256dh = String(subscription?.keys?.p256dh ?? '');
    const auth = String(subscription?.keys?.auth ?? '');
    if (!endpoint.startsWith('https://') || endpoint.length > 3000 || !p256dh || !auth) throw new BadRequestException('Invalid browser push subscription');
    if (!(await this.characters.exist({ where: { id: characterId } }))) throw new NotFoundException('Character not found');
    const row = await this.subscriptions.findOne({ where: { endpoint } });
    await this.subscriptions.save(this.subscriptions.create({ ...(row ?? {}), characterId, endpoint, p256dh, auth, locale: locale === 'pt-BR' ? 'pt-BR' : 'en-US' }));
    await this.deliverPending(characterId);
  }
  async removeSubscription(characterId: string, endpoint: string): Promise<void> { await this.subscriptions.delete({ characterId, endpoint }); }
  async publish(characterId: string, event: GamePushEvent): Promise<void> {
    const pending: PendingPush = { id: randomUUID(), token: randomUUID(), event, createdAt: new Date().toISOString() };
    await this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(Character);
      const character = await repo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) return;
      const state = this.state((character as any).notificationState);
      state.pendingPush = pending;
      (character as any).notificationState = state;
      await repo.save(character);
    });
    await this.deliverPending(characterId);
  }
  async deliverPending(characterId: string): Promise<void> {
    if (!this.vapidReady) return;
    const character = await this.characters.findOne({ where: { id: characterId }, select: ['id', 'notificationState'] as any });
    if (!character) return;
    const pending = this.state((character as any).notificationState).pendingPush;
    if (!pending) return;
    const subscriptions = await this.subscriptions.find({ where: { characterId } });
    await Promise.all(subscriptions.map(async row => {
      try {
        const locale = row.locale === 'pt-BR' ? 'pt-BR' : 'en-US';
        const payload = JSON.stringify({ characterId, id: pending.id, token: pending.token,
          title: pending.event.title[locale], body: pending.event.body[locale], target: pending.event.target, data: pending.event.data ?? {} });
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, { TTL: 0, urgency: 'high' });
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) await this.subscriptions.delete({ id: row.id });
        else this.logger.warn(`Push delivery failed for character ${characterId}: ${error?.statusCode ?? error?.message ?? error}`);
      }
    }));
  }
  async confirmDisplayed(characterId: string, notificationId: string, token: string): Promise<void> {
    if (!characterId || !notificationId || !token) throw new BadRequestException('Invalid display receipt');
    await this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(Character);
      const character = await repo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) return;
      const state = this.state((character as any).notificationState);
      if (state.pendingPush?.id === notificationId && state.pendingPush.token === token) {
        state.pendingPush = null;
        (character as any).notificationState = state;
        await repo.save(character);
      }
    });
  }
}
