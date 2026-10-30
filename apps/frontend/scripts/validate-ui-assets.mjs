#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const assets = path.join(root, 'apps/frontend/assets/ui');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const itemCatalog = read('items.json');
const skillCatalog = read('skill_trees.json');
const statusCatalog = read('status_effects.json');
const missing = [];
const builtMissing = [];
const builtAssets = path.join(root, 'apps/frontend/dist/frontend/browser/assets/ui');
const checkBuilt = (relative, label) => { if (fs.existsSync(builtAssets) && !fs.existsSync(path.join(builtAssets, relative))) builtMissing.push(`${label}: /assets/ui/${relative.replaceAll(path.sep, '/')}`); };
const itemRows = [...(itemCatalog.equipment ?? []), ...(itemCatalog.consumables ?? []), ...(itemCatalog.monsterParts ?? [])];
for (const item of itemRows) {
  const folder = item.type === 'equipment' ? 'equipment' : item.type === 'monster_part' ? 'monster_parts' : 'consumables';
  for (const variant of ['svg', 'svg-noframe']) {
    const animatedMaterial = variant === 'svg-noframe' && (item.id === 'mat_bliss_stone' || item.id === 'mat_divine_shard');
    const filename = animatedMaterial ? `${item.id}_alpha.png` : `${item.id}.svg`;
    const file = path.join(assets, 'items', variant, folder, filename);
    const relative = path.join('items', variant, folder, filename);
    if (!fs.existsSync(file)) missing.push(`${item.id}: /assets/ui/${relative.replaceAll(path.sep, '/')}`);
    checkBuilt(relative, item.id);
  }
}
const skills = [...Object.values(skillCatalog.trees ?? {}).flat(), ...(skillCatalog.monsterSkills ?? [])];
for (const skill of skills) {
  const file = path.join(assets, 'skill-icons', `${skill.id}.svg`);
  if (!fs.existsSync(file)) missing.push(`${skill.id}: /assets/ui/skill-icons/${skill.id}.svg`);
  checkBuilt(path.join('skill-icons', `${skill.id}.svg`), skill.id);
}
for (const status of statusCatalog.statusEffects ?? []) {
  const file = path.join(assets, 'status', `${status.id}.svg`);
  if (!fs.existsSync(file)) missing.push(`${status.id}: /assets/ui/status/${status.id}.svg`);
  checkBuilt(path.join('status', `${status.id}.svg`), status.id);
}
const expected = 2 * itemRows.length + skills.length + (statusCatalog.statusEffects ?? []).length;
console.log(`UI asset validation: ${itemRows.length} items (two variants), ${skills.length} skills, ${(statusCatalog.statusEffects ?? []).length} statuses; ${expected} expected paths.`);
if (missing.length || builtMissing.length) {
  if (missing.length) { console.error(`Missing ${missing.length} source UI asset path(s):`); for (const entry of missing) console.error(` - ${entry}`); }
  if (builtMissing.length) { console.error(`Missing ${builtMissing.length} production build UI asset path(s):`); for (const entry of builtMissing) console.error(` - ${entry}`); }
  process.exitCode = 1;
} else console.log(fs.existsSync(builtAssets) ? 'All catalogue assets exist in source and production build.' : 'All catalogue source assets exist (production build not present).');
