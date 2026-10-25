import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds persistent Alchemy/Blacksmith progression and resumable cross-profession crafting. Forward-only. */
export class ProfessionCraftingRefinement1800000000000 implements MigrationInterface {
  name = 'ProfessionCraftingRefinement1800000000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "alchemy_level" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "alchemy_xp" bigint NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "blacksmith_level" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "blacksmith_xp" bigint NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "crafting_session" jsonb NULL`);
  }
  public async down(): Promise<void> {
    throw new Error('ProfessionCraftingRefinement is forward-only; profession progress and active crafting sessions must not be discarded.');
  }
}
