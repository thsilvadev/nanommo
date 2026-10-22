import { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable Global chat history. Journal/transient channels deliberately remain Redis-only. */
export class GlobalChatIdleJournal1799700000000 implements MigrationInterface {
  name = 'GlobalChatIdleJournal1799700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "global_chat_messages" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "sender_character_id" uuid NULL,
      "sender_name_snapshot" character varying(16) NOT NULL,
      "message" character varying(200) NOT NULL,
      "sent_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "FK_global_chat_messages_sender" FOREIGN KEY ("sender_character_id")
        REFERENCES "characters"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_global_chat_messages_sent_at" ON "global_chat_messages" ("sent_at" DESC, "id" DESC)`);
  }

  public async down(): Promise<void> {
    throw new Error('GlobalChatIdleJournal is forward-only; retained player messages must not be discarded during rollout.');
  }
}
