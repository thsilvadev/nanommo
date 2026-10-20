import { MigrationInterface, QueryRunner } from 'typeorm';

/** Persist authoritative world activity and auditable reward-free FLEE cancellation. */
export class WorldTravelGatheringFlee1799600000000 implements MigrationInterface {
  name = 'WorldTravelGatheringFlee1799600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "lastGrindStance" character varying(16) NOT NULL DEFAULT 'hunting'`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "travelIntent" jsonb NULL`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "gatheringLevel" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "gatheringCycle" jsonb NOT NULL DEFAULT '{"progress":0,"cycleIndex":0,"varianceSeconds":null,"lastUpdatedAt":null}'::jsonb`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "encounterCycle" jsonb NOT NULL DEFAULT '{"cycleIndex":0,"nextAt":null}'::jsonb`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "fleeAttemptIndex" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "fleeNextAttemptAt" timestamptz NULL`);

    await queryRunner.query(`ALTER TABLE "battle_queue_entries" ADD COLUMN IF NOT EXISTS "startingSnapshot" jsonb NULL`);
    await queryRunner.query(`ALTER TABLE "battle_queue_entries" ADD COLUMN IF NOT EXISTS "cancellationReason" character varying NULL`);
    await queryRunner.query(`ALTER TABLE "battle_queue_entries" ADD COLUMN IF NOT EXISTS "cancelledAt" timestamptz NULL`);

    // Future projections were generated from the old instant-transition contract. Preserve
    // any already-started battle, but mark later not-yet-started rows as auditable cancellations
    // so their delayed Bull jobs cannot pay stale rewards after the new route is resumed.
    await queryRunner.query(`UPDATE "battle_queue_entries" AS battle
      SET "resolved" = true, "cancellationReason" = 'legacy-map-transition-reconciled', "cancelledAt" = now()
      WHERE battle."resolved" = false AND battle."startAt" > now()
        AND battle."characterId" IN (
          SELECT character."id" FROM "characters" AS character
          WHERE character."pendingMapTransition" IS NOT NULL
        )`);

    // Convert legacy deferred map requests into a versioned activity intent before clearing
    // the old field, so the former battle resolver can no longer commit an instant stale map.
    await queryRunner.query(`UPDATE "characters" SET "travelIntent" = jsonb_build_object(
      'kind', 'legacy-transition',
      'destinationMapId', "pendingMapTransition"->>'destinationMapId',
      'requestedAt', COALESCE("pendingMapTransition"->>'requestedAt', now()::text),
      'generation', 1,
      'routeMapIds', '[]'::jsonb,
      'segmentProgress', 0,
      'lastAccruedAt', now()::text
    ) WHERE "travelIntent" IS NULL AND "pendingMapTransition" IS NOT NULL
      AND NULLIF("pendingMapTransition"->>'destinationMapId', '') IS NOT NULL`);
    await queryRunner.query(`UPDATE "characters" SET "pendingMapTransition" = NULL WHERE "pendingMapTransition" IS NOT NULL`);
    // Legacy requests could have stale future queue projections. Keep any battle that already
    // started so its immutable result can resolve, but let the new route scheduler own later encounters.
    await queryRunner.query(`DELETE FROM "battle_queue_entries" AS battle
      USING "characters" AS character
      WHERE battle."characterId" = character."id"
        AND character."travelIntent"->>'kind' = 'legacy-transition'
        AND battle."resolved" = false
        AND battle."startAt" > now()`);
    await queryRunner.query(`UPDATE "characters" SET "lastGrindStance" = 'hunting' WHERE "lastGrindStance" NOT IN ('hunting', 'gathering')`);
    await queryRunner.query(`UPDATE "characters" SET "gatheringLevel" = 1 WHERE "gatheringLevel" < 1`);
  }

  public async down(): Promise<void> {
    throw new Error('WorldTravelGatheringFlee is forward-only; removing it could discard route, collection and FLEE audit state.');
  }
}
