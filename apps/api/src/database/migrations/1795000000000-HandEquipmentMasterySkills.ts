import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Explicitly resets legacy proficiency/Gambit progression while preserving
 * character identity, equipment, inventory, currency and unrelated state.
 */
export class HandEquipmentMasterySkills1795000000000 implements MigrationInterface {
  name = 'HandEquipmentMasterySkills1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS "dominantHand" varchar(5) NOT NULL DEFAULT 'right'`);
    await queryRunner.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS "knownItemIds" jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await queryRunner.query(`ALTER TABLE weapon_proficiencies ALTER COLUMN "weaponType" TYPE varchar(16) USING "weaponType"::text`);
    await queryRunner.query(`ALTER TABLE weapon_proficiencies ADD COLUMN IF NOT EXISTS "spentSkillPoints" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE weapon_proficiencies ADD COLUMN IF NOT EXISTS "skillRanks" jsonb NOT NULL DEFAULT '{}'::jsonb`);

    // Preserve every existing category row, its identity, XP and level. The
    // legacy wand category is renamed to rod; new categories are added only for
    // characters that do not already have them. The separate refinement
    // migration clears allocated ranks/points without resetting progression.
    await queryRunner.query(`UPDATE weapon_proficiencies SET "weaponType" = 'rod' WHERE "weaponType" = 'wand'`);
    await queryRunner.query(`
      INSERT INTO weapon_proficiencies (id, "characterId", "weaponType", level, xp, "spentSkillPoints", "skillRanks")
      SELECT gen_random_uuid(), c.id, category, 0, 0, 0, '{}'::jsonb
      FROM characters c
      CROSS JOIN unnest(ARRAY['sword','greatsword','dagger','bow','staff','rod','shield','rune']::varchar[]) category
      WHERE NOT EXISTS (
        SELECT 1 FROM weapon_proficiencies wp
        WHERE wp."characterId" = c.id AND wp."weaponType" = category
      )
    `);

    await queryRunner.query(`
      UPDATE characters
      SET "knownItemIds" = '["pot_hp_small","pot_hp_medium","pot_hp_large","pot_sp_small","pot_sp_medium","pot_sp_large","antidote"]'::jsonb
      WHERE "knownItemIds" IS NULL OR "knownItemIds" = '[]'::jsonb
    `);

    // Keep the three page rows and page IDs. The first receives the canonical
    // starter behavior; all later pages are empty.
    await queryRunner.query(`
      UPDATE gambit_pages
      SET lines = CASE WHEN "slotIndex" = 0 THEN
        '[{"priority":1,"conditions":[{"id":"self_hp_below_percent","params":{"value":30}}],"action":{"id":"use_item","params":{"itemId":"pot_hp_small"}},"enabled":true},{"priority":2,"conditions":[{"id":"always"}],"action":{"id":"attack"},"enabled":true}]'::jsonb
        ELSE '[]'::jsonb END
    `);
    await queryRunner.query(`
      UPDATE characters c SET "activeGambitPageId" = gp.id
      FROM gambit_pages gp WHERE gp."characterId" = c.id AND gp."slotIndex" = 0
    `);

    // Rename the former Wand domain ID in every persisted JSON/text reference.
    // Explicit row updates preserve quantities, IDs and instance metadata.
    for (const table of ['inventory_items', 'equipped_items', 'mail_messages', 'market_orders', 'market_deals']) {
      const exists = await queryRunner.hasTable(table);
      if (!exists) continue;
      const instanceColumn = table === 'inventory_items' || table === 'equipped_items' ? 'instanceData' : 'itemInstanceData';
      const itemSql = "UPDATE \"" + table + "\" SET \"itemId\" = replace(\"itemId\", 'wand', 'rod') WHERE \"itemId\" LIKE '%wand%'";
      await queryRunner.query(itemSql);
      // Inventory/equipment use instanceData; Mail/Market use itemInstanceData.
      if (await queryRunner.hasColumn(table, instanceColumn)) {
        const instanceSql = "UPDATE \"" + table + "\" SET \"" + instanceColumn + "\" = replace(\"" + instanceColumn + "\"::text, 'wand', 'rod')::jsonb WHERE \"" + instanceColumn + "\"::text LIKE '%wand%'";
        await queryRunner.query(instanceSql);
      }
    }
    await queryRunner.query(`UPDATE gambit_pages SET lines = replace(lines::text, 'wand', 'rod')::jsonb WHERE lines::text LIKE '%wand%'`);
    await queryRunner.query(`UPDATE characters SET "pendingEquipmentChanges" = replace("pendingEquipmentChanges"::text, 'wand', 'rod')::jsonb WHERE "pendingEquipmentChanges"::text LIKE '%wand%'`);
  }

  public async down(): Promise<void> {
    // Progress reset and Gambit cleanup are intentionally not reversed: the
    // removed legacy ranks/actions cannot be reconstructed without a backup.
    throw new Error('HandEquipmentMasterySkills migration is intentionally irreversible');
  }
}
