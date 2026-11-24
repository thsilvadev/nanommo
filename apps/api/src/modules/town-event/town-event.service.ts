import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { TownNav } from '@nanommo/shared';
import type { TownEventSnapshot, TownEventVase } from '@nanommo/shared';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { DataService } from '../data/data.service';
import { TownRosterService, TOWN_EVENTS_CHANNEL } from '../presence/town-roster.service';
import { ChatService } from '../chat/chat.service';
import { TownEventGrantService, PrizeDelivery } from './town-event-grant.service';
import { assignPrizes, eventSeed, placeVases, SmashingSpreePhase } from './smashing-spree.logic';
import type { TownEventPrize } from './smashing-spree.types';

export type HitVaseError = 'NOT_IN_TOWN' | 'NO_EVENT' | 'COOLDOWN' | 'OUT_OF_RANGE' | 'UNKNOWN_VASE' | 'ALREADY_BROKEN';
export type HitVaseResult =
  | { success: true; vaseId: string; prize: (TownEventPrize & { via: PrizeDelivery }) | null }
  | { success: false; error: HitVaseError };

/** Every per-event key expires on its own an hour later. */
const EVENT_TTL_S = 3600;
const ACTIVE_KEY = 'ss:active';
const eventKey = (ek: string, mapId: string, part: 'vases' | 'prizes' | 'broken' | 'prizesLeft') => `ss:${ek}:${mapId}:${part}`;
export const townAttackCooldownKey = (characterId: string) => `town:attackCd:${characterId}`;

interface ActiveEntry { eventKey: string; endsAt: number }

/**
 * Smashing Spree (pt-BR: Quebra-Quebra). All state lives in Redis and expires by
 * itself: the public vase layout, the server-only prize map, and the
 * `HSETNX broken` claim that makes "first hit wins" atomic.
 */
