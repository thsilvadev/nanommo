import { MigrationInterface, QueryRunner } from 'typeorm';

/** Persist each character's explicitly saved Town waypoint. */
export class SavedTownWaypoint1799500000000 implements MigrationInterface {
  name = 'SavedTownWaypoint1799500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "savedTownMapId" character varying NULL');
  }

  public async down(): Promise<void> {
    throw new Error("SavedTownWaypoint is forward-only; do not discard players' saved Towns after gameplay resumes.");
  }
}
