import { MigrationInterface, QueryRunner } from 'typeorm';

/** Preserve the original wall-clock interpretation for historical rows; new encounters use 500 ms. */
export class BattleTickDuration1800300000000 implements MigrationInterface {
  name = 'BattleTickDuration1800300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "battle_queue_entries" ADD COLUMN IF NOT EXISTS "tickDurationMs" integer`);
    // Existing battle logs were authored at one tick per second. Mark those rows
    // explicitly before applying the 500 ms default for newly created encounters.
    await queryRunner.query(`UPDATE "battle_queue_entries" SET "tickDurationMs" = 1000 WHERE "tickDurationMs" IS NULL`);
    await queryRunner.query(`ALTER TABLE "battle_queue_entries" ALTER COLUMN "tickDurationMs" SET DEFAULT 500`);
    await queryRunner.query(`ALTER TABLE "battle_queue_entries" ALTER COLUMN "tickDurationMs" SET NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Downgrade is schema-reversible. Before deploying the old one-second code,
    // operators must first run the targeted cutover and remove all 500 ms queue rows.
    await queryRunner.query(`ALTER TABLE "battle_queue_entries" DROP COLUMN IF EXISTS "tickDurationMs"`);
  }
}
