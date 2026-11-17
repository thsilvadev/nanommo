import { MigrationInterface, QueryRunner } from 'typeorm';

export class CharacterMapArrival1800700000000 implements MigrationInterface {
  name = 'CharacterMapArrival1800700000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE characters ADD COLUMN "mapEnteredAt" timestamptz NOT NULL DEFAULT statement_timestamp();
      ALTER TABLE characters ALTER COLUMN "mapEnteredAt" SET DEFAULT clock_timestamp();
      CREATE FUNCTION record_character_map_arrival() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        NEW."mapEnteredAt" := clock_timestamp();
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER character_map_arrival
      BEFORE UPDATE OF "currentMapId" ON characters
      FOR EACH ROW WHEN (OLD."currentMapId" IS DISTINCT FROM NEW."currentMapId")
      EXECUTE FUNCTION record_character_map_arrival();
    `);
  }

  async down(): Promise<void> {
    throw new Error('Character map arrival migration is forward-only');
  }
}
