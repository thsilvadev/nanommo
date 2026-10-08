import { MigrationInterface, QueryRunner } from 'typeorm';

export class CharacterStateVersion1790877000000 implements MigrationInterface {
  name = 'CharacterStateVersion1790877000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('characters');
    if (!table) return;
    if (!table.findColumnByName('stateVersion')) {
      await queryRunner.query(
        'ALTER TABLE "characters" ADD "stateVersion" integer NOT NULL DEFAULT 1',
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "characters" DROP COLUMN "stateVersion"',
    );
  }
}
