import { Logger } from '@nestjs/common';
import { AppDataSource } from '../database/data-source';
import { inspectMigrationHistory } from '../database/migration-safety';

/** Read-only migration audit; unlike TypeORM CLI showMigrations(), this never creates tables. */
async function main(): Promise<void> {
  const logger = new Logger('ReadOnlyMigrationAudit');
  await AppDataSource.initialize();
  try {
    const state = await inspectMigrationHistory(AppDataSource);
    logger.log(`Migration tracking table exists: ${state.migrationTableExists}`);
    logger.log(`Applied migration rows: ${state.appliedMigrationCount}`);
    logger.log(`Known application tables exist: ${state.applicationTablesExist}`);
    logger.log(`Applied (${state.executedMigrationNames.length}): ${state.executedMigrationNames.join(', ') || '(none recorded)'}`);
    logger.log(`Pending (${state.pendingMigrationNames.length}): ${state.pendingMigrationNames.join(', ') || '(none)'}`);
    if (state.pendingMigrationNames.length) {
      if (!state.applicationTablesExist && state.appliedMigrationCount === 0) {
        logger.warn('This appears to be a fresh database with no application schema; all migrations are pending and the guarded db:migrate command may initialize it.');
      } else if (!state.applicationTablesExist || !state.migrationTableExists || state.appliedMigrationCount === 0) {
        logger.error('Migration history/schema mismatch. Audit database identity and schema before any baseline or migration; no table was created and no migration was run.');
        process.exitCode = 2;
      }
    }
  } finally {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

main().catch(error => {
  console.error('[ReadOnlyMigrationAudit] FAILED:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
