import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Redis } from 'ioredis';
import { mulberry32Seed, positionAt, TownNav } from '@nanommo/shared';
import { TOWN_EMOTES, VISIBLE_EQUIPMENT_SLOTS } from '@nanommo/shared';
import type { CharacterAppearance, Sex, TownEmote, TownEmoteKind, TownMove, TownRosterEntry, TownSceneDef, TownSleep, TownWakeFrom, VisibleEquipment } from '@nanommo/shared';
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
/** Clicks closer together than this (per character) are ignored: input spam never becomes broadcast spam. */
export const TOWN_MOVE_MIN_INTERVAL_MS = 200;
/** Clicking an NPC walks to this far in front of it. */
const NPC_APPROACH_DISTANCE = 1.6;
const round = (v: number) => Math.round(v * 1000) / 1000;

export type TownEvent = 'town:join' | 'town:leave' | 'town:update';
export interface TownRosterSnapshot { mapId: string; serverNow: number; entries: TownRosterEntry[] }

/** Town-only runtime state kept in Redis (no DB column, no migration). */
interface TownState {
  seed: number;
  sleeping: TownSleep | null;
  wakeFrom: TownWakeFrom | null;
  lastSeenAt?: number;
  /** Set by `/sleep`. Older states slept just for being offline; those are read as awake. */
  sleptByCommand?: boolean;
  /** Last click-to-move; wandering resumes from its destination by itself. */
  move?: TownMove | null;
  emote?: TownEmote | null;
  joinedAt?: number | null;
  /** Bumped on every write, so clients can drop an older delta that arrives late. */
  rev?: number;
}

export type TownMoveTarget = { x: number; z: number } | { npcId: string };

interface RosterRow {
  id: string;
  name: string;
  level: number;
  appearance: CharacterAppearance | null;
  sex?: Sex | null;
  heightCm?: number | null;
  lastSeenAt: Date | string;
  inViewerParty?: boolean;
  dominantHand?: 'right' | 'left' | null;
  /** Visible slot -> item id (json_object_agg; null when nothing is equipped). */
  equipment?: Record<string, string> | null;
}

const VISIBLE_SLOTS_SQL = VISIBLE_EQUIPMENT_SLOTS.map((slot) => `'${slot}'`).join(', ');

type PresenceFields = Pick<Character, 'currentMapId' | 'travelIntent' | 'pendingMapTransition'>;

/**
 * Who is in each town scene, and their town-only state (seed, sleep, wake origin).
 *
 * Presence is authoritative from PostgreSQL: every character whose currentMapId
 * is a town with a scene and who is not travelling, online or offline. Offline
 * characters keep wandering like everyone else; only `/sleep` lies a character
 * down (until it wakes by interacting). Positions are never stored or sent: clients derive them from
 * (seed, server time) with the shared `positionAt`.
 */
