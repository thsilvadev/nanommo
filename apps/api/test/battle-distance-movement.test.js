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

  const previousCalibratedEvasion = {
    mon_slime: 98, mon_fieldbat: 101, mon_thornsprout: 101, mon_mudcrawler: 104,
    mon_direwolf: 110, mon_sandscorpion: 113, mon_duneraider: 116, mon_cindergolem: 119,
    mon_venomviper: 125, mon_mirageStalker: 125, mon_brokensentinel: 128, mon_wraith: 134,
    mon_arcanewisp: 137, mon_boneknight: 140, mon_ruinsguardian: 143,
  };
  for (const monster of monstersData.monsters) {
    assert(['melee', 'ranged'].includes(monster.combatStyle), `combatStyle: ${monster.id}`);
    assert(Number.isFinite(monster.moveSpeedBase) && monster.moveSpeedBase > 0, `moveSpeedBase: ${monster.id}`);
    assert(['melee', 'ranged', 'magic'].includes(monster.basicAttackDamageType), `basicAttackDamageType: ${monster.id}`);
    assert(Number.isFinite(monster.basicAttackRange), `basicAttackRange: ${monster.id}`);
    assert.equal(monster.evasion, Math.round(previousCalibratedEvasion[monster.id] * 0.9), `Evasion -10%: ${monster.id}`);
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
    ...meleeMonster, id: 'test_ranged', hp: 200, combatStyle: 'ranged',
    basicAttackDamageType: 'ranged', basicAttackRange: 6, moveSpeedBase: 62,
  };
  const moving = BattleEngine.simulateBattle(character, rangedMonster, page, 'distance-movement', { weaponBaseAttackTicks: 99 });
  assert.equal(moving.log.header.characterSnapshot.position, 0);
  assert.equal(moving.log.header.monsterSnapshot.position, 7);
  assert(!moving.log.events.some((event) => event.action === 'range_blocked'), 'range-blocked events are intentionally omitted from logs');
  const characterMovesRight = moving.log.events.filter((event) => event.actor === 'character' && event.action === 'move');
  assert(characterMovesRight.length > 0, 'the character approaches the target from the left');
  assert(characterMovesRight.every((event) => event.toPosition > event.fromPosition && event.direction === 'right'), 'a character moving to a higher lane position logs rightward direction');

  const rangedCharacter = baselineCharacter({
    hp: 50000, maxHp: 50000, combatStyle: 'ranged',
    basicAttackDamageType: 'ranged', basicAttackRange: 6,
  });
  const targetApproach = BattleEngine.simulateBattle(
    rangedCharacter,
    { ...meleeMonster, hp: 50000, basicAttackRange: 0 },
    page,
    'distance-target-moves-left',
    { weaponBaseAttackTicks: 99 },
  );
  const targetMovesLeft = targetApproach.log.events.filter((event) => event.actor === 'monster' && event.action === 'move');
  assert(targetMovesLeft.length > 0, 'the target approaches the ranged character');
  assert(targetMovesLeft.every((event) => event.toPosition < event.fromPosition && event.direction === 'left'), 'a target moving to a lower lane position logs leftward direction');

  const frozenMovement = BattleEngine.simulateBattle(
    baselineCharacter({ hp: 50000, maxHp: 50000, statusEffects: [{ type: 'freeze', appliedAtTick: 0, expiresAtTick: 1000 }] }),
    rangedMonster,
    page,
    'distance-frozen-movement',
    { weaponBaseAttackTicks: 99 },
  );
  const firstCharacterMove = frozenMovement.log.events.find((event) => event.actor === 'character' && event.action === 'move');
  assert(firstCharacterMove, 'a frozen melee character still approaches when out of range');
  assert.equal(firstCharacterMove.moveSpeed, 36, 'one Freeze stack reduces level-1 character Move Speed from 51 to 36');

  const iceBolt = skillTree.monsterSkills.find((skill) => skill.id === 'monster_skill_ice_bolt');
  assert(iceBolt && iceBolt.damageType === 'magic' && iceBolt.ranged && iceBolt.maxRange === 7);
  assert.equal(iceBolt.spCost, 0);
  assert.equal(iceBolt.baseCastTicks, 2, 'preserve the latest two-tick Ice Bolt cast-time balance');
  assert.equal(iceBolt.cooldownTicks, 0);
  assert.equal(iceBolt.effect.applyStatus, 'freeze');
  assert.equal(iceBolt.effect.statusChance, 0.25);
  assert.equal(iceBolt.effect.statusDurationTicks, 5);
  assert.equal(iceBolt.effect.moveSpeedPenaltyPerStack, 15);
  assert.equal(iceBolt.effect.maxStacks, 5);
  const wraith = monstersData.monsters.find((monster) => monster.id === 'mon_wraith');
  const monsterSkillDefs = Object.fromEntries(skillTree.monsterSkills.map((skill) => [skill.id, skill]));
  const freezeResult = BattleEngine.simulateBattle(
    baselineCharacter({ hp: 50000, maxHp: 50000, atk: 1 }),
    wraith,
    page,
    'distance-ice-bolt',
    { weaponBaseAttackTicks: 99, monsterSkillDefs },
  );
  const iceEvents = freezeResult.log.events.filter((event) => event.actor === 'monster' && event.action === 'use_skill' && event.skillId === 'monster_skill_ice_bolt');
  assert(iceEvents.length > 0, 'Wailing Wraith uses Ice Bolt');
  assert(iceEvents.some((event) => event.tick === 1), 'two-tick ranged cast threshold resolves Ice Bolt at tick 1');
  assert(!freezeResult.log.events.some((event) => event.actor === 'monster' && event.action === 'move'), 'Wailing Wraith stays stationary while Ice Bolt is usable');
  assert(freezeResult.log.events.some((event) => event.action === 'freeze_applied'), 'Ice Bolt can apply Freeze');
  for (const event of freezeResult.log.events.filter((item) => item.action === 'freeze_applied')) {
    assert(event.stackCount >= 1 && event.stackCount <= 5);
    assert.equal(event.expiresAtTick, event.tick + 5, 'each Freeze stack expires after five seconds');
    assert.equal(event.moveSpeedPenalty, 15);
  }
  assert(!freezeResult.log.events.some((event) => event.action === 'range_blocked'), 'range blocks are not log events');
  assert.equal(wraith.gambit[0].action.skillId, 'monster_skill_ice_bolt');
  assert.equal(wraith.gambit[1].action.type, 'attack');
  assert.equal(wraith.gambit[1].condition.type, 'self_has_status');
  assert.equal(wraith.gambit[1].condition.status, 'silence');
  assert(!freezeResult.log.events.some((event) => event.actor === 'monster' && event.action === 'attack'), 'Wailing Wraith does not basic-attack while Ice Bolt is usable');
  assert.equal(wraith.basicAttackDamageType, 'melee');
  assert.equal(wraith.basicAttackRange, 0);

  const cappedFreezeCharacter = baselineCharacter({
    hp: 50000, maxHp: 50000, atk: 1,
    statusEffects: Array.from({ length: 5 }, () => ({
      type: 'freeze', appliedAtTick: 0, expiresAtTick: 99999, moveSpeedPenalty: 15,
    })),
  });
  const cappedFreezeResult = BattleEngine.simulateBattle(
    cappedFreezeCharacter, wraith, page, 'distance-freeze-cap',
    { weaponBaseAttackTicks: 99, monsterSkillDefs },
  );
  assert(!cappedFreezeResult.log.events.some((event) => event.action === 'freeze_applied'), 'Freeze cannot exceed five active stacks');

  const slowSkill = {
    id: 'monster_skill_test_slow', name: 'Test Slow', damageType: 'magic',
    ranged: true, maxRange: 7, spCost: 0, baseCastTicks: 1, cooldownTicks: 999,
    effect: { dmgMult: 0.1, applyStatus: 'slow', statusDurationTicks: 20, moveSpeedPenalty: 50 },
  };
  const slowWraith = {
    ...wraith, hp: 30,
    gambit: [{ priority: 1, condition: { type: 'always' }, action: { type: 'use_skill', skillId: slowSkill.id } }],
  };
  const slowResult = BattleEngine.simulateBattle(
    baselineCharacter({ hp: 50000, maxHp: 50000, atk: 1 }),
    slowWraith,
    page,
    'distance-slow-is-reusable',
    { weaponBaseAttackTicks: 6, monsterSkillDefs: { ...monsterSkillDefs, [slowSkill.id]: slowSkill } },
  );
  const slowApplied = slowResult.log.events.find((event) => event.action === 'status_applied' && event.status === 'slow');
  assert(slowApplied && slowApplied.actor === 'character', 'Slow remains a status effect applied to the player');
  assert.equal(slowApplied.durationTicks, 20);
  assert(slowResult.log.events.some((event) => event.action === 'status_expired' && event.status === 'slow' && event.tick === 20), 'Slow expiration remains deterministic and logged');
  assert(!slowResult.log.events.some((event) => event.action === 'freeze_applied'), 'Slow and Freeze are distinct status types');

  const silencedWraith = { ...wraith, statusEffects: [{ type: 'silence', appliedAtTick: 0, expiresAtTick: 99999 }] };
  const silenceResult = BattleEngine.simulateBattle(
    baselineCharacter({ hp: 50000, maxHp: 50000, atk: 1 }),
    silencedWraith,
    page,
    'distance-wraith-silenced',
    { weaponBaseAttackTicks: 2, monsterSkillDefs },
  );
  assert(!silenceResult.log.events.some((event) => event.actor === 'monster' && event.action === 'use_skill'), 'silenced Wraith cannot cast Ice Bolt');
  assert(silenceResult.log.events.some((event) => event.actor === 'monster' && event.action === 'attack'), 'silenced Wraith falls back to its normal attack');
  assert(silenceResult.log.events.some((event) => event.actor === 'monster' && event.action === 'move'), 'silenced Wraith approaches when not adjacent');
  console.log('battle-distance-movement: focused assertions passed');
}

run();