@Injectable()
export class TownEventService {
  private readonly logger = new Logger(TownEventService.name);
  private readonly navs = new Map<string, TownNav>();
  private readonly layouts = new Map<string, Map<string, TownEventVase>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly dataService: DataService,
    private readonly roster: TownRosterService,
    private readonly chat: ChatService,
    private readonly grants: TownEventGrantService,
  ) {}

  /** Runs one scheduler phase; each (event, phase) runs at most once. */
  async runPhase(phase: SmashingSpreePhase): Promise<void> {
    const guard = `ss:phase:${phase.eventKey}:${phase.kind}${phase.kind === 'announce' ? `:${phase.minutes}` : ''}`;
    if ((await this.redis.set(guard, '1', 'EX', EVENT_TTL_S * 24, 'NX')) !== 'OK') return;
    if (phase.kind === 'announce') {
      const unit = phase.minutes === 1 ? 'minute' : 'minutes';
      await this.chat.announceServerMessage(
        `The Smashing Spree starts in ${phase.minutes} ${unit}! Head to any town.`,
        `${phase.eventKey}:soon:${phase.minutes}`, 'event.smashingSpree.soon', { minutes: phase.minutes },
      );
    } else if (phase.kind === 'start') {
      for (const mapId of this.dataService.getTownSceneMapIds()) {
        try { await this.startTown(phase.eventKey, mapId, phase.endsAt); }
        catch (error) { this.logger.error(`Smashing Spree start failed in ${mapId}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      await this.chat.announceServerMessage('The Smashing Spree has begun! Break the vases in town!', `${phase.eventKey}:started`, 'event.smashingSpree.started', {});
    } else {
      for (const mapId of this.dataService.getTownSceneMapIds()) {
        const active = await this.active(mapId);
        if (active?.eventKey !== phase.eventKey) continue;
        await this.redis.hdel(ACTIVE_KEY, mapId);
        await this.publish('town:event:ended', mapId, { eventKey: phase.eventKey, reason: 'timeout' });
      }
    }
  }

  /** Live state for a town (unbroken vases only), or null when no event is running there. */
  async activeEvent(mapId: string): Promise<TownEventSnapshot | null> {
    const active = await this.active(mapId);
    if (!active || Date.now() >= active.endsAt) return null;
    const layout = await this.layout(active.eventKey, mapId);
    if (!layout) return null;
    const broken = new Set(await this.redis.hkeys(eventKey(active.eventKey, mapId, 'broken')));
    return { eventKey: active.eventKey, mapId, endsAt: active.endsAt, vases: [...layout.values()].filter((v) => !broken.has(v.id)) };
  }

  /** Where an unbroken vase of the running event stands. */
  async vasePosition(mapId: string, vaseId: string): Promise<{ x: number; z: number } | null> {
    const active = await this.active(mapId);
    if (!active || Date.now() >= active.endsAt) return null;
    const vase = (await this.layout(active.eventKey, mapId))?.get(vaseId);
    if (!vase || (await this.redis.hget(eventKey(active.eventKey, mapId, 'broken'), vaseId))) return null;
    return { x: vase.x, z: vase.z };
  }

  async hitVase(characterId: string, vaseId: string): Promise<HitVaseResult> {
    const cfg = this.dataService.getSmashingSpreeConfig();
    const pose = await this.roster.poseOf(characterId);
    if (!pose) return { success: false, error: 'NOT_IN_TOWN' };
    const { mapId } = pose;
    const active = await this.active(mapId);
    if (!active || Date.now() >= active.endsAt) return { success: false, error: 'NO_EVENT' };
    // General town attack rule: one swing per cooldown, whatever it hits.
    if ((await this.redis.set(townAttackCooldownKey(characterId), '1', 'PX', cfg.attackCooldownMs, 'NX')) !== 'OK') return { success: false, error: 'COOLDOWN' };
    const ek = active.eventKey;
    const vase = (await this.layout(ek, mapId))?.get(vaseId);
    if (!vase) return { success: false, error: 'UNKNOWN_VASE' };
    if (Math.hypot(pose.x - vase.x, pose.z - vase.z) > cfg.hitRange) return { success: false, error: 'OUT_OF_RANGE' };
    if (!(await this.redis.hsetnx(eventKey(ek, mapId, 'broken'), vaseId, characterId))) return { success: false, error: 'ALREADY_BROKEN' };

    const rawPrize = await this.redis.hget(eventKey(ek, mapId, 'prizes'), vaseId);
    const prize: TownEventPrize | null = rawPrize ? JSON.parse(rawPrize) : null;
    await this.publish('town:event:vaseBroken', mapId, { eventKey: ek, vaseId, byCharacterId: characterId, at: Date.now(), prize: !!prize });
    if (!prize) return { success: true, vaseId, prize: null };

    const left = await this.redis.decr(eventKey(ek, mapId, 'prizesLeft'));
    const via = await this.grants.grant(characterId, ek, mapId, vaseId, prize);
    if (cfg.announceFindItemIds.includes(prize.itemId)) {
      await this.chat.announceEventFind(pose.name, prize.itemId, mapId, `${ek}:${mapId}:${vaseId}`);
    }
    if (left === 0 && (await this.redis.hdel(ACTIVE_KEY, mapId))) {
      await this.publish('town:event:ended', mapId, { eventKey: ek, reason: 'all-prizes-found' });
    }
    return { success: true, vaseId, prize: { ...prize, via } };
  }

  private async startTown(ek: string, mapId: string, endsAt: number): Promise<void> {
    const cfg = this.dataService.getSmashingSpreeConfig();
    const def = this.dataService.getTownScene(mapId);
    if (!def) return;
    let nav = this.navs.get(mapId);
    if (!nav) { nav = new TownNav(def); this.navs.set(mapId, nav); }
    const seed = eventSeed(ek, mapId);
    const vases = placeVases(def, nav, seed, cfg);
    const prizes = assignPrizes(vases, seed, cfg);
    const prizeFields: Record<string, string> = {};
    for (const [vaseId, prize] of prizes) prizeFields[vaseId] = JSON.stringify(prize);
    await this.redis.set(eventKey(ek, mapId, 'vases'), JSON.stringify(vases), 'EX', EVENT_TTL_S);
    await this.redis.hset(eventKey(ek, mapId, 'prizes'), prizeFields);
    await this.redis.expire(eventKey(ek, mapId, 'prizes'), EVENT_TTL_S);
    await this.redis.hset(eventKey(ek, mapId, 'broken'), '_', '');
    await this.redis.hdel(eventKey(ek, mapId, 'broken'), '_');
    await this.redis.expire(eventKey(ek, mapId, 'broken'), EVENT_TTL_S);
    await this.redis.set(eventKey(ek, mapId, 'prizesLeft'), String(prizes.size), 'EX', EVENT_TTL_S);
    await this.redis.hset(ACTIVE_KEY, mapId, JSON.stringify({ eventKey: ek, endsAt } satisfies ActiveEntry));
    this.layouts.set(`${ek}:${mapId}`, new Map(vases.map((v) => [v.id, v])));
    await this.publish('town:event:vases', mapId, { eventKey: ek, endsAt, vases });
  }

  private async active(mapId: string): Promise<ActiveEntry | null> {
    const raw = await this.redis.hget(ACTIVE_KEY, mapId);
    if (!raw) return null;
    try { return JSON.parse(raw) as ActiveEntry; } catch { return null; }
  }

  /** Public layout of one town's event (memoised; another API instance may have spawned it). */
  private async layout(ek: string, mapId: string): Promise<Map<string, TownEventVase> | null> {
    const key = `${ek}:${mapId}`;
    const cached = this.layouts.get(key);
    if (cached) return cached;
    const raw = await this.redis.get(eventKey(ek, mapId, 'vases'));
    if (!raw) return null;
    const layout = new Map((JSON.parse(raw) as TownEventVase[]).map((v) => [v.id, v]));
    if (this.layouts.size > 50) this.layouts.clear();
    this.layouts.set(key, layout);
    return layout;
  }

  private async publish(event: 'town:event:vases' | 'town:event:vaseBroken' | 'town:event:ended', mapId: string, body: Record<string, unknown>): Promise<void> {
    await this.redis.publish(TOWN_EVENTS_CHANNEL, JSON.stringify({ kind: 'town', event, mapId, ...body }));
  }
}
