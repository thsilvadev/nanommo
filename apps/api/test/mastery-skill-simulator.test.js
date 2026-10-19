const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BattleEngine, calculateMasteryXpAwards } = require('../../../packages/shared/dist/battle-engine');

const root = path.resolve(__dirname, '../../..');
const skillCatalog = JSON.parse(fs.readFileSync(path.join(root, 'skill_trees.json'), 'utf8'));
const statusCatalog = JSON.parse(fs.readFileSync(path.join(root, 'status_effects.json'), 'utf8'));
const statusEffectDefs = Object.fromEntries(statusCatalog.statusEffects.map((x) => [x.id, x]));
const skillsById = Object.fromEntries([...Object.values(skillCatalog.trees).flat(), ...(skillCatalog.legacySkills ?? [])].map((skill) => [skill.id, skill]));

function rankedDefinition(id, rank = 1, storedEssenceRank = 0) {
  const original = skillsById[id];
  assert(original, 'unknown skill ' + id);
  const skill = { ...original, effect: { ...(original.effect ?? {}) }, masteryRank: rank };
  let cost = Number(skill.spCost ?? 0);
  if (Array.isArray(skill.spCostByRank)) cost = Number(skill.spCostByRank[Math.min(rank, skill.spCostByRank.length) - 1] ?? cost);
  else if (Number.isFinite(Number(skill.spCostPerRank))) cost = Number(skill.spCostPerRank) * rank;
  skill.baseSpCost = Math.max(0, Math.floor(cost));
  skill.spCost = skill.baseSpCost > 0 && storedEssenceRank > 0
    ? Math.max(1, Math.floor(skill.baseSpCost * (1 - 0.05 * storedEssenceRank)))
    : skill.baseSpCost;
  if (Array.isArray(skill.cooldownTicksByRank)) skill.cooldownTicks = Number(skill.cooldownTicksByRank[Math.min(rank, skill.cooldownTicksByRank.length) - 1]);
  return skill;
}

function character(overrides = {}) {
  return {
    characterName: 'MasteryTest', level: 1, hp: 5000, maxHp: 5000,
    sp: 50000, maxSp: 50000, atk: 50000, matk: 50000,
    def: 0, mdefPercent: 0, accuracy: 500, evasion: 0, critChance: 0,
    agi: 5, dex: 100, attackSpeed: 0, castTimeReduction: 200,
    hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0,
    combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0,
    statusEffects: [], skills: {}, skillDefs: {}, masteryEquipment: [],
    ...overrides,
  };
}

function monster(overrides = {}) {
  return {
    id: 'mastery_dummy', name: 'Mastery Dummy', level: 1,
    hp: 100000, atk: 0, matk: 0, def: 0, mdefPercent: 0,
    accuracy: 0, evasion: 0, critChance: 0, atkSpeedTicks: 2,
    combatStyle: 'melee', basicAttackDamageType: 'melee',
    basicAttackRange: 0, moveSpeedBase: 50, gambit: [],
    ...overrides,
  };
}

function page(skillId, includeAttack = true) {
  const lines = [];
  if (includeAttack) lines.push({ priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } });
  if (skillId) lines.push({ priority: 2, conditions: [{ id: 'always' }], action: { id: 'use_skill', params: { skillId } } });
  return { lines };
}

function simulate(snapshot, foe, gambit, seed = 'mastery-sim-test') {
  return BattleEngine.simulateBattle(snapshot, foe, gambit, seed, { statusEffectDefs, itemDefinitions: {} });
}

function equipped(category, slot = 'mainHand', twoHanded = false) {
  return { slot, category, twoHanded };
}

