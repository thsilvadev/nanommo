import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountDeletionCascades1770000000000 implements MigrationInterface {
  name = 'AccountDeletionCascades1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const constraints = [
      ['characters', 'userId'],
      ['inventory_items', 'characterId'],
      ['equipped_items', 'characterId'],
      ['weapon_proficiencies', 'characterId'],
      ['gambit_pages', 'characterId'],
      ['map_kill_counters', 'characterId'],
      ['battle_queue_entries', 'characterId'],
      ['market_orders', 'characterId'],
      ['market_deals', 'buyerCharacterId'],
      ['market_deals', 'sellerCharacterId'],
      ['mail_messages', 'recipientCharacterId'],
      ['chat_reports', 'reporterUserId'],
      ['chat_reports', 'reportedUserId'],
    ];

    for (const [tableName, columnName] of constraints) {
      const rows: Array<{ constraint_name: string }> = await queryRunner.query(
        `SELECT tc.constraint_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_name = $1
            AND kcu.column_name = $2`,
        [tableName, columnName],
      );

      for (const row of rows) {
        await queryRunner.query(`ALTER TABLE "${tableName}" DROP CONSTRAINT "${row.constraint_name}"`);
        await queryRunner.query(
          `ALTER TABLE "${tableName}" ADD CONSTRAINT "${row.constraint_name}" FOREIGN KEY ("${columnName}") REFERENCES "${tableName === 'characters' || tableName === 'chat_reports' ? (tableName === 'characters' ? 'users' : 'users') : 'characters'}"("id") ON DELETE CASCADE`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cascade behavior is intentionally retained for account-owned data.
  }
}
