const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BattleEngine } = require('../../../packages/shared/dist/battle-engine');

const root = path.resolve(__dirname, '../../..');
const monstersData = JSON.parse(fs.readFileSync(path.join(root, 'monsters.json'), 'utf8'));
const skillTree = JSON.parse(fs.readFileSync(path.join(root, 'skill_trees.json'), 'utf8'));
const statusEffectsData = JSON.parse(fs.readFileSync(path.join(root, 'status_effects.json'), 'utf8'));
const statusEffectDefs = Object.fromEntries(statusEffectsData.statusEffects.map((status) => [status.id, status]));

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
  assert.equal(BattleEngine.attackDurationTicks(0), 10, 'zero Attack Speed takes exactly 10 ticks to fill the basic-attack gauge');
  assert.equal(BattleEngine.attackDurationTicks(800), 1, '800 Attack Speed reaches the one-tick cap');
  assert.equal(BattleEngine.attackDurationTicks(1000), 1, 'Attack Speed above 800 is capped at maximum speed');
  assert.equal(BattleEngine.attackDurationTicks(-100), 10, 'effective Attack Speed cannot fall below zero');
  assert(
    BattleEngine.attackDurationTicks(110) < BattleEngine.attackDurationTicks(85),
    'a fixed 25-point penalty increases the effective basic-attack interval',
  );
  assert(
    BattleEngine.attackDurationTicks(85) < BattleEngine.attackDurationTicks(60),
    'each additional fixed 25-point penalty continues to increase the interval',
  );
  assert(
    BattleEngine.attackDurationTicks(60) < BattleEngine.attackDurationTicks(35),
    'three fixed 25-point penalties continue to increase the interval cumulatively',
  );

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
    if (monster.id === 'mon_wraith') {
      assert.equal(monster.evasion, 101, 'preserve the user-balanced Wailing Wraith Evasion');
    } else {
      assert.equal(monster.evasion, Math.round(previousCalibratedEvasion[monster.id] * 0.9), `Evasion -10%: ${monster.id}`);
    }
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

  // Base regen and the food bonus are separate snapshot fields. The engine adds
  // the food bonus once, and only while the buff is active (SPEC §21 / §7.1).
  const regenResult = BattleEngine.simulateBattle(
    baselineCharacter({
      hp: 100, maxHp: 1000, sp: 100, maxSp: 1000,
      hpRegenPerTenTicks: 8, spRegenPerTenTicks: 2,
      foodBuffTicksRemaining: 100, foodBuffItemId: 'food_bread',
      foodBuffHpRegenPerTenTicks: 7, foodBuffSpRegenPerTenTicks: 4,
    }),
    { ...meleeMonster, id: 'regen-test-monster', hp: 100000, atk: 0, gambit: [] },
    page,
    'food-regen-is-added-once',
    { weaponBaseAttackTicks: 99 },
  );
  const firstHpRegen = regenResult.log.events.find((event) => event.actor === 'character' && event.action === 'regen' && event.resource === 'HP');
  const firstSpRegen = regenResult.log.events.find((event) => event.actor === 'character' && event.action === 'regen' && event.resource === 'MP');
  assert.equal(firstHpRegen?.amount, 15, '8 base HP regen + 7 food HP regen equals 15, not 22');
  assert.equal(firstSpRegen?.amount, 6, '2 base SP regen + 4 food SP regen is also added only once');

  const speedTestMonster = { ...meleeMonster, hp: 4, gambit: [] };
  const uninflictedSpeedResult = BattleEngine.simulateBattle(
    baselineCharacter({ atk: 1, hp: 50000, maxHp: 50000 }),
    speedTestMonster,
    page,
    'attack-speed-without-freeze',
    { weaponBaseAttackTicks: 6, statusEffectDefs },
  );
  const oneStackFreezeResult = BattleEngine.simulateBattle(
    baselineCharacter({
      atk: 1, hp: 50000, maxHp: 50000,
      statusEffects: [{ type: 'freeze', appliedAtTick: 0, expiresAtTick: 100, moveSpeedPenalty: 25, attackSpeedPenalty: 25 }],
    }),
    speedTestMonster,
    page,
    'attack-speed-with-one-freeze-stack',
    { weaponBaseAttackTicks: 6, statusEffectDefs },
  );
  const firstUnfrozenAttack = uninflictedSpeedResult.log.events.find((event) => event.actor === 'character' && event.action === 'attack');
  const firstFrozenAttack = oneStackFreezeResult.log.events.find((event) => event.actor === 'character' && event.action === 'attack');
  assert.equal(firstUnfrozenAttack?.tick, 8, 'rating 110 fills the basic-attack gauge using the universal 10-to-1 tick scale');
  assert.equal(firstFrozenAttack?.tick, 9, 'one Freeze stack slows the first basic attack by one simulation tick at this baseline');

  const castSpeedTestSkill = {
    id: 'test_cast_attack_speed_independence', name: 'Cast Timing Test',
    damageType: 'magic', ranged: true, maxRange: 7, spCost: 0,
    baseCastTicks: 1, cooldownTicks: 999, effect: { dmgMult: 0.01 },
  };
  const castSpeedTestPage = { lines: [
    { priority: 1, condition: { id: 'always' }, action: { id: 'use_skill', skillId: castSpeedTestSkill.id } },
    { priority: 2, condition: { id: 'always' }, action: { id: 'attack' } },
  ] };
  const castTimingAtZeroAttackSpeed = BattleEngine.simulateBattle(
    baselineCharacter({ attackSpeed: 0, skills: { [castSpeedTestSkill.id]: true }, skillDefs: { [castSpeedTestSkill.id]: castSpeedTestSkill }, hp: 50000, maxHp: 50000 }),
    { ...meleeMonster, hp: 50000, gambit: [] }, castSpeedTestPage,
    'cast-timing-independent-of-attack-speed', { weaponBaseAttackTicks: 6, statusEffectDefs },
  );
  const castTimingAtMaxAttackSpeed = BattleEngine.simulateBattle(
    baselineCharacter({ attackSpeed: 800, skills: { [castSpeedTestSkill.id]: true }, skillDefs: { [castSpeedTestSkill.id]: castSpeedTestSkill }, hp: 50000, maxHp: 50000 }),
    { ...meleeMonster, hp: 50000, gambit: [] }, castSpeedTestPage,
    'cast-timing-independent-of-attack-speed', { weaponBaseAttackTicks: 6, statusEffectDefs },
  );
  const firstCastAtZeroAttackSpeed = castTimingAtZeroAttackSpeed.log.events.find((event) => event.actor === 'character' && event.action === 'use_skill');
  const firstCastAtMaxAttackSpeed = castTimingAtMaxAttackSpeed.log.events.find((event) => event.actor === 'character' && event.action === 'use_skill');
  assert.equal(firstCastAtZeroAttackSpeed?.tick, 7, 'the DEX-based cast gauge retains its existing initial timing at Attack Speed 0');
  assert.equal(firstCastAtMaxAttackSpeed?.tick, firstCastAtZeroAttackSpeed?.tick, 'Attack Speed affects basic Attacks only, not skill cast gauge timing');
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
    { weaponBaseAttackTicks: 99, statusEffectDefs },
  );
  const firstCharacterMove = frozenMovement.log.events.find((event) => event.actor === 'character' && event.action === 'move');
  assert(firstCharacterMove, 'a frozen melee character still approaches when out of range');
  assert.equal(firstCharacterMove.moveSpeed, 26, 'one Freeze stack reduces level-1 character Move Speed from 51 to 26');
  const level48Speed = BattleEngine.simulateBattle(
    baselineCharacter({ level: 48, hp: 50000, maxHp: 50000 }),
    { ...rangedMonster, hp: 50000 },
    page,
    'distance-level-48-move-speed',
    { weaponBaseAttackTicks: 99 },
  );
  assert.equal(level48Speed.log.header.characterSnapshot.moveSpeedBase, 98, 'character Move Speed is 50 + level, so level 48 has 98 base speed');

  const iceBolt = skillTree.monsterSkills.find((skill) => skill.id === 'monster_skill_ice_bolt');
  assert(iceBolt && iceBolt.damageType === 'magic' && iceBolt.ranged && iceBolt.maxRange === 7);
  assert.equal(iceBolt.spCost, 0);
  assert.equal(iceBolt.baseCastTicks, 2, 'preserve the latest two-tick Ice Bolt cast-time balance');
  assert.equal(iceBolt.cooldownTicks, 1, 'preserve the current one-tick configured Ice Bolt cooldown');
  assert.equal(iceBolt.effect.applyStatus, 'freeze');
  assert.equal(iceBolt.effect.statusChance, 0.25, 'status chance remains configured on the skill');
  assert.equal(iceBolt.effect.statusDurationTicks, undefined, 'status duration belongs to status_effects.json');
  assert.equal(iceBolt.effect.moveSpeedPenaltyPerStack, undefined, 'status penalty belongs to status_effects.json');
  assert.equal(iceBolt.effect.maxStacks, undefined, 'status stack cap belongs to status_effects.json');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, 'status_effects.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(root, 'apps/frontend/public/data/status_effects.json'), 'utf8')),
    'status-effect catalog copies must match',
  );
  assert.deepEqual(statusEffectDefs.freeze && {
    stackable: statusEffectDefs.freeze.stackable,
    statusDurationTicks: statusEffectDefs.freeze.statusDurationTicks,
    moveSpeedPenaltyPerStack: statusEffectDefs.freeze.moveSpeedPenaltyPerStack,
    attackSpeedPenaltyPerStack: statusEffectDefs.freeze.attackSpeedPenaltyPerStack,
    maxStacks: statusEffectDefs.freeze.maxStacks,
  }, {
    stackable: true, statusDurationTicks: 5, moveSpeedPenaltyPerStack: 25,
    attackSpeedPenaltyPerStack: 25, maxStacks: 3,
  });
  assert.deepEqual(statusEffectDefs.slow && {
    stackable: statusEffectDefs.slow.stackable,
    statusDurationTicks: statusEffectDefs.slow.statusDurationTicks,
    moveSpeedPenalty: statusEffectDefs.slow.moveSpeedPenalty,
    reapplication: statusEffectDefs.slow.reapplication,
  }, { stackable: false, statusDurationTicks: 20, moveSpeedPenalty: 50, reapplication: 'refresh' });
  const wraith = monstersData.monsters.find((monster) => monster.id === 'mon_wraith');
  const monsterSkillDefs = Object.fromEntries(skillTree.monsterSkills.map((skill) => [skill.id, skill]));
  const freezeResult = BattleEngine.simulateBattle(
    baselineCharacter({ hp: 50000, maxHp: 50000, atk: 1 }),
    wraith,
    page,
    'distance-ice-bolt',
    { weaponBaseAttackTicks: 99, monsterSkillDefs, statusEffectDefs },
  );
  const iceEvents = freezeResult.log.events.filter((event) => event.actor === 'monster' && event.action === 'use_skill' && event.skillId === 'monster_skill_ice_bolt');
  assert(iceEvents.length > 0, 'Wailing Wraith uses Ice Bolt');
  assert(iceEvents.every((event) => Number.isFinite(event.damage) && event.damage > 0), 'Ice Bolt battle events include the resolved damage for live and history logs');
  assert.equal(iceEvents[0].tick, 2, 'tick 0 is the initial instant, so a two-tick Ice Bolt first resolves at tick 2');
  assert(iceEvents.every((event, index) => index === 0 || event.tick - iceEvents[index - 1].tick === 2), 'zero-cooldown Ice Bolt repeats at its two-tick interval after the first cast');
  assert(!freezeResult.log.events.some((event) => event.actor === 'monster' && event.action === 'move'), 'Wailing Wraith stays stationary while Ice Bolt is usable');
  assert(freezeResult.log.events.some((event) => event.action === 'freeze_applied'), 'Ice Bolt can apply Freeze');
  for (const event of freezeResult.log.events.filter((item) => item.action === 'freeze_applied')) {
    assert(event.stackCount >= 1 && event.stackCount <= 3);
    assert.equal(event.expiresAtTick, event.tick + 5, 'each Freeze stack expires after five seconds');
    assert.equal(event.moveSpeedPenalty, 25);
    assert.equal(event.attackSpeedPenalty, 25, 'each Freeze stack applies its canonical Attack Speed penalty');
  }
  assert(!freezeResult.log.events.some((event) => event.action === 'range_blocked'), 'range blocks are not log events');

  const timingResult = BattleEngine.simulateBattle(
    baselineCharacter({ level: 48, agi: 100, attackSpeed: (8 / 9) * 800, hp: 50000, maxHp: 50000, atk: 1 }),
    wraith,
    page,
    'distance-ice-bolt-and-first-move-timing',
    { weaponBaseAttackTicks: 2, monsterSkillDefs, statusEffectDefs },
  );
  const firstTimedIceBolt = timingResult.log.events.find((event) => event.actor === 'monster' && event.action === 'use_skill' && event.skillId === 'monster_skill_ice_bolt');
  const firstTimedCharacterMove = timingResult.log.events.find((event) => event.actor === 'character' && event.action === 'move');
  assert.equal(firstTimedIceBolt?.tick, 2, 'first two-tick Ice Bolt resolves at T2');
  assert.equal(firstTimedCharacterMove?.tick, 2, 'character movement gauge accrued from the initial intent and first movement resolves at T2');

  assert.equal(wraith.gambit[0].action.skillId, 'monster_skill_ice_bolt');
  assert.equal(wraith.gambit[1].action.type, 'attack');
  assert.equal(wraith.gambit[1].condition.type, 'self_has_status');
  assert.equal(wraith.gambit[1].condition.status, 'silence');
  assert(!freezeResult.log.events.some((event) => event.actor === 'monster' && event.action === 'attack'), 'Wailing Wraith does not basic-attack while Ice Bolt is usable');
  assert.equal(wraith.basicAttackDamageType, 'melee');
  assert.equal(wraith.basicAttackRange, 0);

  const cappedFreezeCharacter = baselineCharacter({
    hp: 50000, maxHp: 50000, atk: 1,
    statusEffects: Array.from({ length: 3 }, () => ({
      type: 'freeze', appliedAtTick: 0, expiresAtTick: 99999, moveSpeedPenalty: 25,
      attackSpeedPenalty: 25,
    })),
  });
  const cappedFreezeResult = BattleEngine.simulateBattle(
    cappedFreezeCharacter, wraith, page, 'distance-freeze-cap',
    { weaponBaseAttackTicks: 99, monsterSkillDefs, statusEffectDefs },
  );
  assert(!cappedFreezeResult.log.events.some((event) => event.action === 'freeze_applied'), 'Freeze cannot exceed three active stacks');

  const slowSkill = {
    id: 'monster_skill_test_slow', name: 'Test Slow', damageType: 'magic',
    ranged: true, maxRange: 7, spCost: 0, baseCastTicks: 1, cooldownTicks: 999,
    effect: { dmgMult: 0.1, applyStatus: 'slow' },
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
    { weaponBaseAttackTicks: 6, monsterSkillDefs: { ...monsterSkillDefs, [slowSkill.id]: slowSkill }, statusEffectDefs },
  );
  const slowApplied = slowResult.log.events.find((event) => event.action === 'status_applied' && event.status === 'slow');
  assert(slowApplied && slowApplied.actor === 'character', 'Slow remains a status effect applied to the player');
  assert.equal(slowApplied.durationTicks, 20);
  assert(slowResult.log.events.some((event) => event.action === 'status_ended' && event.status === 'slow' && event.tick === 21), 'Slow expires 20 ticks after its first application at T1');
  assert(!slowResult.log.events.some((event) => event.action === 'status_expired'), 'new logs do not emit generic status_expired events');
  assert(!slowResult.log.events.some((event) => event.action === 'freeze_applied'), 'Slow and Freeze are distinct status types');

  const statusExpiryCharacter = baselineCharacter({
    hp: 50000,
    maxHp: 50000,
    atk: 1,
    statusEffects: [
      { type: 'freeze', appliedAtTick: 0, expiresAtTick: 2, moveSpeedPenalty: 25, attackSpeedPenalty: 25 },
      { type: 'freeze', appliedAtTick: 0, expiresAtTick: 4, moveSpeedPenalty: 25, attackSpeedPenalty: 25 },
      { type: 'slow', appliedAtTick: 0, expiresAtTick: 5, moveSpeedPenalty: 50 },
    ],
  });
  const statusExpiryMonster = { ...meleeMonster, hp: 50, atk: 1, atkSpeedTicks: 99 };
  const statusExpiryResult = BattleEngine.simulateBattle(
    statusExpiryCharacter,
    statusExpiryMonster,
    page,
    'status-stack-lessens-then-ends',
    { weaponBaseAttackTicks: 2, statusEffectDefs },
  );
  assert(
    statusExpiryResult.log.events.some((event) => event.action === 'status_stack_lessened' && event.status === 'freeze' && event.tick === 2 && event.stackCount === 1),
    'when one of two Freeze stacks expires, the log shows one remaining stack',
  );
  assert(
    statusExpiryResult.log.events.some((event) => event.action === 'status_ended' && event.status === 'freeze' && event.tick === 4 && event.stackCount === 0),
    'the final Freeze stack ending is logged explicitly',
  );
  assert(
    statusExpiryResult.log.events.some((event) => event.action === 'status_ended' && event.status === 'slow' && event.tick === 5),
    'non-stackable statuses also use explicit status-ended events',
  );

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
