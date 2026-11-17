import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 3D character appearance. All four columns stay NULL for existing characters:
 * a NULL "appearance" means the character has not been through the creator yet.
 * Additive only; no existing row is rewritten.
 */
export class CharacterAppearance1800400000000 implements MigrationInterface {
  name = 'CharacterAppearance1800400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "sex" varchar(6)`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "height" smallint`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "heightCm" smallint`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "appearance" jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" DROP COLUMN IF EXISTS "appearance"`);
    await queryRunner.query(`ALTER TABLE "characters" DROP COLUMN IF EXISTS "heightCm"`);
    await queryRunner.query(`ALTER TABLE "characters" DROP COLUMN IF EXISTS "height"`);
    await queryRunner.query(`ALTER TABLE "characters" DROP COLUMN IF EXISTS "sex"`);
  }
}
