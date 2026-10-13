const assert = require('node:assert/strict');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service.js');
const items = require('../../../items.json').equipment;
const treeCatalog = require('../../../skill_trees.json').trees;
const byItem = new Map(items.map((item) => [item.id, item]));

const rows = [
  { weaponType: 'sword', level: 5, xp: 30, spentSkillPoints: 5, skillRanks: { swordsmanship: 5 } },
  { weaponType: 'dagger', level: 10, xp: 14000, spentSkillPoints: 10, skillRanks: { double_strike: 5, blinkstrike: 5 } },
  { weaponType: 'rune', level: 3, xp: 4, spentSkillPoints: 3, skillRanks: { stored_essence: 3 } },
  { weaponType: 'shield', level: 2, xp: 2, spentSkillPoints: 2, skillRanks: { shield_bash: 1, war_cry: 1 } },
  { weaponType: 'rod', level: 1, xp: 1, spentSkillPoints: 1, skillRanks: { wisp_flow: 1 } },
];
let equippedRows = [
  { slot: 'mainHand', itemId: 'equip_sword_t1' },
  { slot: 'offHand', itemId: 'equip_shield_t1' },
];
const service = Object.create(BattleService.prototype);
service.equipmentService = {
  getEquipment: async () => equippedRows,
  getWeaponMasteryRows: async () => rows,
};
service.dataService = {
  getItemById: (id) => byItem.get(id),
  getSkillsForWeapon: (category) => treeCatalog[category] ?? [],
};

(async () => {
  const mixed = await service.buildSkillAvailability('character-1');
  assert(mixed.skillDefs.swordsmanship, 'equipped learned Sword passive is snapshotted');
  assert(!mixed.skills.swordsmanship, 'passive is never exposed as a Gambit active choice');
  assert(mixed.skills.war_cry && mixed.skillDefs.shield_bash, 'equipped learned Shield active and passive are snapshotted');
  assert(!mixed.skillDefs.double_strike && !mixed.skills.blinkstrike, 'learned Dagger ranks are absent while Dagger is unequipped');
  assert(!mixed.skillDefs.stored_essence, 'Stored Essence passive is absent while Rune is unequipped');
  assert(!mixed.skillDefs.wisp_flow, 'learned Rod skill is absent while Rod is unequipped');

  equippedRows = [
    { slot: 'mainHand', itemId: 'equip_sword_t1' },
    { slot: 'offHand', itemId: 'equip_rune_t1' },
  ];
  const withRune = await service.buildSkillAvailability('character-1');
  assert.equal(withRune.skillDefs.power_strike, undefined, 'unlearned Sword active remains unavailable');
  assert(withRune.skillDefs.stored_essence, 'equipped learned Rune passive is included');
  assert(!withRune.skills.stored_essence, 'Stored Essence is passive-only');

  console.log('mastery-snapshot-equipment-gates: passed (learned ranks, equipped category gates and passive/active split)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
