import { MigrationInterface, QueryRunner } from 'typeorm';

export class TownAsMapAndGenericTransition1794000000000 implements MigrationInterface {
  name = 'TownAsMapAndGenericTransition1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('characters');
    if (!table) return;

    if (!table.findColumnByName('pendingMapTransition')) {
      await queryRunner.query('ALTER TABLE "characters" ADD "pendingMapTransition" jsonb NULL');
    }

    const hasLegacy = !!table.findColumnByName('returnToTownAfterBattle');
    if (hasLegacy) {
      await queryRunner.query(
        `UPDATE "characters"
         SET "pendingMapTransition" = '{"destinationMapId":"map_town","reason":"town_request"}'::jsonb
         WHERE "returnToTownAfterBattle" = true`,
      );
    }

    await queryRunner.query('UPDATE "characters" SET "currentMapId" = \'map_town\' WHERE "currentMapId" IS NULL');
    await queryRunner.query('ALTER TABLE "characters" ALTER COLUMN "currentMapId" SET DEFAULT \'map_town\'');
    await queryRunner.query('ALTER TABLE "characters" ALTER COLUMN "currentMapId" SET NOT NULL');

    if (hasLegacy) {
      await queryRunner.query('ALTER TABLE "characters" DROP COLUMN "returnToTownAfterBattle"');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('characters');
    if (!table) return;

    if (!table.findColumnByName('returnToTownAfterBattle')) {
      await queryRunner.query('ALTER TABLE "characters" ADD "returnToTownAfterBattle" boolean NOT NULL DEFAULT false');
    }

    await queryRunner.query(
      `UPDATE "characters"
       SET "returnToTownAfterBattle" = true
       WHERE "pendingMapTransition"->>'destinationMapId' = 'map_town'`,
    );

    await queryRunner.query('ALTER TABLE "characters" ALTER COLUMN "currentMapId" DROP NOT NULL');
    await queryRunner.query('ALTER TABLE "characters" ALTER COLUMN "currentMapId" DROP DEFAULT');
    await queryRunner.query('UPDATE "characters" SET "currentMapId" = NULL WHERE "currentMapId" = \'map_town\'');

    if (table.findColumnByName('pendingMapTransition')) {
      await queryRunner.query('ALTER TABLE "characters" DROP COLUMN "pendingMapTransition"');
    }
  }
}
