import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountDeletionCascades1770000000000 implements MigrationInterface {
  name = 'AccountDeletionCascades1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'characters',
      'inventory_items',
      'equipped_items',
      'weapon_proficiencies',
      'gambit_pages',
      'map_kill_counters',
      'battle_queue_entries',
      'market_orders',
      'market_deals',
      'mail_messages',
      'chat_reports',
    ];

    for (const tableName of tables) {
      const table = await queryRunner.getTable(tableName);
      if (!table) continue;

      const foreignKeys = table.foreignKeys.filter(
        (fk) => fk.referencedTableName === 'users' || fk.referencedTableName === 'characters',
      );

      for (const foreignKey of foreignKeys) {
        await queryRunner.query(
          'ALTER TABLE "' + tableName + '" DROP CONSTRAINT "' + foreignKey.name + '"',
        );

        const columns = foreignKey.columnNames.map((column) => '"' + column.replaceAll('"', '""') + '"').join(', ');
        const referencedColumns = foreignKey.referencedColumnNames
          .map((column) => '"' + column.replaceAll('"', '""') + '"')
          .join(', ');

        await queryRunner.query(
          'ALTER TABLE "' + tableName + '" ADD CONSTRAINT "' + foreignKey.name +
          '" FOREIGN KEY (' + columns + ') REFERENCES "' + foreignKey.referencedTableName +
          '" (' + referencedColumns + ') ON DELETE CASCADE',
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cascade behavior is intentionally retained for account-owned data.
  }
}
