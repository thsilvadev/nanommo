import { MigrationInterface, QueryRunner } from 'typeorm';

/** One-time respec for the refined Mastery tree; XP and levels are intentionally preserved. */
export class ResetExistingMasterySkillRanks1796000000000 implements MigrationInterface {
  name = 'ResetExistingMasterySkillRanks1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE weapon_proficiencies SET "skillRanks" = '{}'::jsonb, "spentSkillPoints" = 0`);
  }

  public async down(): Promise<void> {
    throw new Error('Mastery allocation reset is intentionally irreversible');
  }
}
