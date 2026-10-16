import { Logger } from '@nestjs/common';
import { AppDataSource } from '../database/data-source';
import { selectAuditedBaselinePrefix } from '../database/migration-baseline';

/**
 * Explicit operator-only repair for legacy databases whose schema predates/escaped
 * TypeORM's migration history. Never choose this boundary by guesswork. An operator
 * must compare the live schema/data with every migration through the selected row.
 */
async function main(): Promise<void> {
  if (process.env.BATTLE_QUEUE_MAINTENANCE_ONLY !== 'true' || process.env.CONFIRM_QUEUE_CONSUMERS_STOPPED !== '1' || process.env.CONFIRM_LIVE_SCHEMA_AUDITED !== '1') {
    throw new Error('Refusing migration baseline write. Stop every API/Bull consumer and set BATTLE_QUEUE_MAINTENANCE_ONLY=true, CONFIRM_QUEUE_CONSUMERS_STOPPED=1, and CONFIRM_LIVE_SCHEMA_AUDITED=1 only after manually auditing the live schema against each migration.');
  }
  const boundary = String(process.env.MIGRATION_BASELINE_THROUGH ?? '').trim();
  if (!boundary) throw new Error('Set MIGRATION_BASELINE_THROUGH to the exact highest legacy migration whose effects were independently verified in the live schema.');

  await AppDataSource.initialize();
  try {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      const historyName = String((AppDataSource.options as any).migrationsTableName ?? 'migrations');
      const historyExists = await queryRunner.hasTable(historyName);
      if (historyExists) {
        const existing = await queryRunner.query(`SELECT "name" FROM "${historyName.replace(/"/g, '""')}"`);
        if (existing.length > 0) throw new Error(`Migration history is not empty (${existing.length} row(s)); do not overwrite an existing baseline.`);
      }
      const tables = (await queryRunner.getTables()).map(table => table.name);
      if (!['characters','users','inventory_items','battle_queue_entries'].some(name => tables.includes(name))) {
        throw new Error('No recognized application schema tables were found; this baseline repair is only for an existing schema, not fresh database installation.');
      }
      const prefix = selectAuditedBaselinePrefix(AppDataSource.migrations.map(migration => String(migration.name)), boundary);
      const names = AppDataSource.migrations.map(migration => String(migration.name));
      if (prefix.some(migration => !names.includes(migration.name))) throw new Error('Selected migration prefix does not match TypeORM-registered names.');

      // Only after all read-only guards pass does this command create/write the
      // migration-history table. Both DDL and prefix inserts commit atomically.
      await queryRunner.startTransaction();
      try {
        if (!historyExists) {
          await queryRunner.query(`CREATE TABLE "${historyName.replace(/"/g, '""')}" ("id" SERIAL NOT NULL, "timestamp" bigint NOT NULL, "name" character varying NOT NULL, CONSTRAINT "PK_${historyName}_id" PRIMARY KEY ("id"))`);
        }
        for (const migration of prefix) {
          await queryRunner.query(`INSERT INTO "${historyName.replace(/"/g, '""')}" ("timestamp", "name") VALUES ($1, $2)`, [migration.timestamp, migration.name]);
        }
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      }
      new Logger('AuditedMigrationBaseline').warn(
        `Recorded ${prefix.length} explicitly audited legacy migration row(s) through ${boundary}. Application data was not changed. Review output and then run db:migration:show before deciding whether pending migrations may run.`,
      );
    } finally {
      await queryRunner.release();
    }
  } finally {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

main().catch(error => {
  console.error('[AuditedMigrationBaseline] FAILED CLOSED:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
