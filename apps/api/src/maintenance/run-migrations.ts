import { Logger } from '@nestjs/common';
import { AppDataSource } from '../database/data-source';
import { assertSafeMigrationHistory, inspectMigrationHistory } from '../database/migration-safety';

/** Guarded migration entry point. Every API/Bull consumer must be stopped first. */
async function main(): Promise<void> {
  if (process.env.BATTLE_QUEUE_MAINTENANCE_ONLY !== 'true' || process.env.CONFIRM_QUEUE_CONSUMERS_STOPPED !== '1') {
    throw new Error('Refusing migration: set BATTLE_QUEUE_MAINTENANCE_ONLY=true and CONFIRM_QUEUE_CONSUMERS_STOPPED=1 only after every API/Bull consumer has stopped.');
  }
  const logger = new Logger('GuardedMigrations');
  let initialized = false;
  try {
    await AppDataSource.initialize();
    initialized = true;
    const history = await inspectMigrationHistory(AppDataSource);
    assertSafeMigrationHistory(history);
    if (history.pendingMigrationNames.length === 0) {
      logger.log('Database migration history is current; no migrations were required.');
      return;
    }
    const applied = await AppDataSource.runMigrations({ transaction: 'each' });
    logger.log(`Applied ${applied.length} migration(s): ${applied.map(migration => migration.name).join(', ')}`);
  } finally {
    if (initialized && AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

main().catch(error => {
  console.error('[GuardedMigrations] FAILED CLOSED:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
