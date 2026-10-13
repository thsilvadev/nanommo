const assert = require('node:assert/strict');
const { CharacterService } = require('../dist/apps/api/src/modules/character/character.service.js');

(async () => {
  const character = { id: 'character-1', name: 'ExactHero' };
  const rows = [
    { id: 'sword-row', characterId: character.id, weaponType: 'sword', level: 8, xp: 12345, spentSkillPoints: 8, skillRanks: { swordsmanship: 5, power_strike: 3 } },
    { id: 'rune-row', characterId: character.id, weaponType: 'rune', level: 3, xp: 777, spentSkillPoints: 2, skillRanks: { arcane_dynamo: 2 } },
  ];
  const repo = {
    find: async ({ where } = {}) => where?.characterId === character.id ? rows : [],
    create: (value) => ({ ...value }),
    save: async (values) => { for (const value of Array.isArray(values) ? values : [values]) { const i = rows.findIndex((r) => r.weaponType === value.weaponType); if (i >= 0) rows[i] = value; else rows.push(value); } return values; },
  };
  const masteryRepo = { manager: { transaction: async (fn) => fn({ getRepository: () => repo }) } };
  const characterRepo = { find: async ({ where, take } = {}) => where?.name === character.name ? [character].slice(0, take ?? 10) : [] };
  const empty = {};
  const service = new CharacterService(characterRepo, masteryRepo, empty, empty, empty, { getSkillsForWeapon: () => [] }, { runFutureCombatMutation: async (_id, fn) => fn() });

  const result = await service.resetMasteryForCharacterName('ExactHero');
  assert.equal(result.categoriesReset, 8);
  assert.equal(result.preservedProgress, true);
  for (const category of ['sword', 'rune']) {
    const row = rows.find((r) => r.weaponType === category);
    assert.equal(row.skillRanks && Object.keys(row.skillRanks).length, 0);
    assert.equal(row.spentSkillPoints, 0);
  }
  assert.equal(rows.find((r) => r.weaponType === 'sword').level, 8);
  assert.equal(Number(rows.find((r) => r.weaponType === 'sword').xp), 12345);
  assert.equal(rows.find((r) => r.weaponType === 'rune').level, 3);
  assert.equal(Number(rows.find((r) => r.weaponType === 'rune').xp), 777);

  characterRepo.find = async () => [character, { id: 'duplicate', name: 'ExactHero' }];
  await assert.rejects(service.resetMasteryForCharacterName('ExactHero'), /ambiguous/);
  console.log('mastery-reset-service: passed (all eight categories, ranks/points cleared, XP/levels preserved, ambiguity rejected)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
