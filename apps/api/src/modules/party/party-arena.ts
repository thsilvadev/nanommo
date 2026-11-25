/**
 * What the battle arena needs from a party beyond the shared battle itself:
 * how each character looks (appearance + visible gear, read live — gear only
 * changes between battles) and when the party's next encounter is due (party
 * battles are created when due, so the client cannot see them coming).
 */
import { refinementLevel, VISIBLE_EQUIPMENT_SLOTS, type CharacterAppearance, type VisibleEquipment, type VisibleRefinement } from '@nanommo/shared';

type Query = (sql: string, params: unknown[]) => Promise<any[]>;

export interface ArenaLook {
  sex: string | null; heightCm: number | null; appearance: CharacterAppearance;
  dominantHand: 'right' | 'left'; equipment: VisibleEquipment; refinement: VisibleRefinement | null;
}

const VISIBLE_SLOTS_SQL = VISIBLE_EQUIPMENT_SLOTS.map((slot) => `'${slot}'`).join(', ');

/** One query for every character id; a character without an appearance has no look (null). */
export async function loadArenaLooks(query: Query, characterIds: string[]): Promise<Map<string, ArenaLook | null>> {
  const looks = new Map<string, ArenaLook | null>();
  if (!characterIds.length) return looks;
  const rows = await query(
    `SELECT c.id, c.appearance, c.sex, c."heightCm", c."dominantHand",
            (SELECT json_object_agg(e.slot, e."itemId") FROM equipped_items e WHERE e."characterId" = c.id AND e.slot IN (${VISIBLE_SLOTS_SQL})) AS "equipment",
            (SELECT json_object_agg(e.slot, e."instanceData"->'refinementLevel') FROM equipped_items e WHERE e."characterId" = c.id AND e.slot IN (${VISIBLE_SLOTS_SQL}) AND e."instanceData"->'refinementLevel' IS NOT NULL) AS "refinement"
       FROM characters c WHERE c.id = ANY($1::uuid[])`,
    [characterIds],
  );
  for (const row of rows) {
    if (!row.appearance) { looks.set(row.id, null); continue; }
    const equipment: VisibleEquipment = {};
    const refinement: VisibleRefinement = {};
    for (const slot of VISIBLE_EQUIPMENT_SLOTS) {
      const itemId = row.equipment?.[slot];
      if (!itemId) continue;
      equipment[slot] = itemId;
      const level = refinementLevel({ refinementLevel: row.refinement?.[slot] });
      if (level) refinement[slot] = level;
    }
    looks.set(row.id, {
      sex: row.sex ?? null, heightCm: row.heightCm ?? null, appearance: row.appearance,
      dominantHand: row.dominantHand === 'left' ? 'left' : 'right', equipment, refinement: Object.keys(refinement).length ? refinement : null,
    });
  }
  return looks;
}

/** When the party's searching encounter clock is due (ISO), or null when it is not searching. */
export async function nextPartyEncounterAt(query: Query, partyId: string | null): Promise<string | null> {
  if (!partyId) return null;
  const row = (await query(`SELECT "dueAt" FROM encounter_clocks WHERE "ownerKind"='party' AND "ownerId"=$1 AND status='searching' ORDER BY "dueAt" LIMIT 1`, [partyId]))[0];
  return row?.dueAt ? new Date(row.dueAt).toISOString() : null;
}
