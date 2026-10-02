import { MigrationInterface, QueryRunner } from 'typeorm';

export class DietAutoFeed1790907000000 implements MigrationInterface {
  name = 'DietAutoFeed1790907000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "characters" ADD "diet" jsonb NOT NULL DEFAULT \'[]\'');
    await queryRunner.query('ALTER TABLE "characters" ADD "dietLevels" jsonb NOT NULL DEFAULT \'{}\'');
    await queryRunner.query('ALTER TABLE "characters" ADD "autoFeed" boolean NOT NULL DEFAULT false');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "characters" DROP COLUMN "autoFeed"');
    await queryRunner.query('ALTER TABLE "characters" DROP COLUMN "dietLevels"');
    await queryRunner.query('ALTER TABLE "characters" DROP COLUMN "diet"');
  }
}
