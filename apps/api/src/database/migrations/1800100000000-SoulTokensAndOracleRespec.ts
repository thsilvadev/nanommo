import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the Soul Token wallet and grants the initial balance to existing characters once. */
export class SoulTokensAndOracleRespec1800100000000 implements MigrationInterface {
  name = 'SoulTokensAndOracleRespec1800100000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "soul_tokens" integer NOT NULL DEFAULT 1000`);
    await queryRunner.query(`UPDATE "characters" SET "soul_tokens" = 1000 WHERE "soul_tokens" IS NULL OR "soul_tokens" < 0`);
  }
  async down(): Promise<void> {
    throw new Error('SoulTokensAndOracleRespec is forward-only; do not discard player currency.');
  }
}
