import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Forward-only reconciliation of the stored Mastery level projection.
 * Preserves XP, allocated skill ranks, spent points, row IDs and Character state.
 * Do not reverse after gameplay resumes: doing so could lower levels without
 * reconciling ranks/points that players have already allocated.
 */
export class ReconcileMasteryLevelsForCumulativeXp1799100000000 implements MigrationInterface {
  name = 'ReconcileMasteryLevelsForCumulativeXp1799100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "weapon_proficiencies"
      SET "level" = CASE
        WHEN GREATEST(0, "xp") >= 60000 THEN 10
        WHEN GREATEST(0, "xp") >= 45000 THEN 9
        WHEN GREATEST(0, "xp") >= 35000 THEN 8
        WHEN GREATEST(0, "xp") >= 20000 THEN 7
        WHEN GREATEST(0, "xp") >= 500 THEN 6
        WHEN GREATEST(0, "xp") >= 100 THEN 5
        WHEN GREATEST(0, "xp") >= 50 THEN 4
        WHEN GREATEST(0, "xp") >= 25 THEN 3
        WHEN GREATEST(0, "xp") >= 10 THEN 2
        WHEN GREATEST(0, "xp") >= 5 THEN 1
        ELSE 0
      END
      WHERE "level" IS DISTINCT FROM CASE
        WHEN GREATEST(0, "xp") >= 60000 THEN 10
        WHEN GREATEST(0, "xp") >= 45000 THEN 9
        WHEN GREATEST(0, "xp") >= 35000 THEN 8
        WHEN GREATEST(0, "xp") >= 20000 THEN 7
        WHEN GREATEST(0, "xp") >= 500 THEN 6
        WHEN GREATEST(0, "xp") >= 100 THEN 5
        WHEN GREATEST(0, "xp") >= 50 THEN 4
        WHEN GREATEST(0, "xp") >= 25 THEN 3
        WHEN GREATEST(0, "xp") >= 10 THEN 2
        WHEN GREATEST(0, "xp") >= 5 THEN 1
        ELSE 0
      END
    `);
  }

  public async down(): Promise<void> {
    throw new Error('ReconcileMasteryLevelsForCumulativeXp is forward-only; do not lower Mastery levels after gameplay resumes.');
  }
}
