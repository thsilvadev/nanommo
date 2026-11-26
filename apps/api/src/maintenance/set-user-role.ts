/**
 * Grants or revokes GM on the account that owns a character (needs migration
 * 1800800000000-UserRole). Run from the backend image:
 *
 *   docker compose run --rm --entrypoint node backend src/maintenance/set-user-role.js <characterName> <gm|player>
 */
import { AppDataSource } from '../database/data-source';

const ROLES = ['player', 'gm'] as const;

async function main(): Promise<void> {
  const [characterName, role] = process.argv.slice(2);
  if (!characterName || !ROLES.includes(role as (typeof ROLES)[number])) {
    throw new Error('Usage: set-user-role <characterName> <gm|player>');
  }
  await AppDataSource.initialize();
  try {
    const rows: Array<{ id: string; email: string }> = await AppDataSource.query(
      `UPDATE users SET "role" = $2 WHERE id IN (SELECT "userId" FROM characters WHERE name = $1) RETURNING id, email`,
      [characterName, role],
    );
    if (!rows.length) throw new Error(`No account owns a character named ${characterName}`);
    console.log(`Account ${rows[0].id} (owner of ${characterName}) is now ${role}.`);
  } finally {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('[set-user-role] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
