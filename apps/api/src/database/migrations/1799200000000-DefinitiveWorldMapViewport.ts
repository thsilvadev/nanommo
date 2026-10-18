import { MigrationInterface, QueryRunner } from 'typeorm';

/** Forward-only world location remap and per-character discovery bootstrap. */
export class DefinitiveWorldMapViewport1799200000000 implements MigrationInterface {
  name = 'DefinitiveWorldMapViewport1799200000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "discoveredMapIds" jsonb NOT NULL DEFAULT '["map_town"]'::jsonb`);
    await queryRunner.query(`UPDATE "characters" SET "currentMapId" = CASE
      WHEN "currentMapId" IS NULL OR "currentMapId" = 'map_town' THEN 'map_town'
      WHEN "level" <= 1 THEN 'map_green_grounds_0' WHEN "level" <= 5 THEN 'map_green_grounds_3'
      WHEN "level" <= 10 THEN 'map_menace_hills_0' WHEN "level" <= 20 THEN 'map_gods_bridge'
      WHEN "level" <= 30 THEN 'map_kwaioua_forest_4' WHEN "level" <= 40 THEN 'map_caete_0'
      WHEN "level" <= 50 THEN 'map_caete_1' WHEN "level" <= 60 THEN 'map_forest_ruins_0'
      ELSE 'map_forest_ruins_3' END WHERE "currentMapId" LIKE 'map_lv_%' OR "currentMapId" IS NULL`);
    await queryRunner.query(`UPDATE "characters" c SET "discoveredMapIds" = (
      SELECT jsonb_agg(v.id) FROM (SELECT DISTINCT value AS id FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(c."discoveredMapIds")='array' THEN c."discoveredMapIds" ELSE '[]'::jsonb END
      ) UNION SELECT 'map_town' UNION SELECT c."currentMapId") v
    )`);
  }
  public async down(): Promise<void> { throw new Error('Definitive world map migration is forward-only; do not restore legacy map IDs.'); }
}
