import { MigrationInterface, QueryRunner } from 'typeorm';

/** Persists off-battle resource-regeneration progress and consumable cooldown deadlines. Forward-only. */
export class OffBattleResourcesAndConsumableCooldowns1799910000000 implements MigrationInterface {
  name = 'OffBattleResourcesAndConsumableCooldowns1799910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "resourceRegenAt" timestamptz NULL`);
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "consumableCooldowns" jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await queryRunner.query(`UPDATE "characters" SET "resourceRegenAt" = COALESCE("resourceRegenAt", "lastSeenAt", "regenAnchorAt", "createdAt", NOW()) WHERE "resourceRegenAt" IS NULL`);
    await queryRunner.query(`UPDATE "characters" SET "consumableCooldowns" = '{}'::jsonb WHERE "consumableCooldowns" IS NULL`);
  }

  public async down(): Promise<void> {
    throw new Error('OffBattleResourcesAndConsumableCooldowns is forward-only; resource and cooldown state must not be discarded.');
  }
}
