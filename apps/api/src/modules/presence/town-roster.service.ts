import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Redis } from 'ioredis';
import { mulberry32Seed, positionAt, TownNav } from '@nanommo/shared';
import type { CharacterAppearance, TownRosterEntry, TownSceneDef, TownSleep, TownWakeFrom } from '@nanommo/shared';
import { Character } from '../../database/entities/character.entity';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { DataService } from '../data/data.service';

/** Max characters sent in one `town:roster` snapshot. */
export const TOWN_ROSTER_CAP = 200;
/** Town deltas share the map-presence pub/sub channel, tagged with kind:'town'. */
export const TOWN_EVENTS_CHANNEL = 'gateway:map:presence';
const ONLINE_SET = 'players:online';
const WHERE_KEY = 'town:where';
const stateKey = (mapId: string) => `town:state:${mapId}`;

export type TownEvent = 'town:join' | 'town:leave' | 'town:update';
export interface TownRosterSnapshot { mapId: string; serverNow: number; entries: TownRosterEntry[] }

/** Town-only runtime state kept in Redis (no DB column, no migration). */
interface TownState { seed: number; sleeping: TownSleep | null; wakeFrom: TownWakeFrom | null; lastSeenAt?: number }

interface RosterRow {
  id: string;
  name: string;
  level: number;
  appearance: CharacterAppearance | null;
  lastSeenAt: Date | string;
  inViewerParty?: boolean;
}

type PresenceFields = Pick<Character, 'currentMapId' | 'travelIntent' | 'pendingMapTransition'>;

/**
 * Who is in each town scene, and their town-only state (seed, sleep, wake origin).
 *
 * Presence is authoritative from PostgreSQL: every character whose currentMapId
 * is a town with a scene and who is not travelling, online or offline. Offline
 * characters sleep. Positions are never stored or sent: clients derive them from
 * (seed, server time) with the shared `positionAt`.
 */
@Injectable()
export class TownRosterService {
  private readonly navs = new Map<string, TownNav>();

  constructor(
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
    private readonly dataService: DataService,
  ) {}

  /** The town scene a character is standing in, or null (not a town, travelling, or transitioning). */
  isTownPresent(c: PresenceFields): string | null {
    if (!c.currentMapId || c.travelIntent || c.pendingMapTransition) return null;
    return this.dataService.getTownScene(c.currentMapId) ? c.currentMapId : null;
  }

  async snapshot(mapId: string, viewerId: string): Promise<TownRosterSnapshot> {
    const serverNow = Date.now();
    if (!this.dataService.getTownScene(mapId)) return { mapId, serverNow, entries: [] };
    const onlineIds = new Set(await this.redis.smembers(ONLINE_SET));
    // One narrow query; SQL pre-orders and limits, the same order is re-applied below.
    const rows: RosterRow[] = await this.characterRepo.query(
      `SELECT c.id, c.name, c.level, c.appearance, c."lastSeenAt",
              (vp."characterId" IS NOT NULL) AS "inViewerParty"
         FROM characters c
         LEFT JOIN party_members pm ON pm."characterId" = c.id
         LEFT JOIN party_members vp ON vp."partyId" = pm."partyId" AND vp."characterId" = $2
        WHERE c."currentMapId" = $1 AND c."travelIntent" IS NULL AND c."pendingMapTransition" IS NULL
        ORDER BY (c.id::text = $2) DESC, (vp."characterId" IS NOT NULL) DESC,
                 (c.id::text = ANY($3::text[])) DESC, c."lastSeenAt" DESC, c.id
        LIMIT $4`,
      [mapId, viewerId, [...onlineIds], TOWN_ROSTER_CAP],
    );
    const states = await this.redis.hgetall(stateKey(mapId));
    const rank = (row: RosterRow) =>
      row.id === viewerId ? 0 : row.inViewerParty ? 1 : onlineIds.has(row.id) ? 2 : 3;
    const entries = rows
      .map(row => ({ row, entry: this.toEntry(row, this.parseState(states[row.id]), onlineIds.has(row.id)) }))
      .sort((a, b) => rank(a.row) - rank(b.row) || (a.entry.lastSeenAt < b.entry.lastSeenAt ? 1 : a.entry.lastSeenAt > b.entry.lastSeenAt ? -1 : 0))
      .slice(0, TOWN_ROSTER_CAP)
      .map(({ entry }) => entry);
    return { mapId, serverNow, entries };
  }

