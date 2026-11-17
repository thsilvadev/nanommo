import type { EntityManager } from 'typeorm';

export const PARTY_DEADLINE_REACHED = 'P7501';

/** Record the original cutoff before a mutation can remove or replace its clocks. */
export async function guardEncounterDeadline(
  manager: EntityManager,
  characterIds: string[],
  partyId: string | null,
): Promise<void> {
  await manager.query(`
    INSERT INTO party_deadline_checks (due_at)
    SELECT min(deadline)
    FROM (
      SELECT "dueAt" AS deadline FROM encounter_clocks
      WHERE status = 'searching' AND (
        ("ownerKind" = 'character' AND "ownerId" = ANY($1::uuid[]))
        OR ("ownerKind" = 'party' AND "ownerId" = $2::uuid)
      )
      UNION ALL
      SELECT "startAt" FROM battle_queue_entries
      WHERE "characterId" = ANY($1::uuid[]) AND NOT resolved
    ) AS deadlines
    HAVING count(*) > 0
    ON CONFLICT DO NOTHING
  `, [characterIds, partyId]);
}
