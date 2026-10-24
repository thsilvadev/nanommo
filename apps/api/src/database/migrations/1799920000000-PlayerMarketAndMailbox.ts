import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive mail/market schema for sell-only Market and Town Mailbox. Never executed during implementation. */
export class PlayerMarketAndMailbox1799920000000 implements MigrationInterface {
  name = 'PlayerMarketAndMailbox1799920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "senderCharacterId" uuid NULL`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "senderName" varchar(16) NOT NULL DEFAULT 'Auction House'`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "recipientName" varchar(16) NOT NULL DEFAULT ''`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "attachedGold" bigint NULL`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "body" text NOT NULL DEFAULT ''`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "isRead" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "attachmentsCollected" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "senderDeleted" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "recipientDeleted" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "sourceKey" varchar NULL`);
    await queryRunner.query(`UPDATE "mail_messages" SET "recipientName" = COALESCE((SELECT c."name" FROM "characters" c WHERE c."id" = "mail_messages"."recipientCharacterId"), '') WHERE "recipientName" = ''`);
    await queryRunner.query(`UPDATE "mail_messages" SET "isRead" = COALESCE("collected", false), "attachmentsCollected" = ("itemId" IS NULL AND "attachedGold" IS NULL) WHERE "isRead" = false AND "attachmentsCollected" = false`);
    await queryRunner.query(`ALTER TABLE "mail_messages" ADD CONSTRAINT "FK_mail_messages_senderCharacterId" FOREIGN KEY ("senderCharacterId") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_mail_messages_senderCharacterId" ON "mail_messages" ("senderCharacterId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_mail_messages_sourceKey_unique" ON "mail_messages" ("sourceKey")`);
    await queryRunner.query(`ALTER TABLE "market_orders" ADD COLUMN IF NOT EXISTS "listingFeeGold" integer NOT NULL DEFAULT 0`);
  }

  public async down(): Promise<void> {
    throw new Error('PlayerMarketAndMailbox is forward-only; mail assets and market fee audit data must not be discarded.');
  }
}
