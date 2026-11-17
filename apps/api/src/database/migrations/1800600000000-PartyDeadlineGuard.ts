import { MigrationInterface, QueryRunner } from 'typeorm';

export class PartyDeadlineGuard1800600000000 implements MigrationInterface {
  name = 'PartyDeadlineGuard1800600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE party_deadline_checks (
        transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
        due_at timestamptz NOT NULL,
        PRIMARY KEY (transaction_id, due_at)
      );

      CREATE FUNCTION check_party_deadline_at_commit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM party_deadline_checks
        WHERE transaction_id = NEW.transaction_id AND due_at = NEW.due_at;

        IF clock_timestamp() + interval '50 milliseconds' >= NEW.due_at THEN
          RAISE EXCEPTION 'Encounter deadline reached before commit' USING ERRCODE = 'P7501';
        END IF;
        RETURN NULL;
      END;
      $$;

      CREATE CONSTRAINT TRIGGER party_deadline_at_commit
      AFTER INSERT ON party_deadline_checks
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION check_party_deadline_at_commit();
    `);
  }

  async down(): Promise<void> {
    throw new Error('Party deadline guard is forward-only');
  }
}
