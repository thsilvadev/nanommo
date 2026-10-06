import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class GoogleOAuth1793000000000 implements MigrationInterface {
  name = 'GoogleOAuth1793000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn('users', 'passwordHash', new TableColumn({
      name: 'passwordHash', type: 'varchar', isNullable: true,
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE users SET "passwordHash" = 'oauth-account' WHERE "passwordHash" IS NULL`);
    await queryRunner.changeColumn('users', 'passwordHash', new TableColumn({
      name: 'passwordHash', type: 'varchar', isNullable: false,
    }));
  }
}
