import { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable discovery acknowledgements and browser push subscriptions. */
export class GameNotifications1800200000000 implements MigrationInterface {
  name = 'GameNotifications1800200000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "notification_state" jsonb NOT NULL DEFAULT '{"acknowledged":[],"pendingPush":null}'::jsonb`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "push_subscriptions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "characterId" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
        "endpoint" text NOT NULL,
        "p256dh" text NOT NULL,
        "auth" text NOT NULL,
        "locale" varchar(8) NOT NULL DEFAULT 'en-US',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_push_subscriptions_endpoint_unique" ON "push_subscriptions" ("endpoint")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_push_subscriptions_characterId" ON "push_subscriptions" ("characterId")`);
  }
  async down(): Promise<void> {
    throw new Error('GameNotifications is forward-only; notification acknowledgements and push subscriptions must not be discarded.');
  }
}
