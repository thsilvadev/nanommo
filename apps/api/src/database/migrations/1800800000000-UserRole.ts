import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Account role for GM commands ('player' | 'gm'). The owner of the character
 * `thiagosauro` becomes the first GM; later ones go through
 * maintenance/set-user-role.
 */
export class UserRole1800800000000 implements MigrationInterface {
  name = 'UserRole1800800000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE users ADD COLUMN "role" varchar(16) NOT NULL DEFAULT 'player';
      ALTER TABLE users ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('player', 'gm'));
      UPDATE users SET "role" = 'gm' WHERE id IN (SELECT "userId" FROM characters WHERE lower(name) = 'thiagosauro');
    `);
  }

  async down(): Promise<void> {
    throw new Error('User role migration is forward-only');
  }
}