@Injectable()
export class TownRosterService {
  private readonly navs = new Map<string, TownNav>();
  private readonly lastMoveAt = new Map<string, number>();

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
      `SELECT c.id, c.name, c.level, c.appearance, c.sex, c."heightCm", c."lastSeenAt", c."dominantHand",
              (SELECT json_object_agg(e.slot, e."itemId") FROM equipped_items e WHERE e."characterId" = c.id AND e.slot IN (${VISIBLE_SLOTS_SQL})) AS "equipment",
              (vp."characterId" IS NOT NULL) AS "inViewerParty"
         FROM characters c
         LEFT JOIN party_members pm ON pm."characterId" = c.id
         LEFT JOIN party_members vp ON vp."partyId" = pm."partyId" AND vp."characterId" = $2::uuid
        WHERE c."currentMapId" = $1 AND c."travelIntent" IS NULL AND c."pendingMapTransition" IS NULL
        ORDER BY (c.id = $2::uuid) DESC, (vp."characterId" IS NOT NULL) DESC,
                 (c.id::text = ANY($3::text[])) DESC, c."lastSeenAt" DESC, c.id
        LIMIT $4`,
      [mapId, viewerId, [...onlineIds], TOWN_ROSTER_CAP],
    );
    const states = await this.redis.hgetall(stateKey(mapId));
    const rank = (row: RosterRow) =>
      row.id === viewerId ? 0 : row.inViewerParty ? 1 : onlineIds.has(row.id) ? 2 : 3;
    const entries = rows
      .map(row => ({ row, entry: this.toEntry(row, this.parseState(mapId, states[row.id]), onlineIds.has(row.id)) }))
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
        sleeping: null,
        wakeFrom: { x: spawn.x, z: spawn.z, at: now },
        lastSeenAt: now,
        joinedAt: now,
      };
      await this.saveState(next, characterId, state);
      await this.publish('town:join', next, { entry: this.toEntry(await this.rowOf(character), state, online) });
    }
  }

  /**
   * Socket presence. Going offline or coming back no longer changes sleep: an
   * offline character keeps wandering, and one that used `/sleep` stays asleep
   * until it wakes by interacting. Only `online` and `lastSeenAt` change.
   */
  async setOnline(characterId: string, online: boolean): Promise<TownRosterEntry | null> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    const mapId = character ? this.isTownPresent(character) : null;
    if (!character || !mapId) return null;
    const now = Date.now();
    const current = await this.loadState(mapId, character);
    const state: TownState = { ...current, lastSeenAt: now };
    await this.saveState(mapId, characterId, state);
    const entry = this.toEntry(await this.rowOf(character), state, online);
    await this.publish('town:update', mapId, { entry });
    return entry;
  }

  /** Re-broadcast a town entry after a visible change (hand gear). No-op outside a town. */
  async refresh(characterId: string): Promise<void> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    const mapId = character ? this.isTownPresent(character) : null;
    if (!character || !mapId) return;
    const online = (await this.redis.sismember(ONLINE_SET, characterId)) === 1;
    const state = await this.loadState(mapId, character);
    await this.publish('town:update', mapId, { entry: this.toEntry(await this.rowOf(character), state, online) });
  }

  /** `/sleep`: lie down where the character is now. */
  async sleep(characterId: string): Promise<TownRosterEntry> {
    const { character, mapId } = await this.requireTown(characterId);
    const current = await this.loadState(mapId, character);
    if (current.sleeping) return this.toEntry(await this.rowOf(character), current, true);
    const now = Date.now();
    // An emote ends where it was held: anchor there, then lie down.
    const def = this.dataService.getTownScene(mapId)!;
    const held = current.emote ? positionAt(def, this.nav(mapId, def), current, now) : null;
    const move: TownMove | null | undefined = held
      ? { fromX: round(held.x), fromZ: round(held.z), toX: round(held.x), toZ: round(held.z), at: now, lookAt: null }
      : current.move;
    const state: TownState = { ...current, move, emote: null, sleeping: { at: now }, sleptByCommand: true };
    await this.saveState(mapId, characterId, state);
    const entry = this.toEntry(await this.rowOf(character), state, true);
    await this.publish('town:update', mapId, { entry });
    return entry;
  }

  /** Wake up (the player clicked an NPC): new seed, first leg starts where it slept. */
  async wake(characterId: string): Promise<TownRosterEntry> {
    const { character, mapId } = await this.requireTown(characterId);
    const current = await this.loadState(mapId, character);
    if (!current.sleeping) return this.toEntry(await this.rowOf(character), current, true);
    const state = this.wakeState(mapId, current, Date.now());
    await this.saveState(mapId, characterId, state);
    const entry = this.toEntry(await this.rowOf(character), state, true);
    await this.publish('town:update', mapId, { entry });
    return entry;
  }

  /**
   * Click-to-move: walk from where the character is now to the clicked ground
   * point (snapped to the nearest reachable cell) or to the front of a clicked
   * NPC. Ends `/sleep` and emotes. One Redis write and one broadcast per click.
   */
  async move(characterId: string, target: TownMoveTarget): Promise<TownRosterEntry> {
    const { character, mapId } = await this.requireTown(characterId);
    const def = this.dataService.getTownScene(mapId)!;
    const nav = this.nav(mapId, def);
    const current = await this.loadState(mapId, character);
    const now = Date.now();
    const last = this.lastMoveAt.get(characterId) ?? 0;
    if (now - last < TOWN_MOVE_MIN_INTERVAL_MS) return this.toEntry(await this.rowOf(character), current, true);

    let point: [number, number];
    let lookAt: [number, number] | null = null;
    if ('npcId' in target) {
      const spot = typeof target.npcId === 'string' ? def.npcSpots[target.npcId] : undefined;
      if (!spot) throw new BadRequestException('UNKNOWN_NPC');
      const facing = (spot.facing * Math.PI) / 180;
      point = [spot.x + Math.sin(facing) * NPC_APPROACH_DISTANCE, spot.z + Math.cos(facing) * NPC_APPROACH_DISTANCE];
      lookAt = [spot.x, spot.z];
    } else {
      if (!Number.isFinite(target.x) || !Number.isFinite(target.z)) throw new BadRequestException('INVALID_TARGET');
      point = [Math.max(0, Math.min(def.size.w, target.x)), Math.max(0, Math.min(def.size.h, target.z))];
    }
    const pose = positionAt(def, nav, current, now);
    const to = nav.nearestReachable(point[0], point[1], def.spawn.x, def.spawn.z);
    if (!to) throw new BadRequestException('INVALID_TARGET');
    this.lastMoveAt.set(characterId, now);
    if (this.lastMoveAt.size > 10000) this.lastMoveAt.clear();
    const state: TownState = {
      ...current,
      sleeping: null,
      sleptByCommand: false,
      emote: null,
      move: { fromX: round(pose.x), fromZ: round(pose.z), toX: round(to[0]), toZ: round(to[1]), at: now, lookAt },
      lastSeenAt: now,
    };
    return this.write(mapId, character, state);
  }

  /**
   * `/dance`, `/sit`: hold the emote where the character is now, with no time
   * limit; the same command again (or a click-to-move) ends it. Ending it
   * stands the character there and lets it wander again after the usual pause.
   */
  async emote(characterId: string, kind: TownEmoteKind): Promise<TownRosterEntry> {
    if (!(TOWN_EMOTES as readonly string[]).includes(kind)) throw new BadRequestException('UNKNOWN_EMOTE');
    const { character, mapId } = await this.requireTown(characterId);
    const def = this.dataService.getTownScene(mapId)!;
    const current = await this.loadState(mapId, character);
    const now = Date.now();
    const pose = positionAt(def, this.nav(mapId, def), { ...current, emote: null }, now);
    // Anchor the base pose to "standing here since now": the frozen emote and whatever
    // follows it start from this point, not from wherever the old wander would be.
    const anchor: TownMove = { fromX: round(pose.x), fromZ: round(pose.z), toX: round(pose.x), toZ: round(pose.z), at: now, lookAt: null };
    const stop = current.emote?.kind === kind;
    const state: TownState = {
      ...current,
      sleeping: null,
      sleptByCommand: false,
      move: anchor,
      emote: stop ? null : { kind, at: now },
      lastSeenAt: now,
    };
    return this.write(mapId, character, state);
  }

  private async write(mapId: string, character: Character, state: TownState): Promise<TownRosterEntry> {
    await this.saveState(mapId, character.id, state);
    const entry = this.toEntry(await this.rowOf(character), state, true);
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
    return { seed: this.newSeed(), sleeping: null, wakeFrom: { x: pose.x, z: pose.z, at: now }, lastSeenAt: now, sleptByCommand: false, move: null, emote: null, joinedAt: current.joinedAt ?? null, rev: current.rev };
  }

  /** Stored state, or the deterministic lazy one (seed from the id, awake). */
  private async loadState(mapId: string, character: Character): Promise<TownState> {
    const stored = this.parseState(mapId, await this.redis.hget(stateKey(mapId), character.id));
    return stored ?? this.lazyState(character.id);
  }

  private lazyState(characterId: string): TownState {
    return { seed: mulberry32Seed(characterId), sleeping: null, wakeFrom: null };
  }

  private async saveState(mapId: string, characterId: string, state: TownState): Promise<void> {
    state.rev = (state.rev ?? 0) + 1;
    await this.redis.hset(stateKey(mapId), characterId, JSON.stringify(state));
    await this.redis.hset(WHERE_KEY, characterId, mapId);
  }

  private parseState(mapId: string, raw: string | null | undefined): TownState | null {
    if (!raw) return null;
    let s: TownState;
    try {
      s = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!Number.isFinite(s?.seed)) return null;
    // Legacy offline sleep (not `/sleep`): stand up where it lay, deterministically.
    if (s.sleeping && !s.sleptByCommand && this.dataService.getTownScene(mapId)) {
      const def = this.dataService.getTownScene(mapId)!;
      const at = s.sleeping.at;
      const pose = positionAt(def, this.nav(mapId, def), s, at);
      return { seed: s.seed, sleeping: null, wakeFrom: { x: pose.x, z: pose.z, at }, lastSeenAt: s.lastSeenAt };
    }
    return s;
  }

  private toEntry(row: RosterRow, state: TownState | null, online: boolean): TownRosterEntry {
    const dbSeen = this.ms(row.lastSeenAt);
    const s = state ?? this.lazyState(row.id);
    const lastSeen = Math.max(dbSeen, s.lastSeenAt ?? 0);
    // Only `/sleep` sleeps; being offline does not.
    const sleeping = s.sleeping ?? null;
    const equipment: VisibleEquipment = {};
    for (const slot of VISIBLE_EQUIPMENT_SLOTS) { const id = row.equipment?.[slot]; if (id) equipment[slot] = id; }
    return {
      characterId: row.id,
      name: row.name,
      level: Number(row.level),
      appearance: row.appearance ?? null,
      sex: row.sex ?? null,
      heightCm: row.heightCm == null ? null : Number(row.heightCm),
      seed: s.seed,
      online,
      sleeping,
      wakeFrom: s.wakeFrom ?? null,
      move: s.move ?? null,
      emote: s.emote ?? null,
      joinedAt: s.joinedAt ?? null,
      rev: s.rev ?? 0,
      lastSeenAt: new Date(lastSeen).toISOString(),
      dominantHand: row.dominantHand === 'left' ? 'left' : 'right',
      mainHandItemId: equipment.mainHand ?? null,
      offHandItemId: equipment.offHand ?? null,
      equipment,
    };
  }

  private async rowOf(c: Character): Promise<RosterRow> {
    const rows: Array<{ slot: string; itemId: string }> = await this.characterRepo.query(
      `SELECT slot, "itemId" FROM equipped_items WHERE "characterId" = $1::uuid AND slot IN (${VISIBLE_SLOTS_SQL})`,
      [c.id],
    ).catch(() => []);
    const equipment = Object.fromEntries((Array.isArray(rows) ? rows : []).filter((r) => r?.slot && r.itemId).map((r) => [r.slot, r.itemId]));
    return {
      id: c.id, name: c.name, level: c.level, appearance: c.appearance ?? null, sex: c.sex ?? null, heightCm: c.heightCm ?? null,
      lastSeenAt: c.lastSeenAt, dominantHand: c.dominantHand ?? null, equipment,
    };
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
