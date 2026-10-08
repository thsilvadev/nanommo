import { MigrationInterface, QueryRunner } from 'typeorm';

export class SplitRegistrationCharacterCreation1792000000000 implements MigrationInterface {
  name = 'SplitRegistrationCharacterCreation1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const users = await queryRunner.getTable('users');
    const characters = await queryRunner.getTable('characters');
    if (!users || !characters) return;

    const usernameColumn = users.findColumnByName('username');
    if (usernameColumn) {
      await queryRunner.query(`
        UPDATE characters
        SET name = users.username
        FROM users
        WHERE characters."userId" = users.id
          AND characters.name IS DISTINCT FROM users.username
      `);
    }

    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_characters_name" ON characters (name)`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "cpfHash"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS username`);

    for (const sql of [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS provider varchar NOT NULL DEFAULT 'local'`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "providerId" varchar`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastLoginAt" timestamptz`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "failedLoginCount" integer NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "lockedUntil" timestamptz`,
    ]) {
      await queryRunner.query(sql);
    }

    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS "UQ_users_email"`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_users_provider_email'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT "UQ_users_provider_email" UNIQUE (provider, email);
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS "UQ_users_provider_email"`);
    await queryRunner.query(`ALTER TABLE users ADD CONSTRAINT "UQ_users_email" UNIQUE (email)`);

    await queryRunner.query(`ALTER TABLE users DROP COLUMN "lockedUntil"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN "failedLoginCount"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN "lastLoginAt"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN "providerId"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN provider`);

    await queryRunner.query(`ALTER TABLE users ADD COLUMN username varchar(16) NOT NULL DEFAULT ''`);
    await queryRunner.query(`ALTER TABLE users ADD CONSTRAINT "UQ_users_username" UNIQUE (username)`);

    await queryRunner.query(`ALTER TABLE users ADD COLUMN "cpfHash" varchar(64) NOT NULL DEFAULT ''`);
    await queryRunner.query(`ALTER TABLE users ADD CONSTRAINT "UQ_users_cpfHash" UNIQUE ("cpfHash")`);

    await queryRunner.query(`
      UPDATE users
      SET username = characters.name
      FROM characters
      WHERE characters."userId" = users.id
        AND characters.name IS NOT NULL
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_characters_name"`);
  }
}