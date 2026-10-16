import { MigrationInterface, QueryRunner } from 'typeorm';

/** Forward-only location reset. Run with API and BullMQ consumers stopped. */
export class ResetAllCharactersToCurrentTown1799000000000 implements MigrationInterface {
  name = 'ResetAllCharactersToCurrentTown1799000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TEMP TABLE "town_reset_preserved_battles" ON COMMIT DROP AS
      SELECT DISTINCT ON ("characterId") "characterId", "id"
      FROM "battle_queue_entries"
      WHERE "resolved" = false AND "startAt" <= NOW()
      ORDER BY "characterId", "startAt" ASC, "sequenceIndex" ASC, "id" ASC
    `);
    // Keep only the earliest unresolved battle that has already started/due for
    // each character. Future projections are stale after the global Town reset.
    await queryRunner.query(`
      DELETE FROM "battle_queue_entries" b
      WHERE b."resolved" = false
        AND NOT EXISTS (SELECT 1 FROM "town_reset_preserved_battles" p WHERE p."id" = b."id")
    `);
    await queryRunner.query(`
      UPDATE "characters" c
      SET "currentMapId" = 'map_town',
          "status" = 'town',
          "pendingMapTransition" = CASE
            WHEN EXISTS (SELECT 1 FROM "town_reset_preserved_battles" p WHERE p."characterId" = c."id")
              THEN '{"destinationMapId":"map_town","reason":"town_request"}'::jsonb
            ELSE NULL
          END,
          "lastSeenAt" = NOW(),
          "stateVersion" = c."stateVersion" + CASE
            WHEN c."currentMapId" IS DISTINCT FROM 'map_town'
              OR c."status" IS DISTINCT FROM 'town'
              OR c."pendingMapTransition" IS DISTINCT FROM CASE
                WHEN EXISTS (SELECT 1 FROM "town_reset_preserved_battles" p WHERE p."characterId" = c."id")
                  THEN '{"destinationMapId":"map_town","reason":"town_request"}'::jsonb
                ELSE NULL
              END
            THEN 1 ELSE 0 END,
          "updatedAt" = NOW()
    `);
  }

  public async down(): Promise<void> {
    throw new Error('ResetAllCharactersToCurrentTown is forward-only; do not restore old grind states or delete battle history.');
  }
}
