import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds server-owned Cooking progression and resumable session state. Forward-only. */
export class CookingProgression1799800000000 implements MigrationInterface {
  name = 'CookingProgression1799800000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "cooking_level" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "cooking_xp" bigint NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "cooking_session" jsonb NULL`);
  }
  public async down(): Promise<void> {
    throw new Error('CookingProgression is forward-only; player Cooking progress must not be discarded.');
  }
}
