/** maps.json row, as far as the arena needs it. */
export interface ArenaMapRow { id: string; coordinates?: { x: number; y: number }; monsters?: unknown }

/**
 * The species the player can meet soon: those of `mapId` and of its 8 neighbours (maps whose
 * coordinates differ by at most 1 on both axes), raid candidates included. Sorted, unique.
 * An unknown map (or no catalogue yet) gives none.
 */
export function nearbyMonsterIds(maps: ArenaMapRow[], mapId: string | null): string[] {
  const at = mapId ? maps.find((m) => m.id === mapId)?.coordinates : undefined;
  if (!at) return [];
  const ids = new Set<string>();
  const add = (id: unknown) => { if (typeof id === 'string' && id) ids.add(id); };
  for (const map of maps) {
    const c = map.coordinates;
    if (!c || Math.abs(c.x - at.x) > 1 || Math.abs(c.y - at.y) > 1 || !Array.isArray(map.monsters)) continue;
    for (const row of map.monsters as Array<{ monsterId?: unknown; raid?: { candidates?: Array<{ monsterId?: unknown }> } }>) {
      add(row?.monsterId);
      if (Array.isArray(row?.raid?.candidates)) for (const candidate of row.raid!.candidates!) add(candidate?.monsterId);
    }
  }
  return [...ids].sort();
}