function runActiveSkill(id, options = {}) {
  const skill = rankedDefinition(id, options.rank ?? 1, options.storedEssenceRank ?? 0);
  const snapshot = character({
    atk: options.atk ?? 50000,
    matk: options.matk ?? 50000,
    hp: options.hp ?? 5000,
    maxHp: options.maxHp ?? 5000,
    sp: options.sp ?? 50000,
    maxSp: options.maxSp ?? 50000,
    dex: options.dex ?? 100,
    basicAttackDamageType: options.basicAttackDamageType ?? 'melee',
    combatStyle: options.combatStyle ?? 'melee',
    masteryEquipment: options.equipment ?? [equipped(skill.category ?? skill.weaponType, skill.category === 'shield' || skill.category === 'rune' ? 'offHand' : 'mainHand', ['greatsword','bow','staff'].includes(skill.category))],
    skills: { [id]: skill },
    skillDefs: { [id]: skill },
  });
  if (options.storedEssenceRank) {
    const stored = rankedDefinition('stored_essence', options.storedEssenceRank);
    snapshot.masteryEquipment.push(equipped('rune', 'offHand', false));
    snapshot.skillDefs.stored_essence = stored;
    snapshot.skillDefs[id].spCost = snapshot.skillDefs[id].baseSpCost > 0
      ? Math.max(1, Math.floor(snapshot.skillDefs[id].baseSpCost * (1 - 0.05 * options.storedEssenceRank)))
      : 0;
  }
  return { snapshot, skill, result: simulate(snapshot, monster(options.monster ?? {}), page(id), options.seed ?? ('skill-' + id)) };
}

