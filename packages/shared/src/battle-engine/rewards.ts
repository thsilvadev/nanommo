import { Mulberry32, rngForIndex } from './prng';

/**
 * SPEC §11.5 Drop rates (confirmed, apply per kill - multiple can trigger)
 *
 * | Drop category                                | Chance per kill |
 * | | Monster part (common)                    | 5%             |
 * | | Consumable (tier-appropriate)            | 1%             |
 * | | Equipment (tier-appropriate, map pool)   | 0.1%           |
 * | | Monster part (rare)                      | 0.01%          |
 *
 * Those chances live in `monsters.json` under each monster's `drops[].chance`;
 * this module only interprets them and resolves the sentinel pool ids.
 */

/** Sentinel ids used by monsters.json to mean "resolve from a pool at roll time". */
export const CONSUMABLE_POOL_SENTINEL = 'item_consumable_random_map_tier';
export const EQUIPMENT_POOL_SENTINEL_PREFIX = 'equip_';
export const EQUIPMENT_POOL_SENTINEL_SUFFIX = '_roll';

export interface ResolvedDrop {
  itemId: string;
  quantity: number;
  /** Only present for equipment: SPEC §11.2 equipment attribute rolls. */
  instanceData?: Record<string, unknown>;
}

/** Global Grind XP pacing multiplier. The monster catalog keeps the canonical base rewards. */
export const GRIND_XP_RATE = 0.25;

export interface BattleRewards {
  xpGain: number;
  goldGain: number;
  drops: ResolvedDrop[];
}

export interface ItemsCatalog {
  consumables?: any[];
  equipment?: any[];
  monsterParts?: any[];
}

/**
 * XP: SPEC §11 - the monster's `xpReward` is the payout on a win.
 * Nothing is granted on a loss (SPEC §6.4 XP loss is handled by the caller).
 */
export function resolveXpGain(monster: any, outcome: 'win' | 'loss'): number {
  if (outcome !== 'win') return 0;
  const xpReward = Number(monster?.xpReward);
  if (!Number.isFinite(xpReward) || xpReward <= 0) return 0;
  return Math.max(0, Math.floor(xpReward * GRIND_XP_RATE));
}

/** Monster kills do not award gold. Gold remains available through non-monster sources such as vendors. */
export function resolveGoldGain(_monster: any, _rng: Mulberry32): number {
  return 0;
}

/**
 * Resolves a consumable drop to a specific item id: uniform pick from the 15
 * consumables (foods included - SPEC §11.5).
 */
export function resolveConsumablePool(items: ItemsCatalog, rng: Mulberry32): string | null {
  const pool = items?.consumables ?? [];
  if (pool.length === 0) return null;
  return rng.pick(pool).id;
}

/**
 * Resolves an equipment drop to a specific item id: uniform pick from
 * `items.equipment` entries whose `dropPool` includes the current mapId
 * (SPEC §11.2 / §11.5).
 */
export function resolveEquipmentPool(
  items: ItemsCatalog,
  mapId: string,
  rng: Mulberry32,
): any | null {
  const pool = (items?.equipment ?? []).filter(
    (e: any) => Array.isArray(e?.dropPool) && e.dropPool.includes(mapId),
  );
  if (pool.length === 0) return null;
  return rng.pick(pool);
}

/**
 * SPEC §11.2: "equipment attribute rolls" also go through mulberry32.
 */
export function rollEquipmentInstance(item: any, rng: Mulberry32): Record<string, unknown> | undefined {
  const roll = item?.randomRollOnDrop;
  if (!roll?.enabled) return undefined;
  const pool: string[] = Array.isArray(roll.attributesPool) ? roll.attributesPool : [];
  if (pool.length === 0) return undefined;
  return {
    rolledAttribute: rng.pick(pool),
    rolledValue: rng.nextIntInclusive(roll.min ?? 1, roll.max ?? 1),
  };
}

/**
 * SPEC §11.2 `nextDrops(monsterId, perMonsterKillCount[monsterId])`:
 * for each drop entry in monster.drops (independent rolls, a kill CAN yield
 * multiple items) - roll against `drop.chance`.
 *
 * Each entry gets its own deterministic sub-stream derived from
 * `${monsterId}:${killIndex}:${entryIndex}` so the rolls are independent of each
 * other while staying replayable.
 */
export function resolveDrops(
  monster: any,
  mapId: string,
  items: ItemsCatalog,
  killIndex: number,
): ResolvedDrop[] {
  const drops: ResolvedDrop[] = [];
  const entries: any[] = Array.isArray(monster?.drops) ? monster.drops : [];
  const monsterId = monster?.id ?? 'unknown_monster';

  entries.forEach((entry, entryIndex) => {
    const chance = Number(entry?.chance);
    if (!Number.isFinite(chance) || chance <= 0) return;

    const rng = rngForIndex(`${monsterId}:${killIndex}:${entryIndex}`, 0);
    if (!rng.chance(chance)) return;

    const itemId: string = entry?.itemId;
    if (!itemId) return;

    if (itemId === CONSUMABLE_POOL_SENTINEL) {
      const pickRng = rngForIndex(`${monsterId}:${killIndex}:${entryIndex}:consumable`, 0);
      const resolved = resolveConsumablePool(items, pickRng);
      if (resolved) drops.push({ itemId: resolved, quantity: 1 });
      return;
    }

    if (itemId.startsWith(EQUIPMENT_POOL_SENTINEL_PREFIX) && itemId.endsWith(EQUIPMENT_POOL_SENTINEL_SUFFIX)) {
      const pickRng = rngForIndex(`${monsterId}:${killIndex}:${entryIndex}:equipment`, 0);
      const equip = resolveEquipmentPool(items, mapId, pickRng);
      if (!equip) return;
      const instanceData = rollEquipmentInstance(equip, pickRng);
      drops.push({
        itemId: equip.id,
        quantity: 1,
        ...(instanceData ? { instanceData } : {}),
      });
      return;
    }

    // Concrete item (monster parts)
    drops.push({ itemId, quantity: 1 });
  });

  return drops;
}

/**
 * Full reward bundle for a resolved battle.
 */
export function resolveRewards(params: {
  monster: any;
  mapId: string;
  outcome: 'win' | 'loss';
  items: ItemsCatalog;
  killIndex: number;
  seed: string;
}): BattleRewards {
  const { monster, mapId, outcome, items, killIndex, seed } = params;
  if (outcome !== 'win') {
    return { xpGain: 0, goldGain: 0, drops: [] };
  }
  return {
    xpGain: resolveXpGain(monster, outcome),
    goldGain: 0,
    drops: resolveDrops(monster, mapId, items, killIndex),
  };
}
