import type { TownRosterEntry } from '@nanommo/shared';

/** Most characters rendered in one town scene (the roster itself carries up to 200). */
export const TOWN_RENDER_CAP = 100;

/** Same priority as the roster: self → party → online → offline by lastSeenAt desc. */
export function rankForRender(
  entries: readonly TownRosterEntry[],
  selfId: string | null | undefined,
  partyIds: ReadonlySet<string>,
  cap = TOWN_RENDER_CAP,
): TownRosterEntry[] {
  const rank = (e: TownRosterEntry) => (e.characterId === selfId ? 0 : partyIds.has(e.characterId) ? 1 : e.online ? 2 : 3);
  return [...entries]
    .sort((a, b) => rank(a) - rank(b) || (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0) || a.characterId.localeCompare(b.characterId))
    .slice(0, cap);
}
