import { MigrationInterface, QueryRunner } from 'typeorm';

/** Persistent data-driven quests. Forward-only; never executed as part of implementation. */
export class QuestStandardization1799930000000 implements MigrationInterface {
  name = 'QuestStandardization1799930000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "questOfferProgress" jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "quest_instances" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "characterId" uuid NOT NULL, "questId" varchar NOT NULL, "status" varchar(16) NOT NULL DEFAULT 'active', "progress" jsonb NOT NULL DEFAULT '{}'::jsonb, "acceptedAt" timestamptz NOT NULL, "expiresAt" timestamptz NULL, "completedAt" timestamptz NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_quest_instances_id" PRIMARY KEY ("id"), CONSTRAINT "FK_quest_instances_characterId" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_quest_instances_character_status" ON "quest_instances" ("characterId", "status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_quest_instances_character_quest" ON "quest_instances" ("characterId", "questId")`);
  }
  public async down(): Promise<void> { throw new Error('QuestStandardization is forward-only; quest history and provenance must not be discarded.'); }
}
