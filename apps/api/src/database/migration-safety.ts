import type { DataSource } from 'typeorm';

export interface MigrationHistoryState {
  pendingMigrationNames: string[];
  executedMigrationNames: string[];
  migrationTableExists: boolean;
  appliedMigrationCount: number;
  applicationTablesExist: boolean;
}

/**
 * Pure read-only inspection. Do NOT use DataSource.showMigrations() here:
 * TypeORM's implementation creates the migrations table when it is missing.
 */
export async function inspectMigrationHistory(dataSource: DataSource): Promise<MigrationHistoryState> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    const tableName = String((dataSource.options as any).migrationsTableName ?? 'migrations');
    const migrationTableExists = await queryRunner.hasTable(tableName);
    const executedMigrationNames: string[] = migrationTableExists
      ? (await queryRunner.query(`SELECT "name" FROM "${tableName.replace(/"/g, '""')}"`)).map((row: any) => String(row.name))
      : [];
    const executed = new Set(executedMigrationNames);
    const registeredMigrationNames = dataSource.migrations.map(migration => String(migration.name)).filter(Boolean);
    const pendingMigrationNames = registeredMigrationNames.filter(name => !executed.has(name));
    const tableNames = (await queryRunner.getTables()).map(table => table.name);
    const applicationTablesExist = tableNames.some(name =>
      ['users', 'characters', 'inventory_items', 'battle_queue_entries'].includes(name),
    );
    return {
      pendingMigrationNames,
      executedMigrationNames,
      migrationTableExists,
      appliedMigrationCount: executedMigrationNames.length,
      applicationTablesExist,
    };
  } finally {
    await queryRunner.release();
  }
}

/** Refuse mass replay of legacy migrations against a pre-existing, untracked schema. */
export function assertSafeMigrationHistory(state: MigrationHistoryState): void {
  if (state.pendingMigrationNames.length === 0) return;
  // A truly fresh schema (no application tables and no applied rows) may run the
  // full initial migration chain. Existing app tables without a tracked baseline,
  // or a nonempty migration history without its application schema, are ambiguous.
  if (!state.applicationTablesExist && state.appliedMigrationCount === 0) return;
  if (!state.applicationTablesExist && state.appliedMigrationCount > 0) {
    throw new Error('Migration history records applied migrations, but no recognized application tables exist. Refusing incremental migration against a missing schema. Audit database identity/schema before retrying. No migration was run.');
  }
  if (!state.migrationTableExists || state.appliedMigrationCount === 0) {
    const schemaState = state.applicationTablesExist
      ? 'application tables already exist'
      : 'no previously recorded migration baseline exists';
    throw new Error(
      `Migration history is missing/empty while ${state.pendingMigrationNames.length} migration(s) are pending (${schemaState}). Refusing to replay the full historical migration chain automatically. Audit the live schema, identify and record the correct baseline through a separately reviewed procedure, then retry. No migration was run.`,
    );
  }
}
