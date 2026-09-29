import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrindPendingEquipment1770100000000 implements MigrationInterface {
  name = 'GrindPendingEquipment1770100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('characters');
    if (!table) return;
    if (table.findColumnByName('pendingEquipmentChanges')) return;
    await queryRunner.query(
      'ALTER TABLE "characters" ADD "pendingEquipmentChanges" jsonb NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('characters');
    if (!table) return;
    if (table.findColumnByName('pendingEquipmentChanges')) {
      await queryRunner.query(
        'ALTER TABLE "characters" DROP COLUMN "pendingEquipmentChanges"',
      );
    }
  }
}
