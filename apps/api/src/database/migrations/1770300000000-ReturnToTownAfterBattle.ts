import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReturnToTownAfterBattle1770300000000 implements MigrationInterface {
  name = 'ReturnToTownAfterBattle1770300000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('characters');
    if (!table) return;
    if (!table.findColumnByName('returnToTownAfterBattle')) {
      await queryRunner.query('ALTER TABLE "characters" ADD "returnToTownAfterBattle" boolean NOT NULL DEFAULT false');
    }
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('characters');
    if (!table) return;
    if (table.findColumnByName('returnToTownAfterBattle')) {
      await queryRunner.query('ALTER TABLE "characters" DROP COLUMN "returnToTownAfterBattle"');
    }
  }
}