function run() {
  const categories = Object.keys(skillCatalog.trees).sort();
  assert.deepEqual(categories, ['bow','dagger','greatsword','rod','rune','shield','staff','sword']);
  for (const [category, entries] of Object.entries(skillCatalog.trees)) {
    assert.equal(entries.length, 2, category + ' has exactly two current nodes');
    assert(entries.every((s) => s.category === category && s.maxRank === 5), category + ' current nodes use the category and five ranks');
    assert(entries.every((s) => ['active', 'passive'].includes(s.kind) && s.effect && s.effect.type), category + ' has explicit kind and effect payload');
    assert(entries.every((s) => Number.isFinite(s.spCost) && Number.isFinite(s.baseCastTicks) && Number.isFinite(s.cooldownTicks)), category + ' has explicit cost/timing');
    assert.equal(entries[0].node, 1);
    assert.equal(entries[1].node, 2);
    assert(entries[1].prerequisite && entries[1].prerequisite.rank === 5, category + ' node two requires node one rank five');
  }
  assert(skillCatalog.trees.staff.every((skill) => skill.kind === 'active'), 'Staff has two active skills');
  assert(skillCatalog.trees.rod.every((skill) => skill.kind === 'active'), 'Rod has two active skills');

  const power = runActiveSkill('power_strike', { atk: 100000, monster: { hp: 75000 } });
  const powerHit = power.result.log.events.find((e) => e.action === 'use_skill' && e.skillId === 'power_strike');
  assert(powerHit, 'Power Strike executes');
  assert.equal(powerHit.baseSpCost, 30);
  assert.equal(powerHit.spSpent, 30);
  assert.equal(powerHit.hit, true);
  assert.equal(powerHit.crit, false);
  assert.equal(power.skill.cooldownTicks, 10);
  assert(powerHit.damage > 99000 && powerHit.damage < 101100, 'Power Strike uses ATK + 50 per rank with bounded damage variance');

  const heavy = runActiveSkill('heavy_swing', { rank: 2, atk: 100000, monster: { hp: 150000 } });
  const heavyHit = heavy.result.log.events.find((e) => e.action === 'use_skill' && e.skillId === 'heavy_swing');
  assert(heavyHit, 'Heavy Swing executes');
  assert.equal(heavyHit.baseSpCost, 35, 'Heavy Swing uses the configured rank-based SP cost');
  assert.equal(heavyHit.spSpent, 35);
  assert.equal(heavy.skill.cooldownTicks, 25);
  assert.equal(heavyHit.crit, false);
  assert(heavyHit.damage > 108900 && heavyHit.damage < 111200, 'rank 2 Heavy Swing deals (ATK × 1.1) + (20 × rank), before mitigation/variance');

  const heavyDisarm = heavy.result.log.events.find((e) => e.action === 'status_applied' && e.status === 'disarm' && e.sourceSkillId === 'heavy_swing');
  assert(heavyDisarm, 'Heavy Swing always applies Disarm to a surviving target');
  assert.equal(heavyDisarm.durationTicks, 6, 'rank 2 Heavy Swing disarms for six ticks');
  for (let rank = 1; rank <= 5; rank++) {
    const rankedHeavy = runActiveSkill('heavy_swing', {
      rank, atk: 100000, monster: { hp: 250000 }, seed: 'heavy-disarm-rank-' + rank,
    });
    const applied = rankedHeavy.result.log.events.find((e) => e.action === 'status_applied' && e.status === 'disarm' && e.sourceSkillId === 'heavy_swing');
    assert(applied, 'Heavy Swing rank ' + rank + ' applies Disarm');
    assert.equal(applied.durationTicks, rank * 3, 'Heavy Swing rank ' + rank + ' has rank-scaled Disarm duration');
  }

  const approachHeavy = rankedDefinition('heavy_swing', 5);
  const approachBrutality = rankedDefinition('brutality', 5);
  const approachCharacter = character({
    hp: 500000, maxHp: 500000, atk: 100, dex: 100, attackSpeed: 800,
    combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0,
    masteryEquipment: [equipped('greatsword', 'mainHand', true)],
    skills: { heavy_swing: approachHeavy },
    skillDefs: { heavy_swing: approachHeavy, brutality: approachBrutality },
  });
  const heavyFirstPage = { lines: [
    { priority: 1, conditions: [{ id: 'always' }], action: { id: 'use_skill', params: { skillId: 'heavy_swing' } } },
    { priority: 2, conditions: [{ id: 'always' }], action: { id: 'attack' } },
  ] };
  const approachHeavyResult = simulate(
    approachCharacter,
    monster({ id: 'ranged-approach-target', hp: 100000, combatStyle: 'ranged', basicAttackDamageType: 'ranged', basicAttackRange: 6, moveSpeedBase: 0 }),
    heavyFirstPage,
    'heavy-swing-approach-priority',
  );
  const firstHeavy = approachHeavyResult.log.events.find((e) => e.actor === 'character' && e.action === 'use_skill' && e.skillId === 'heavy_swing');
  const firstBasicAttack = approachHeavyResult.log.events.find((e) => e.actor === 'character' && e.action === 'attack');
  assert(firstHeavy, 'Heavy Swing resolves after the melee character approaches a ranged target');
  assert(firstBasicAttack && firstBasicAttack.tick > firstHeavy.tick,
    'basic Attack must begin after Heavy Swing; the two actions cannot resolve in the same tick');
  assert(!approachHeavyResult.log.events.some((e) =>
    e.actor === 'character' && e.action === 'attack' && e.distanceAtActionStart === 0 && e.tick <= firstHeavy.tick),
    'the character does not basic-attack on arrival before the first ready Heavy Swing');
  const moveToMelee = approachHeavyResult.log.events.find((e) => e.actor === 'character' && e.action === 'move' && e.toPosition === 6);
  assert(moveToMelee && moveToMelee.tick <= firstHeavy.tick, 'the character reaches melee range before Heavy Swing resolves');

  const fireball = runActiveSkill('fire_ball', { atk: 100000, matk: 50000, monster: { hp: 140000 } });
  const fireballHit = fireball.result.log.events.find((e) => e.action === 'use_skill' && e.skillId === 'fire_ball');
  assert(fireballHit, 'Fire Ball executes');
  assert.equal(fireballHit.baseSpCost, 10);
  assert.equal(fireballHit.spSpent, 10);
  assert.equal(fireballHit.damageType, 'magic');
  assert.equal(fireballHit.crit, false);
  assert.equal(fireballHit.spRemaining.character, fireball.snapshot.sp - 10, 'SP is deducted before action logging');
  assert.equal(fireball.skill.baseCastTicks, 3);
  assert.equal(fireball.skill.cooldownTicks, 1);
  assert(fireballHit.damage > 49000 && fireballHit.damage < 51100, 'Fire Ball uses MATK plus 30 per rank');

  const wisp = runActiveSkill('wisp_flow', { atk: 100000, matk: 50000, monster: { hp: 140000 } });
  const wispHit = wisp.result.log.events.find((e) => e.action === 'use_skill' && e.skillId === 'wisp_flow');
  assert(wispHit, 'Wisp Flow executes');
  assert.equal(wispHit.baseSpCost, 5);
  assert.equal(wispHit.spSpent, 5);
  assert(wispHit.damage >= 59400 && wispHit.damage <= 60650, 'Light Wisp uses MATK + 25 × rank + floor(pre-cost SP / 5)');

  const fire = runActiveSkill('fire_blast', { atk: 100000, matk: 50000, monster: { hp: 140000 } });
  const fireHit = fire.result.log.events.find((e) => e.action === 'use_skill' && e.skillId === 'fire_blast');
  assert(fireHit, 'Fire Blast executes');
  assert.equal(fireHit.baseSpCost, 100);
  assert.equal(fireHit.damageType, 'magic');
  assert.equal(fire.skill.baseCastTicks, 6);
  assert.equal(fire.skill.cooldownTicks, 15);
  assert.equal(fireHit.crit, false);
  assert(fireHit.damage > 49000 && fireHit.damage < 51100, 'Fire Blast uses MATK plus 50 per rank');

  let burned = false;
  let burnResult = null;
  for (let i = 0; i < 60 && !burned; i++) {
    const attempt = runActiveSkill('fire_blast', { atk: 4000, matk: 1000, monster: { hp: 110000 }, seed: 'burn-' + i });
    if (attempt.result.log.events.some((e) => e.action === 'status_applied' && e.status === 'burn')) {
      burned = true;
      burnResult = attempt.result;
    }
  }
  assert(burned, 'Fire Blast eventually applies Burn deterministically across seeded cases');
  assert(burnResult.log.events.some((e) => e.action === 'status_damage' && e.status === 'burn' && e.damage === 1000), 'Burn ticks source MATK damage every five ticks');

  let burnRefreshed = false;
  for (let i = 0; i < 80 && !burnRefreshed; i++) {
    const attempt = runActiveSkill('fire_blast', { atk: 4000, matk: 1000, monster: { hp: 40000 }, seed: 'burn-refresh-' + i });
    const events = attempt.result.log.events;
    burnRefreshed = events.some((e) => e.action === 'status_refreshed' && e.status === 'burn')
      && events.filter((e) => e.action === 'status_applied' && e.status === 'burn').length === 1;
  }
  assert(burnRefreshed, 'Burn refreshes one existing status instead of creating a second stack');

  const blink = runActiveSkill('blinkstrike', {
    atk: 100000, combatStyle: 'ranged', basicAttackDamageType: 'ranged',
    equipment: [equipped('dagger', 'mainHand', false)], monster: { hp: 75000 },
  });
  const blinkHit = blink.result.log.events.find((e) => e.action === 'use_skill' && e.skillId === 'blinkstrike');
  assert(blink.result.log.events.some((e) => e.action === 'move' && e.reason === 'blinkstrike'), 'Blinkstrike logs lane relocation');
  assert.equal(blink.result.log.finalPositions.character, 6, 'Blinkstrike relocates directly in front of the target');
  assert(blinkHit && blinkHit.spSpent === 0 && blinkHit.crit === false, 'Blinkstrike has no SP cost and cannot crit');
  assert.equal(blink.skill.cooldownTicks, 100);

  const violent = runActiveSkill('violent_shot', {
    atk: 100000, combatStyle: 'melee', basicAttackDamageType: 'melee',
    equipment: [equipped('bow', 'mainHand', true)], monster: { hp: 150000 },
  });
  const violentHit = violent.result.log.events.find((e) => e.action === 'use_skill' && e.skillId === 'violent_shot');
  assert(violent.result.log.events.some((e) => e.action === 'move' && e.reason === 'violent_shot_push'), 'Violent Shot logs the push with the existing lane API');
  assert(violentHit && violentHit.spSpent === 20 && violentHit.damageType === 'ranged' && violentHit.crit === false, 'Violent Shot spends SP, uses ranged physical damage and cannot crit');
  assert(violentHit.damage >= 49 && violentHit.damage <= 51, 'Violent Shot deals 50 physical damage per rank');
  assert.equal(violent.skill.cooldownTicks, 25, 'Violent Shot cooldown follows the canonical root skill catalogue');

  const war = runActiveSkill('war_cry', { hp: 1000, maxHp: 5000, monster: { hp: 100000 } });
  const warHit = war.result.log.events.find((e) => e.action === 'use_skill' && e.skillId === 'war_cry');
  assert(warHit && warHit.target === 'character' && warHit.spSpent === 50, 'War Cry is self-targeted and costs 50 SP');
  assert.equal(war.skill.cooldownTicks, 30);
  assert(war.result.log.events.some((e) => e.statusApplied === 'war_cry_def' && e.defBonus === 10), 'War Cry exposes the DEF buff');
  assert(war.result.log.events.some((e) => e.action === 'status_applied' && e.status === 'war_cry_def' && e.durationTicks === 15), 'War Cry lasts 10 seconds');

  const heal = runActiveSkill('light_of_heaven', { hp: 100, maxHp: 1000, matk: 0, monster: { hp: 100000 } });
  const healHit = heal.result.log.events.find((e) => e.action === 'use_skill' && e.skillId === 'light_of_heaven');
  assert(healHit && healHit.target === 'character' && healHit.healAmount === 50, 'Light of Heaven heals 50 per rank when MATK scale is zero');
  assert.equal(healHit.spSpent, 20);
  assert.equal(heal.skill.baseCastTicks, 5);
  assert.equal(heal.skill.cooldownTicks, 9);

  const barrier = runActiveSkill('magic_barrier', {
    hp: 100000, maxHp: 100000, atk: 1000, matk: 1000,
    monster: {
      hp: 10000, atk: 250, matk: 250, accuracy: 500, evasion: 0, critChance: 0,
      basicAttackDamageType: 'magic', atkSpeedTicks: 2,
      gambit: [{ priority: 1, condition: { type: 'always' }, action: { type: 'attack' } }],
    },
  });
  assert(barrier.result.log.events.some((e) => e.statusApplied === undefined && e.barrierApplied === 100 && e.spSpent === 50), 'Magic Barrier applies its rank-scaled shield at 50 SP');
  assert(barrier.result.log.events.some((e) => e.action === 'status_applied' && e.status === 'magic_barrier' && e.durationTicks === 300), 'Magic Barrier lasts 300 seconds');
  assert.equal(rankedDefinition('magic_barrier').cooldownTicks, 30);
  assert(barrier.result.log.events.some((e) => e.action === 'magic_barrier_absorbed' && e.absorbed > 0), 'Magic Barrier absorbs incoming magic on subsequent actions');

  const focusRank = rankedDefinition('fearless_focus', 3);
  const focusSnapshot = character({
    atk: 100000, combatStyle: 'ranged', basicAttackDamageType: 'ranged', basicAttackRange: 6,
    masteryEquipment: [equipped('bow', 'mainHand', true)],
    skills: {}, skillDefs: { fearless_focus: focusRank },
  });
  const focusResult = simulate(focusSnapshot, monster({ hp: 75000 }), page(null), 'focus-distance');
  const focusAttack = focusResult.log.events.find((e) => e.action === 'attack' && e.actor === 'character');
  assert(focusAttack && focusAttack.distanceAtActionStart === 6, 'Fearless Focus reads the start-of-action empty-space distance');
  assert.equal(focusAttack.precisionUsed, 545, 'Rank 3 adds 15 Precision from rank plus 30 from six empty spaces');
  assert(focusAttack.damage >= 99000 && focusAttack.damage <= 101000,
    'Fearless Focus no longer multiplies damage; only the existing direct-damage variance applies');

  const brutalityOnly = rankedDefinition('brutality', 5);
  const brutalitySnapshot = character({
    atk: 100, masteryEquipment: [equipped('greatsword', 'mainHand', true)],
    skills: {}, skillDefs: { brutality: brutalityOnly },
  });
  const brutalityOnlyResult = simulate(brutalitySnapshot, monster({ hp: 1000 }), page(null), 'brutality-is-str-only');
  assert(!brutalityOnlyResult.log.events.some((e) => e.status === 'disarm' && e.sourceSkillId === 'brutality'),
    'Brutality only contributes its STR passive and never attempts Disarm');

  let doubleStrike = false;
  for (let i = 0; i < 80 && !doubleStrike; i++) {
    const skill = rankedDefinition('double_strike', 5);
    const snapshot = character({
      atk: 100000, masteryEquipment: [equipped('dagger', 'mainHand'), equipped('dagger', 'offHand')],
      skills: {}, skillDefs: { double_strike: skill },
    });
    const attempt = simulate(snapshot, monster({ hp: 75000 }), page(null), 'double-' + i);
    doubleStrike = attempt.log.events.some((e) => e.action === 'attack' && e.doubleStrikeTriggered === true && Array.isArray(e.damageComponents) && e.damageComponents.length === 2);
  }
  assert(doubleStrike, 'Double Strike creates two same-tick components in one action event');

  let bleedApplied = null;
  for (let i = 0; i < 100 && !bleedApplied; i++) {
    const skill = rankedDefinition('swordsmanship', 5);
    const snapshot = character({
      atk: 50000, masteryEquipment: [equipped('sword')],
      skills: {}, skillDefs: { swordsmanship: skill },
    });
    const attempt = simulate(snapshot, monster({ hp: 100000 }), page(null), 'bleed-' + i);
    bleedApplied = attempt.log.events.find((e) => e.action === 'status_stack_applied' && e.status === 'bleed') ?? null;
  }
  assert(bleedApplied, 'Swordsmanship deterministically applies a Bleed stack across seeded cases');
  assert.equal(bleedApplied.durationTicks, undefined, 'Bleed has no timed expiry; the live status icon must remain active until explicitly removed');
  assert.equal(bleedApplied.expiresAtTick, undefined, 'an indefinite Bleed application does not invent an expiry tick');

  let cappedBleed = null;
  const existingBleedStacks = Array.from({ length: 4 }, (_, i) => ({
    type: 'bleed', appliedAtTick: 0, sourceSkillId: 'swordsmanship', sourceActor: 'character',
    damagePerTick: 25, damageIntervalTicks: 5, nextDamageAtTick: 1000 + i,
  }));
  for (let i = 0; i < 120 && !cappedBleed; i++) {
    const skill = rankedDefinition('swordsmanship', 5);
    const snapshot = character({
      atk: 50000, masteryEquipment: [equipped('sword')],
      skills: {}, skillDefs: { swordsmanship: skill },
    });
    const attempt = simulate(snapshot, monster({ hp: 100000, atk: 0, statusEffects: existingBleedStacks.map((status) => ({ ...status })) }), page(null), 'bleed-cap-' + i);
    const stackEvents = attempt.log.events.filter((e) => e.action === 'status_stack_applied' && e.status === 'bleed');
    if (stackEvents.some((e) => e.stackCount === 5)) cappedBleed = { attempt, stackEvents };
  }
  assert(cappedBleed, 'Swordsmanship can reach its five-stack ceiling when four stacks are active');
  assert(cappedBleed.stackEvents.every((e) => e.stackCount <= 5), 'Bleed never exceeds five stacks');
  const fullBleedSkill = rankedDefinition('swordsmanship', 5);
  const fullBleedSnapshot = character({ atk: 50000, masteryEquipment: [equipped('sword')], skills: {}, skillDefs: { swordsmanship: fullBleedSkill } });
  const fullBleed = simulate(fullBleedSnapshot, monster({ hp: 100000, atk: 0, statusEffects: [...existingBleedStacks, { ...existingBleedStacks[0] }] }), page(null), 'bleed-already-full');
  assert.equal(fullBleed.log.events.filter((e) => e.action === 'status_stack_applied' && e.status === 'bleed').length, 0, 'Bleed at five stacks cannot gain a sixth stack');
  const cappedLog = {
    header: { characterSnapshot: { masteryEquipment: [equipped('sword')] } },
    events: cappedBleed.attempt.log.events,
  };
  const expectedActionXp = cappedBleed.attempt.log.events.filter((e) =>
    e.actor === 'character' &&
    ((e.action === 'attack' && e.target === 'monster' && e.hit === true) ||
      (e.action === 'use_skill' && e.hit !== false)),
  ).length;
  assert.equal(
    calculateMasteryXpAwards(cappedLog, { twoHandedAction: 2, oneHandedAction: 1, shieldOnHit: 1, runeOnHit: 1 }).sword,
    expectedActionXp,
    'Bleed/status-damage ticks grant no extra Mastery action XP',
  );

  let shieldBash = false;
  for (let i = 0; i < 100 && !shieldBash; i++) {
    const passive = rankedDefinition('shield_bash', 5);
    const snapshot = character({
      hp: 100, maxHp: 100, atk: 1,
      masteryEquipment: [equipped('sword'), equipped('shield', 'offHand')],
      skills: {}, skillDefs: { shield_bash: passive },
    });
    const foe = monster({
      hp: 1000, atk: 15, accuracy: 200, atkSpeedTicks: 2,
      gambit: [{ priority: 1, condition: { type: 'always' }, action: { type: 'attack' } }],
    });
    const attempt = simulate(snapshot, foe, page('not_learned', false), 'bash-' + i);
    shieldBash = attempt.log.events.some((e) => e.action === 'status_applied' && e.status === 'stun' && e.sourceSkillId === 'shield_bash');
  }
  assert(shieldBash, 'Shield Bash stuns at distance zero after a landed incoming basic attack');

  const stored = runActiveSkill('power_strike', { atk: 100000, storedEssenceRank: 3, equipment: [equipped('sword'), equipped('rune', 'offHand')], monster: { hp: 75000 } });
  const storedHit = stored.result.log.events.find((e) => e.action === 'use_skill' && e.skillId === 'power_strike');
  assert(storedHit && storedHit.spSpent === 25, 'Stored Essence reduces 30 SP to floor(30 × .85)');

  const replayA = runActiveSkill('power_strike', { atk: 100000, monster: { hp: 75000 }, seed: 'replay-same-seed' });
  const replayB = runActiveSkill('power_strike', { atk: 100000, monster: { hp: 75000 }, seed: 'replay-same-seed' });
  assert.deepEqual(replayA.result.log.events, replayB.result.log.events, 'same snapshot and seed produce identical action/status logs');
  const masteryLog = (attempt) => ({
    header: { characterSnapshot: { masteryEquipment: attempt.snapshot.masteryEquipment } },
    events: attempt.result.log.events,
  });
  assert.deepEqual(calculateMasteryXpAwards(masteryLog(replayA), { twoHandedAction: 2, oneHandedAction: 1, shieldOnHit: 1, runeOnHit: 1 }), { sword: 1 }, 'one active action earns one action reward');
  assert.deepEqual(
    calculateMasteryXpAwards(masteryLog(replayA), { twoHandedAction: 2, oneHandedAction: 1, shieldOnHit: 1, runeOnHit: 1 }),
    calculateMasteryXpAwards(masteryLog(replayB), { twoHandedAction: 2, oneHandedAction: 1, shieldOnHit: 1, runeOnHit: 1 }),
    'same-seed replay produces identical Mastery awards',
  );

  console.log('mastery-skill-simulator: passed (deterministic combat and catalog contract assertions)');
}

try { run(); } catch (error) { console.error(error); process.exitCode = 1; }

