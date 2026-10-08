import { MigrationInterface, QueryRunner } from 'typeorm';

export class DietAutoFeed1790907000000 implements MigrationInterface {
  name = 'DietAutoFeed1790907000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('characters');
    if (!table) return;
    if (!table.findColumnByName('diet')) {
      await queryRunner.query('ALTER TABLE "characters" ADD "diet" jsonb NOT NULL DEFAULT \'[]\'');
    }
    if (!table.findColumnByName('dietLevels')) {
      await queryRunner.query('ALTER TABLE "characters" ADD "dietLevels" jsonb NOT NULL DEFAULT \'{}\'');
    }
    if (!table.findColumnByName('autoFeed')) {
      await queryRunner.query('ALTER TABLE "characters" ADD "autoFeed" boolean NOT NULL DEFAULT false');
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "characters" DROP COLUMN "autoFeed"');
    await queryRunner.query('ALTER TABLE "characters" DROP COLUMN "dietLevels"');
    await queryRunner.query('ALTER TABLE "characters" DROP COLUMN "diet"');
  }
}
