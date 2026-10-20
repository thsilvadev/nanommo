import { MigrationInterface, QueryRunner } from 'typeorm';

/** Persist each character's explicitly saved Town waypoint. */
export class SavedTownWaypoint1799500000000 implements MigrationInterface {
  name = 'SavedTownWaypoint1799500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "savedTownMapId" character varying NULL DEFAULT 'map_town'`);
    // Also cover a database where the column exists from a partial/manual earlier application.
    await queryRunner.query(`ALTER TABLE "characters" ALTER COLUMN "savedTownMapId" SET DEFAULT 'map_town'`);
    // Existing characters receive Sierra Village; the column default covers future character inserts.
    await queryRunner.query(`UPDATE "characters" SET "savedTownMapId" = 'map_town' WHERE "savedTownMapId" IS NULL`);
  }

  public async down(): Promise<void> {
    throw new Error("SavedTownWaypoint is forward-only; do not discard players' saved Towns after gameplay resumes.");
  }
}
