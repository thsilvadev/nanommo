const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BattleEngine } = require('../../../packages/shared/dist/battle-engine');

const root = path.resolve(__dirname, '../../..');
const monstersData = JSON.parse(fs.readFileSync(path.join(root, 'monsters.json'), 'utf8'));
const skillTree = JSON.parse(fs.readFileSync(path.join(root, 'skill_trees.json'), 'utf8'));

function baselineCharacter(overrides = {}) {
  const derived = BattleEngine.calculateDerivedStats(1, {
    str: 5, agi: 5, dex: 5, vit: 5, int: 5, sor: 5,
  }, {});
  return {
    ...derived,
    level: 1, hp: 1000, sp: 0, maxHp: 1000, maxSp: 0,
    combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0,
    critChance: 0, hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0,
    ...overrides,
  };
}

function run() {
  assert.equal(BattleEngine.calculateHitChance(80, 100), 80);
  assert.equal(BattleEngine.calculateHitChance(-100, 100), 5);
  assert.equal(BattleEngine.calculateHitChance(200, 0), 95);
  const derived = BattleEngine.calculateDerivedStats(1, {
    str: 5, agi: 5, dex: 5, vit: 5, int: 5, sor: 5,
  }, {});
  assert.equal(derived.accuracy, 80);
  assert.equal(derived.evasion, 100);

  for (const monster of monstersData.monsters) {
    assert(['melee', 'ranged'].includes(monster.combatStyle), `combatStyle: ${monster.id}`);
    assert(Number.isFinite(monster.moveSpeedBase) && monster.moveSpeedBase > 0, `moveSpeedBase: ${monster.id}`);
    assert(['melee', 'ranged', 'magic'].includes(monster.basicAttackDamageType), `basicAttackDamageType: ${monster.id}`);
    assert(Number.isFinite(monster.basicAttackRange), `basicAttackRange: ${monster.id}`);
  }

  const meleeMonster = {
    id: 'test_melee', level: 1, hp: 1000, atk: 1, matk: 1, def: 0,
    mdefPercent: 0, accuracy: 80, evasion: 100, critChance: 0,
    atkSpeedTicks: 99, combatStyle: 'melee', basicAttackDamageType: 'melee',
    basicAttackRange: 0, moveSpeedBase: 40,
    gambit: [{ priority: 1, condition: { type: 'always' }, action: { type: 'attack' } }],
  };
  const page = { lines: [{ priority: 1, condition: { id: 'always' }, action: { id: 'attack' } }] };
  const character = baselineCharacter();
  const first = BattleEngine.simulateBattle(character, meleeMonster, page, 'distance-determinism', { weaponBaseAttackTicks: 99 });
  const second = BattleEngine.simulateBattle(character, meleeMonster, page, 'distance-determinism', { weaponBaseAttackTicks: 99 });
  assert.deepEqual(first.log, second.log, 'same snapshot and seed must replay identically');
  assert.equal(first.log.header.characterSnapshot.position, 3);
  assert.equal(first.log.header.monsterSnapshot.position, 4);

  for (const playerStyle of ['melee', 'ranged']) {
    for (const monsterStyle of ['melee', 'ranged']) {
      const playerIsRanged = playerStyle === 'ranged';
      const monsterIsRanged = monsterStyle === 'ranged';
      const pairMonster = {
        ...meleeMonster, id: `pair_${playerStyle}_${monsterStyle}`,
        combatStyle: monsterStyle,
        basicAttackDamageType: monsterIsRanged ? 'ranged' : 'melee',
        basicAttackRange: monsterIsRanged ? 6 : 0,
      };
      const pairCharacter = baselineCharacter({
        combatStyle: playerStyle,
        basicAttackDamageType: playerIsRanged ? 'ranged' : 'melee',
        basicAttackRange: playerIsRanged ? 6 : 0,
      });
      const pairResult = BattleEngine.simulateBattle(pairCharacter, pairMonster, page, `pair_${playerStyle}_${monsterStyle}`, { weaponBaseAttackTicks: 99 });
      const rangedFormation = playerIsRanged || monsterIsRanged;
      assert.equal(pairResult.log.header.characterSnapshot.position, rangedFormation ? 0 : 3);
      assert.equal(pairResult.log.header.monsterSnapshot.position, rangedFormation ? 7 : 4);
    }
  }

  const rangedMonster = {
    ...meleeMonster, id: 'test_ranged', hp: 2000, combatStyle: 'ranged',
    basicAttackDamageType: 'ranged', basicAttackRange: 6, moveSpeedBase: 62,
  };
  const moving = BattleEngine.simulateBattle(character, rangedMonster, page, 'distance-movement', { weaponBaseAttackTicks: 99 });
  assert.equal(moving.log.header.characterSnapshot.position, 0);
  assert.equal(moving.log.header.monsterSnapshot.position, 7);
  assert(moving.log.events.some((event) => event.action === 'range_blocked'));
  assert(moving.log.events.some((event) => event.action === 'move'));

  const iceBolt = skillTree.monsterSkills.find((skill) => skill.id === 'monster_skill_ice_bolt');
  assert(iceBolt && iceBolt.damageType === 'magic' && iceBolt.ranged && iceBolt.maxRange === 6);
  const wraith = monstersData.monsters.find((monster) => monster.id === 'mon_wraith');
  const slowResult = BattleEngine.simulateBattle(
    baselineCharacter({ hp: 50000, maxHp: 50000 }),
    wraith,
    page,
    'distance-ice-bolt',
    {
      weaponBaseAttackTicks: 99,
      monsterSkillDefs: Object.fromEntries(skillTree.monsterSkills.map((skill) => [skill.id, skill])),
    },
  );
  assert(slowResult.log.events.some((event) => event.action === 'status_applied' && event.status === 'slow'));
  console.log('battle-distance-movement: focused assertions passed');
}

run();
