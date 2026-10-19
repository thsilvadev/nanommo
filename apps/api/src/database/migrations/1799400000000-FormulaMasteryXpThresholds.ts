import { MigrationInterface, QueryRunner } from 'typeorm';

/** Reconcile stored Mastery levels with the formula-based cumulative XP thresholds. */
export class FormulaMasteryXpThresholds1799400000000 implements MigrationInterface {
  name = 'FormulaMasteryXpThresholds1799400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Required XP per level: 50, 150, 300, 525, 862, 1368 ...
    // Cumulative XP thresholds are 50, 200, 500, 1025, 1887, 3255 ...
    await queryRunner.query(`
      WITH RECURSIVE mastery_thresholds(level, required_xp, cumulative_xp) AS (
        SELECT 1, 50::bigint, 50::bigint
        UNION ALL
        SELECT level + 1,
               FLOOR((required_xp + 50) * 1.5)::bigint,
               cumulative_xp + FLOOR((required_xp + 50) * 1.5)::bigint
        FROM mastery_thresholds
        WHERE level < 10
      ), derived_levels AS (
        SELECT wp.id,
               COALESCE(MAX(mt.level) FILTER (WHERE GREATEST(0, wp.xp) >= mt.cumulative_xp), 0) AS derived_level
        FROM "weapon_proficiencies" wp
        LEFT JOIN mastery_thresholds mt ON TRUE
        GROUP BY wp.id, wp.xp
      )
      UPDATE "weapon_proficiencies" wp
      SET "level" = derived_levels.derived_level
      FROM derived_levels
      WHERE wp.id = derived_levels.id
        AND wp."level" IS DISTINCT FROM derived_levels.derived_level
    `);
  }

  public async down(): Promise<void> {
    throw new Error('FormulaMasteryXpThresholds is forward-only; do not lower Mastery levels after gameplay resumes.');
  }
}
