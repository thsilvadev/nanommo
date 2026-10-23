import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds cumulative, server-authoritative Gathering XP. Forward-only. */
export class GatheringProgression1799900000000 implements MigrationInterface {
  name = 'GatheringProgression1799900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "gatheringXp" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`UPDATE "characters" SET "gatheringLevel" = FLOOR("gatheringXp" / 100)::integer + 1 WHERE "gatheringLevel" <> FLOOR("gatheringXp" / 100)::integer + 1`);
  }

  public async down(): Promise<void> {
    throw new Error('GatheringProgression is forward-only; player Gathering progress must not be discarded.');
  }
}