  /**
   * Join/leave after an authoritative Character change. Idempotent and cheap, so
   * every place that may move a character (arrival, travel start, party moves)
   * can call it after its commit.
   *
   * `previousMapId`: the map before the change when the caller knows it, `null`
   * when the character was certainly not in a town, `undefined` when unknown.
   * Unknown + no stored state + in town means a lazy entry that is already on
   * screen, so no join is emitted (it would teleport it to the spawn).
   */
  async syncCharacter(characterId: string, previousMapId?: string | null): Promise<void> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) return;
    const next = this.isTownPresent(character);
    const stored = await this.redis.hget(WHERE_KEY, characterId);
    if (!stored && next && previousMapId === undefined) return;
    // A character with no stored state may still be on screen as a lazy entry.
    const townOf = (mapId: string | null | undefined) => (mapId && this.dataService.getTownScene(mapId) ? mapId : null);
    const previous = stored ?? townOf(previousMapId) ?? (next ? null : townOf(character.currentMapId));

    if (previous && previous !== next) {
      await this.redis.hdel(stateKey(previous), characterId);
      await this.redis.hdel(WHERE_KEY, characterId);
      await this.publish('town:leave', previous, { characterId });
    }
    if (next && next !== previous) {
      const now = Date.now();
      const online = (await this.redis.sismember(ONLINE_SET, characterId)) === 1;
      const spawn = this.dataService.getTownScene(next)!.spawn;
      const state: TownState = {
        seed: this.newSeed(),
        sleeping: online ? null : { at: now },
        wakeFrom: { x: spawn.x, z: spawn.z, at: now },
        lastSeenAt: now,
      };
      await this.saveState(next, characterId, state);
      await this.publish('town:join', next, { entry: this.toEntry(this.rowOf(character), state, online) });
    }
  }

  /** Socket presence: going offline puts the character to sleep; coming back wakes it. */
  async setOnline(characterId: string, online: boolean): Promise<TownRosterEntry | null> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    const mapId = character ? this.isTownPresent(character) : null;
    if (!character || !mapId) return null;
    const now = Date.now();
    // Before this call the character had the opposite status.
    const current = await this.loadState(mapId, character, !online);
    let state: TownState;
    if (online) state = current.sleeping ? this.wakeState(mapId, current, now) : current;
    else state = current.sleeping ? current : { ...current, sleeping: { at: now } };
    state = { ...state, lastSeenAt: now };
    await this.saveState(mapId, characterId, state);
    const entry = this.toEntry(this.rowOf(character), state, online);
    await this.publish('town:update', mapId, { entry });
    return entry;
  }

  /** `/sleep`: lie down where the character is now. */
  async sleep(characterId: string): Promise<TownRosterEntry> {
    const { character, mapId } = await this.requireTown(characterId);
    const current = await this.loadState(mapId, character, true);
    if (current.sleeping) return this.toEntry(this.rowOf(character), current, true);
    const state: TownState = { ...current, sleeping: { at: Date.now() } };
    await this.saveState(mapId, characterId, state);
    const entry = this.toEntry(this.rowOf(character), state, true);
    await this.publish('town:update', mapId, { entry });
    return entry;
  }

  /** Wake up (the player clicked an NPC): new seed, first leg starts where it slept. */
  async wake(characterId: string): Promise<TownRosterEntry> {
    const { character, mapId } = await this.requireTown(characterId);
    const current = await this.loadState(mapId, character, true);
    if (!current.sleeping) return this.toEntry(this.rowOf(character), current, true);
    const state = this.wakeState(mapId, current, Date.now());
    await this.saveState(mapId, characterId, state);
    const entry = this.toEntry(this.rowOf(character), state, true);
    await this.publish('town:update', mapId, { entry });
    return entry;
  }

  private async requireTown(characterId: string): Promise<{ character: Character; mapId: string }> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    const mapId = character ? this.isTownPresent(character) : null;
    if (!character || !mapId) throw new BadRequestException('NOT_IN_TOWN');
    return { character, mapId };
  }

  private wakeState(mapId: string, current: TownState, now: number): TownState {
    const def = this.dataService.getTownScene(mapId)!;
    const pose = positionAt(def, this.nav(mapId, def), current, now);
    return { seed: this.newSeed(), sleeping: null, wakeFrom: { x: pose.x, z: pose.z, at: now }, lastSeenAt: now };
  }

  /** Stored state, or the deterministic lazy one (seed from the id; asleep since lastSeenAt when offline). */
  private async loadState(mapId: string, character: Character, online: boolean): Promise<TownState> {
    const stored = this.parseState(await this.redis.hget(stateKey(mapId), character.id));
    if (stored) return stored;
    const lazy = this.lazyState(character.id, this.ms(character.lastSeenAt));
    return online ? { ...lazy, sleeping: null } : lazy;
  }

  private lazyState(characterId: string, lastSeenAt: number): TownState {
    return { seed: mulberry32Seed(characterId), sleeping: { at: lastSeenAt }, wakeFrom: null };
  }

  private async saveState(mapId: string, characterId: string, state: TownState): Promise<void> {
    await this.redis.hset(stateKey(mapId), characterId, JSON.stringify(state));
    await this.redis.hset(WHERE_KEY, characterId, mapId);
  }

  private parseState(raw: string | null | undefined): TownState | null {
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      return Number.isFinite(s?.seed) ? s : null;
    } catch {
      return null;
    }
  }

  private toEntry(row: RosterRow, state: TownState | null, online: boolean): TownRosterEntry {
    const dbSeen = this.ms(row.lastSeenAt);
    const s = state ?? (online ? { ...this.lazyState(row.id, dbSeen), sleeping: null } : this.lazyState(row.id, dbSeen));
    const lastSeen = Math.max(dbSeen, s.lastSeenAt ?? 0);
    // Offline always sleeps, even if a crash skipped the disconnect hook.
    const sleeping = s.sleeping ?? (online ? null : { at: lastSeen });
    return {
      characterId: row.id,
      name: row.name,
      level: Number(row.level),
      appearance: row.appearance ?? null,
      seed: s.seed,
      online,
      sleeping,
      wakeFrom: s.wakeFrom ?? null,
      lastSeenAt: new Date(lastSeen).toISOString(),
    };
  }

  private rowOf(c: Character): RosterRow {
    return { id: c.id, name: c.name, level: c.level, appearance: c.appearance ?? null, lastSeenAt: c.lastSeenAt };
  }

  private nav(mapId: string, def: TownSceneDef): TownNav {
    let nav = this.navs.get(mapId);
    if (!nav) { nav = new TownNav(def); this.navs.set(mapId, nav); }
    return nav;
  }

  private ms(value: Date | string | null | undefined): number {
    const t = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
    return Number.isFinite(t) ? t : 0;
  }

  private newSeed(): number {
    return randomBytes(4).readUInt32BE(0);
  }

  private async publish(event: TownEvent, mapId: string, body: { entry: TownRosterEntry } | { characterId: string }): Promise<void> {
    await this.redis.publish(TOWN_EVENTS_CHANNEL, JSON.stringify({ kind: 'town', event, mapId, ...body }));
  }
}
