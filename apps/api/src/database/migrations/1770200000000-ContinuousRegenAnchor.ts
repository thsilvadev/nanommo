import { MigrationInterface, QueryRunner } from 'typeorm';

export class ContinuousRegenAnchor1770200000000 implements MigrationInterface {
  name = 'ContinuousRegenAnchor1770200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('characters');
    if (!table) return;
    if (!table.findColumnByName('regenAnchorAt')) {
      await queryRunner.query('ALTER TABLE "characters" ADD "regenAnchorAt" timestamptz NULL');
    }
    await queryRunner.query('UPDATE "characters" SET "regenAnchorAt" = COALESCE("regenAnchorAt", "createdAt", NOW()) WHERE "regenAnchorAt" IS NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('characters');
    if (!table) return;
    if (table.findColumnByName('regenAnchorAt')) {
      await queryRunner.query('ALTER TABLE "characters" DROP COLUMN "regenAnchorAt"');
    }
  }
}
