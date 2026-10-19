import { MigrationInterface, QueryRunner } from 'typeorm';

/** Forward-only reconciliation for the smoothed cumulative Mastery XP thresholds. */
export class SmoothMasteryXpThresholds1799300000000 implements MigrationInterface {
  name = 'SmoothMasteryXpThresholds1799300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "weapon_proficiencies"
      SET "level" = CASE
        WHEN GREATEST(0, "xp") >= 20000 THEN 10
        WHEN GREATEST(0, "xp") >= 10000 THEN 9
        WHEN GREATEST(0, "xp") >= 4500 THEN 8
        WHEN GREATEST(0, "xp") >= 1800 THEN 7
        WHEN GREATEST(0, "xp") >= 600 THEN 6
        WHEN GREATEST(0, "xp") >= 300 THEN 5
        WHEN GREATEST(0, "xp") >= 100 THEN 4
        WHEN GREATEST(0, "xp") >= 40 THEN 3
        WHEN GREATEST(0, "xp") >= 15 THEN 2
        WHEN GREATEST(0, "xp") >= 5 THEN 1
        ELSE 0
      END
      WHERE "level" IS DISTINCT FROM CASE
        WHEN GREATEST(0, "xp") >= 20000 THEN 10
        WHEN GREATEST(0, "xp") >= 10000 THEN 9
        WHEN GREATEST(0, "xp") >= 4500 THEN 8
        WHEN GREATEST(0, "xp") >= 1800 THEN 7
        WHEN GREATEST(0, "xp") >= 600 THEN 6
        WHEN GREATEST(0, "xp") >= 300 THEN 5
        WHEN GREATEST(0, "xp") >= 100 THEN 4
        WHEN GREATEST(0, "xp") >= 40 THEN 3
        WHEN GREATEST(0, "xp") >= 15 THEN 2
        WHEN GREATEST(0, "xp") >= 5 THEN 1
        ELSE 0
      END
    `);
  }

  public async down(): Promise<void> {
    throw new Error('SmoothMasteryXpThresholds is forward-only; do not lower Mastery levels after gameplay resumes.');
  }
}
