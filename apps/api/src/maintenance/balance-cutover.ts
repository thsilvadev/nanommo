/** Read-only by default. Run under the deployment maintenance window with workers stopped. */
import { AppDataSource } from '../database/data-source';
import { professionLevelForXp } from '@nanommo/shared';
import { sessionRecipeMatches } from '../modules/town/recipe-version';
import * as fs from 'fs';
import * as path from 'path';

export function planBalanceCutover(character: any, catalogs: Record<string, any>) {
  const patch: any = {};
  for (const profession of ['cooking', 'alchemy', 'blacksmith']) {
    const levelKey = profession + '_level', xpKey = profession + '_xp';
    const level = Math.max(Number(character[levelKey] ?? 1), professionLevelForXp(Number(character[xpKey] ?? 0)));
    if (level !== Number(character[levelKey] ?? 1)) patch[levelKey] = level;
  }
  for (const field of ['cooking_session', 'crafting_session']) {
    const session = character[field];
    if (!session) continue;
    const profession = field === 'cooking_session' ? 'cooking' : session.profession;
    const recipe = catalogs[profession]?.recipes?.find((recipe: any) => recipe.id === session.recipeId);
    if (!sessionRecipeMatches(session, recipe, profession)) patch[field] = null;
  }
  return patch;
}

async function main() {
  const catalogs = Object.fromEntries(['cooking', 'alchemy', 'blacksmith'].map(profession => [profession, JSON.parse(fs.readFileSync(path.resolve(process.cwd(), profession + '_recipes.json'), 'utf8'))]));
  const apply = process.argv.includes('--apply');
  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(async manager => {
      // No output/items are deleted or moved. Reservations are embedded in these session fields.
      const rows = await manager.query('SELECT id,cooking_level,cooking_xp,alchemy_level,alchemy_xp,blacksmith_level,blacksmith_xp,cooking_session,crafting_session FROM characters' + (apply ? ' FOR UPDATE' : ''));
      const affected = rows.map((row: any) => ({ id: row.id, patch: planBalanceCutover(row, catalogs), before: row })).filter((row: any) => Object.keys(row.patch).length);
      console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scanned: rows.length, affected: affected.length,
        cancelledCooking: affected.filter((row: any) => 'cooking_session' in row.patch).length,
        cancelledCrafting: affected.filter((row: any) => 'crafting_session' in row.patch).length }));
      if (!apply) return;
      await manager.query('CREATE TABLE IF NOT EXISTS balance_cutover_20261127_backup ("characterId" uuid PRIMARY KEY, "before" jsonb NOT NULL, "appliedAt" timestamptz NOT NULL DEFAULT clock_timestamp())');
      for (const row of affected) {
        await manager.query('INSERT INTO balance_cutover_20261127_backup("characterId","before") VALUES($1,$2) ON CONFLICT DO NOTHING', [row.id, JSON.stringify(row.before)]);
        const entries = Object.entries(row.patch);
        await manager.query('UPDATE characters SET ' + entries.map(([field], i) => '"' + field + '"=$' + (i + 2)).join(',') + ' WHERE id=$1', [row.id, ...entries.map(([, value]) => value)]);
      }
    });
  } finally { await AppDataSource.destroy(); }
}
if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
