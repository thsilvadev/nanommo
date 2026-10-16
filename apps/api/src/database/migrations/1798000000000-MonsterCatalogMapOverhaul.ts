import { MigrationInterface, QueryRunner } from 'typeorm';

export class MonsterCatalogMapOverhaul1798000000000 implements MigrationInterface {
  name = 'MonsterCatalogMapOverhaul1798000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasSor = await queryRunner.hasColumn('characters', 'sor');
    const hasLuk = await queryRunner.hasColumn('characters', 'luk');
    if (hasSor && !hasLuk) {
      await queryRunner.query('ALTER TABLE "characters" RENAME COLUMN "sor" TO "luk"');
    } else if (hasSor && hasLuk) {
      await queryRunner.query('UPDATE "characters" SET "luk" = "sor" WHERE "luk" = 5 AND "sor" <> 5');
      await queryRunner.query('ALTER TABLE "characters" DROP COLUMN "sor"');
    } else if (!hasLuk) {
      await queryRunner.query('ALTER TABLE "characters" ADD COLUMN "luk" integer NOT NULL DEFAULT 5');
    }
    // Rename persisted equipment bonus keys without changing any numeric value.
    await queryRunner.query(`UPDATE "inventory_items" SET "instanceData" = jsonb_set("instanceData", '{statBonus,LUK}', "instanceData"->'statBonus'->'SOR', true) #- '{statBonus,SOR}' WHERE "instanceData" #> '{statBonus,SOR}' IS NOT NULL`);
    if (await queryRunner.hasTable('equipped_items')) await queryRunner.query(`UPDATE "equipped_items" SET "instanceData" = jsonb_set("instanceData", '{statBonus,LUK}', "instanceData"->'statBonus'->'SOR', true) #- '{statBonus,SOR}' WHERE "instanceData" #> '{statBonus,SOR}' IS NOT NULL`);

    await queryRunner.query(`UPDATE "inventory_items" SET "instanceData" = jsonb_set("instanceData", '{rolledAttribute}', '"LUK"'::jsonb, false) WHERE "instanceData"->>'rolledAttribute' = 'SOR'`);
    if (await queryRunner.hasTable('equipped_items')) await queryRunner.query(`UPDATE "equipped_items" SET "instanceData" = jsonb_set("instanceData", '{rolledAttribute}', '"LUK"'::jsonb, false) WHERE "instanceData"->>'rolledAttribute' = 'SOR'`);
    // Retarget legacy map IDs by character level. Historical battles/logs remain untouched.
    await queryRunner.query(`UPDATE "characters" SET "currentMapId" = CASE WHEN "currentMapId" IS NULL OR "currentMapId" = 'map_town' THEN 'map_town' WHEN "level" <= 5 THEN 'map_lv_1' WHEN "level" <= 10 THEN 'map_lv_6' WHEN "level" <= 15 THEN 'map_lv_11' WHEN "level" <= 20 THEN 'map_lv_16' WHEN "level" <= 25 THEN 'map_lv_21' ELSE 'map_lv_26' END WHERE "currentMapId" IS NULL OR "currentMapId" <> 'map_town'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasLuk = await queryRunner.hasColumn('characters', 'luk');
    const hasSor = await queryRunner.hasColumn('characters', 'sor');
    if (hasLuk && !hasSor) await queryRunner.query('ALTER TABLE "characters" RENAME COLUMN "luk" TO "sor"');
  }
}
