#!/usr/bin/env node

/**
 * Phase 3 — Level-up mid-queue (SPEC §6.3, §3.4)
 *
 * A resolve that crosses `xpToNextLevel` must:
 *   - grant exactly +5 unspent attribute points per level (SPEC §6.3)
 *   - recompute maxHp/maxSp upward
 *   - leave hpCurrent/spCurrent RATIO-ADJUSTED, never topped up (SPEC §6.3)
 *   - discard and rebuild the remaining 4 queue entries against the new stats
 *     (SPEC §3.4 / §6.3)
 *
 * All four are reachable only from a resolve, and a level-1 character loses
 * most fights in Green Grounds organically (STATUS.md Issue #2), so the
 * precondition is seeded directly in Postgres per design.md D3. The character
 * and the queue are still built through the real API path.
 *
 * Four scenarios:
 *   1. a single level-up on a default, unequipped character;
 *   2. two thresholds crossed in one resolve (divergence #4 — recorded, not fixed);
 *   3. the same level-up on an EQUIPPED character, where the ratio must come
 *      from the real loadout (divergence #3, fixed in battle.service.ts:453-484);
 *   4. the SP half of "never topped up", on a character whose fight is short
 *      enough that the engine's SP regen has not already refilled the pool.
 *
 * Run: node apps/api/test-phase3-levelup.js
 */

const h = require('./test/helpers/phase3.js');
const { BattleEngine } = require('@nanommo/shared');

// The replication of `queueBattles()` used to pick a suitable kill index, the
// XP-curve reader and the level-up loop all live in the shared harness, because
// the idempotency scenario needs exactly the same machinery.
const { xpToNextLevel, attributesOf, simulateQueueStepAt } = h;

/** SPEC §6.3: one level-up grants exactly 5 unspent attribute points. */
const POINTS_PER_LEVEL = 5;

/** The character enters the chain damaged, so the ratio scaling is observable. */
const SEED_HP = 80;
const SEED_SP = 5;

/**
 * The derived stats the resolver's ratio step is built from.
 *
 * `equipmentStats` is a `GET /equipment/stats/total` payload, folded in exactly
 * the way `buildCharacterSnapshot()` (battle.service.ts:144-160) folds it: the
 * `statBonus` goes into the attributes, `def`/`mdefPercent`/weapon ATK go into
 * the third argument. Omitting it reproduces the equipment-BLIND reading, which
 * is what a scenario needs in order to show the two disagree.
 */
function derivedStatsFor(row, level, equipmentStats = null) {
  const base = h.attributesOf(row);
  return BattleEngine.calculateDerivedStats(
    level,
    equipmentStats ? h.attributesWithEquipment(base, equipmentStats) : base,
    equipmentStats ? h.equipmentArgsOf(equipmentStats) : {},
  );
}

/** The loadout as the API reports it — all zeros for an unequipped character. */
async function fetchEquipmentStats(token) {
  const res = await h.request('GET', '/equipment/stats/total', null, token);
  if (res.status >= 400 || !res.data) {
    throw new Error(`GET /equipment/stats/total -> ${res.status} ${res.raw.slice(0, 200)}`);
  }
  return res.data;
}

/**
 * Replay `queueBattles()`'s first entry for every encounter index and return the
 * first one a scenario can use.
 *
 * `accept(probe, levelStats)` is the scenario's own admissibility test — a plain
 * level-1 fight is fine for one scenario and unusable for another, because what
 * has to stay observable differs (HP below the new maximum, SP below the new
 * maximum, …). The XP window is shared: seeding `xp = xpToNext(level) - 1` before
 * the resolve must cross exactly one threshold, which needs
 * `xpToNext(level) - 1 + xpGain < xpToNext(level + 1)`.
 */
function findKillIndex({ charId, mapId, epoch, level, attributes, equipmentStats, startHp, startSp, accept, scan = 120 }) {
  const needed = xpToNextLevel(level);
  const nextNeeded = xpToNextLevel(level + 1);
  const levelStats = derivedStatsFor({ ...attributes }, level, equipmentStats);

  for (let killIndex = 0; killIndex < scan; killIndex++) {
    const probe = h.simulateQueueStepAt({
      charId, mapId, epoch, killIndex, level, attributes, chainHp: startHp, chainSp: startSp,
      equipment: equipmentStats,
    });
    if (probe.simulation.outcome !== 'win') continue;
    if (probe.simulation.hpAfter <= 0 || probe.simulation.spAfter <= 0) continue;
    if (!accept(probe, levelStats)) continue;
    // `xp = needed - 1`, then `xp += gain`, then one subtraction of `needed`
    // must leave less than `nextNeeded` — i.e. exactly one level-up.
    if (needed - 1 + probe.rewards.xpGain - needed >= nextNeeded) continue;
    return { killIndex, ...probe, needed, nextNeeded, levelStats };
  }
  return null;
}

/**
 * Find a kill index whose first battle (a) is a win, (b) leaves the character
 * below full HP so the ratio scaling is visible, and (c) grants an xpReward
 * small enough that seeding `xp = xpToNext(1) - 1` crosses exactly one
 * threshold.
 *
 * Constraint (b) matters for HP: `mon_slime` is a 34-tick fight and
 * `hpRegenPerTick` refills over the fight, so a starting HP at the maximum
 * yields an `hpAfter` at the maximum, and the resulting `hpCurrent` would equal
 * the new maxHp — the "not topped up" assertion would then pass or fail for the
 * wrong reason.
 *
 * The SP half of (b) is deliberately NOT required here: at the default INT 5
 * every winning Green Grounds fight runs long enough for `spRegenPerTick` to
 * refill the pool, so an SP-starved chain cannot be built from a default
 * character. `assertSpNeverToppedUp()` builds one that can.
 */
function findSingleLevelUpKillIndex({ charId, mapId, epoch, level, attributes }) {
  return findKillIndex({
    charId, mapId, epoch, level, attributes,
    startHp: SEED_HP,
    startSp: SEED_SP,
    accept: (probe, levelStats) => probe.simulation.hpAfter < levelStats.maxHp,
  });
}

// ---------------------------------------------------------------------------
//  1. Setup — a queued battle that will cross exactly one level threshold
// ---------------------------------------------------------------------------

/**
 * Bootstrap a character, pin its progression and encounter stream, and let the
 * queue be built EXACTLY ONCE by `POST /maps/:mapId/enter`.
 *
 * The map is deliberately not entered during bootstrap. Entering the map builds
 * a 5-deep chain from whatever state the character happens to be in, and those
 * delayed jobs then resolve on their own — one of them landing between the seed
 * and the queue build silently rewrites `hpCurrent`/`spCurrent` (observed as a
 * seeded 80 arriving at the queue as 192). Draining afterwards cannot fully
 * close the window, because a job that is already `active` cannot be removed.
 * Seeding first and entering once removes the race entirely.
 */
async function buildSeededQueue({ label, targetLevel, pickKillIndex, startHp, startSp, equipmentStats = null }) {
  const ctx = await h.createCharacter({ enterMap: false, level: targetLevel });
  console.log(`\n[${label}] character ${ctx.charId} (not yet on a map)`);

  await h.drainQueue(ctx.charId);
  const row = await h.getCharacterRow(ctx.charId);
  const attributes = attributesOf(row);

  // `pickKillIndex` may choose the starting HP/SP itself (the multi-level case
  // needs a level-scaled value), so it is resolved before anything is seeded.
  const pick = await pickKillIndex({ ctx, attributes, level: targetLevel, startHp, startSp, equipmentStats });
  const hp = pick.hp ?? startHp ?? SEED_HP;
  const sp = pick.sp ?? startSp ?? SEED_SP;
  const seeded = { level: targetLevel, xp: 0, hpCurrent: hp, spCurrent: sp };

  await h.setCharacterProgression(ctx.charId, seeded);
  const stats = derivedStatsFor(row, targetLevel, equipmentStats);
  h.note(
    `[${label}] seeded level=${targetLevel} hpCurrent=${hp}/${stats.maxHp} spCurrent=${sp}/${stats.maxSp} ` +
      'before the single map entry that builds the queue',
  );

  await h.setKillCounter(ctx.charId, ctx.mapId, {
    mapKillCount: pick.killIndex, epoch: 0, perMonsterKillCount: {},
  });

  h.assertProgressionIntact(ctx.charId, seeded, `[${label}] after pinning the encounter stream`);

  const entered = await h.request('POST', `/maps/${ctx.mapId}/enter`, {}, ctx.token);
  if (entered.status >= 400) {
    throw new Error(`[${label}] POST /maps/${ctx.mapId}/enter -> ${entered.status} ${entered.raw.slice(0, 200)}`);
  }
  h.assertProgressionIntact(ctx.charId, seeded, `[${label}] after the map entry that built the queue`);

  const entries = await h.waitFor(
    'a 5-deep queue to exist',
    async () => {
      const q = await h.getUnresolvedEntries(ctx.charId);
      return q.length >= 5 ? q : null;
    },
    30_000,
  );

  const first = entries[0];
  h.note(
    `[${label}] pinned mapKillCount=${pick.killIndex} -> first entry ${first.monsterId} ` +
      `outcome=${first.outcome} xpGain=${first.xpGain} hpAfter=${first.hpAfter} spAfter=${first.spAfter} ` +
      `(the in-process preview predicted hpAfter=${pick.simulation?.hpAfter}; agreement is what makes the preview usable)`,
  );

  return { ctx, entries, first, pick, seeded, attributes };
}

async function setupScenario({ label, targetLevel }) {
  const built = await buildSeededQueue({
    label,
    targetLevel,
    pickKillIndex: ({ ctx, attributes, level, startHp, startSp }) => {
      const found = findSingleLevelUpKillIndex({
        charId: ctx.charId, mapId: ctx.mapId, epoch: 0, level, attributes,
      });
      if (!found) {
        throw new Error(
          `[${label}] no kill index in 0..119 yields a survivable, damaging win from ` +
            `hp=${startHp}/sp=${startSp} at level ${level}`,
        );
      }
      return found;
    },
  });
  return built;
}

// ---------------------------------------------------------------------------
//  2. §6.3 — the level-up effects
// ---------------------------------------------------------------------------

async function assertLevelUpEffects({ ctx, entries, first, found }, expectedLevelsGained) {
  // Captured BEFORE the resolve fires. Reading them afterwards is vacuous: the
  // level-up discards the survivors and their jobs together, so a post-hoc read
  // always finds none and "no orphaned jobs" would pass no matter what.
  const survivingIds = entries.slice(1).map((e) => e.id);
  const survivingJobIdsBefore = (await h.bullJobIds()).filter((id) => survivingIds.includes(id));
  h.assert(
    '§3.4 the four surviving entries each had a BullMQ job before the resolve',
    survivingJobIdsBefore.length === survivingIds.length,
    `${survivingJobIdsBefore.length} job id(s) under bull:battle-queue:* for ${survivingIds.length} surviving entries ` +
      '(captured pre-resolve — a post-resolve read would always be empty and the orphan check below would be vacuous)',
  );

  const before = await h.getCharacterRow(ctx.charId);
  const beforeDerived = derivedStatsFor(before, Number(before.level));

  // SPEC §4.2: `xp` is XP toward the next level, so seeding it to
  // `xpToNext(level) - 1` makes the very next resolve cross exactly one
  // threshold (or two, when the entry's xpGain is large enough).
  await h.setCharacterProgression(ctx.charId, { xp: xpToNextLevel(Number(before.level)) - 1 });

  const viaApiBefore = await h.getCharacterViaApi(ctx.token);
  h.assert(
    '§6.3 the pre-resolve character state was read through GET /characters',
    viaApiBefore && viaApiBefore.id === ctx.charId,
    `level=${viaApiBefore?.level} xp=${viaApiBefore?.xp} unspent=${viaApiBefore?.unspentAttributePoints} hp=${viaApiBefore?.hpCurrent}/${beforeDerived.maxHp} sp=${viaApiBefore?.spCurrent}/${beforeDerived.maxSp}`,
  );

  // §7.4.1: the resolver's contract is "fired after endAt", not "fired exactly
  // at endAt" (design.md Risks), so the wait is shortened legitimately.
  await h.rewriteEndAtToPast(first.id, { secondsAgo: 5, startAtSecondsAgo: 90 });
  await h.enqueueResolveJob(first.id);

  const after = await h.waitFor(
    'the level-up resolve to land',
    async () => {
      const row = await h.getCharacterRow(ctx.charId);
      return Number(row.level) > Number(before.level) ? row : null;
    },
    60_000,
  );

  // Give the level-up's queue rebuild a moment to finish before reading the queue.
  await h.waitFor(
    'the queue to be rebuilt to 5 entries',
    async () => {
      const q = await h.getUnresolvedEntries(ctx.charId);
      return q.length === 5 ? q : null;
    },
    60_000,
  );

  const viaApiAfter = await h.getCharacterViaApi(ctx.token);
  const levelsGained = Number(after.level) - Number(before.level);
  const afterDerived = derivedStatsFor(after, Number(after.level));

  h.assertEqual(
    '§6.3 level incremented by exactly the number of thresholds crossed',
    levelsGained,
    expectedLevelsGained,
    `seeded xp = xpToNext(${before.level}) - 1 = ${xpToNextLevel(Number(before.level)) - 1}, entry xpGain = ${first.xpGain}`,
  );
  h.assertEqual(
    '§6.3 unspentAttributePoints increased by exactly 5 per level gained',
    Number(after.unspentAttributePoints) - Number(before.unspentAttributePoints),
    POINTS_PER_LEVEL * levelsGained,
    `${before.unspentAttributePoints} -> ${after.unspentAttributePoints}`,
  );
  h.assert(
    '§6.3 maxHp recomputed upward',
    afterDerived.maxHp > beforeDerived.maxHp,
    `maxHp ${beforeDerived.maxHp} (level ${before.level}) -> ${afterDerived.maxHp} (level ${after.level}); formula floor(80 + vit*12 + level*18)`,
  );
  h.assert(
    '§6.3 maxSp recomputed upward',
    afterDerived.maxSp > beforeDerived.maxSp,
    `maxSp ${beforeDerived.maxSp} (level ${before.level}) -> ${afterDerived.maxSp} (level ${after.level}); formula floor(40 + int*10 + level*8)`,
  );

  // The level-up sets hpCurrent/spCurrent from the entry's hpAfter/spAfter
  // FIRST, then ratio-scales them (battle.service.ts:445, 477-484).
  const expectedHp = Math.min(
    afterDerived.maxHp,
    Math.max(1, Math.round(Number(first.hpAfter) * (afterDerived.maxHp / beforeDerived.maxHp))),
  );
  const expectedSp = Math.min(
    afterDerived.maxSp,
    Math.max(0, Math.round(Number(first.spAfter) * (afterDerived.maxSp / beforeDerived.maxSp))),
  );

  h.assertEqual(
    '§6.3 hpCurrent equals round(entry.hpAfter × newMaxHp/oldMaxHp), clamped — ratio-adjusted, not topped up',
    Number(after.hpCurrent),
    expectedHp,
    `entry.hpAfter=${first.hpAfter}, ${beforeDerived.maxHp} -> ${afterDerived.maxHp} (ratio ${(afterDerived.maxHp / beforeDerived.maxHp).toFixed(5)})`,
  );
  h.assertEqual(
    '§6.3 spCurrent equals round(entry.spAfter × newMaxSp/oldMaxSp), clamped — ratio-adjusted, not topped up',
    Number(after.spCurrent),
    expectedSp,
    `entry.spAfter=${first.spAfter}, ${beforeDerived.maxSp} -> ${afterDerived.maxSp} (ratio ${(afterDerived.maxSp / beforeDerived.maxSp).toFixed(5)})`,
  );
  h.assert(
    '§6.3 hpCurrent is strictly below the new maxHp — ratio-adjusted, never topped up',
    Number(after.hpCurrent) < afterDerived.maxHp,
    `hp ${after.hpCurrent}/${afterDerived.maxHp} (${((Number(after.hpCurrent) / afterDerived.maxHp) * 100).toFixed(1)}% of the new maximum); ` +
      `a top-up would have set it to ${afterDerived.maxHp}`,
  );

  /**
   * SPEC §6.3 asks for the same guarantee on SP, and the code does apply the
   * same ratio formula — but for THIS character the "strictly less than the new
   * maximum" half of the property is not exercised, because the engine refilled
   * SP during the fight before the level-up ever ran.
   *
   * `spRegenPerTick = 1 + floor(INT/2) + floor(maxSp*0.01)` is 3 at INT=5, and
   * every winning fight a default character can win runs at least 33 ticks, so
   * a character starting the chain at ANY SP finishes the entry at exactly
   * maxSp. The ratio step from 98 to 106 therefore lands precisely on the new
   * maximum. The level-up code did not top it up; the engine had already
   * refilled it. `assertSpNeverToppedUp()` below is the case that separates the
   * two explanations.
   */
  const spWasFullBeforeLevelUp = Number(first.spAfter) >= beforeDerived.maxSp;
  h.assert(
    '§6.3 spCurrent is exactly the ratio result (and is at the new maximum only because the engine refilled SP during the fight)',
    Number(after.spCurrent) === expectedSp && (spWasFullBeforeLevelUp ? Number(after.spCurrent) === afterDerived.maxSp : Number(after.spCurrent) < afterDerived.maxSp),
    `entry.spAfter=${first.spAfter} vs old maxSp ${beforeDerived.maxSp} (sp was ${spWasFullBeforeLevelUp ? 'ALREADY full when the level-up ran' : 'not full'}) ` +
      `→ ratio result ${expectedSp}, new maxSp ${afterDerived.maxSp}, actual ${after.spCurrent}; spRegenPerTick=${beforeDerived.spRegenPerTick}, battle ran ${first.log?.durationTicks} ticks`,
  );
  h.note(
    '§6.3 observation: this character cannot show the "never topped up" half of the SP guarantee, because every ' +
      `winning Green Grounds fight it can win lasts >= 33 ticks and spRegenPerTick is ${beforeDerived.spRegenPerTick}, ` +
      'so spAfter is always maxSp before the level-up runs and the ratio step lands on the new maximum. Scenario 4 ' +
      'below proves the SP half on a character whose fight is short enough for the regen window to stay open.',
  );
  h.assert(
    '§6.3 the cross-check against BattleEngine.calculateDerivedStats agrees with the engine used in-process',
    viaApiAfter.id === ctx.charId && Number(viaApiAfter.hpCurrent) === Number(after.hpCurrent) && Number(viaApiAfter.spCurrent) === Number(after.spCurrent),
    `GET /characters -> level=${viaApiAfter.level} hp=${viaApiAfter.hpCurrent} sp=${viaApiAfter.spCurrent}; DB -> level=${after.level} hp=${after.hpCurrent} sp=${after.spCurrent}`,
  );

  // Remaining XP: a single resolution subtracts only the current threshold; excess XP stays stored.
  const expectedRemainingXp = xpToNextLevel(Number(before.level)) - 1 + Number(first.xpGain) - xpToNextLevel(Number(before.level));
  h.assertEqual(
    'XP resolution preserves excess XP after the single allowed level-up',
    Number(after.xp),
    expectedRemainingXp,
    `seeded ${xpToNextLevel(Number(before.level)) - 1} + xpGain ${first.xpGain} - current-level xpToNext`,
  );

  h.note(
    'Divergence #3 (level-up ratio computed with an empty equipment argument) is no longer reachable from here: ' +
      'battle.service.ts:453-484 now derives both ends of the ratio from the real loadout, exactly as ' +
      'buildCharacterSnapshot() does. This scenario\'s character is unequipped, so the fix is invisible to it — ' +
      'scenario 3 below runs the same level-up on an EQUIPPED character, where the two readings differ by ' +
      'hundreds of HP, and asserts the equipment-aware one.',
  );

  return { before, after, beforeDerived, afterDerived, levelsGained, viaApiAfter, survivingIds, survivingJobIdsBefore };
}

// ---------------------------------------------------------------------------
//  3. §3.4 — the queue rebuild
// ---------------------------------------------------------------------------

async function assertQueueRebuild({ ctx, entries }, levelInfo) {
  const survivingIds = levelInfo.survivingIds;
  const survivingJobIds = levelInfo.survivingJobIdsBefore;

  h.assert(
    '§3.4 four surviving entries were queued behind the one being resolved',
    survivingIds.length === 4,
    `surviving entry ids: ${survivingIds.map((s) => s.slice(0, 8)).join(', ')}`,
  );

  const queue = await h.getUnresolvedEntries(ctx.charId);
  const queueIds = queue.map((e) => e.id);
  const survivorsStillPresent = survivingIds.filter((id) => queueIds.includes(id));

  h.assert(
    '§3.4 every surviving entry was discarded by the level-up',
    survivorsStillPresent.length === 0,
    survivorsStillPresent.length === 0
      ? `all 4 pre-level-up ids (${survivingIds.map((s) => s.slice(0, 8)).join(', ')}) are gone; the queue now holds ${queue.length} different ids`
      : `${survivorsStillPresent.length} of 4 survived the level-up`,
  );

  const viaApi = await h.getQueueViaApi(ctx.token);
  h.assert(
    '§6.3 GET /battles/queue returns 5 unresolved entries again',
    Array.isArray(viaApi) && viaApi.length === 5,
    `GET /battles/queue returned ${Array.isArray(viaApi) ? viaApi.length : typeof viaApi} entries`,
  );

  const rebuiltFirst = queue[0];
  const snapshot = rebuiltFirst?.log?.header?.characterSnapshot;
  h.assert(
    '§3.4 the first rebuilt entry\'s log.header.characterSnapshot reflects the NEW level\'s maxHp/maxSp',
    snapshot && snapshot.level === levelInfo.after.level && snapshot.maxHp === levelInfo.afterDerived.maxHp && snapshot.maxSp === levelInfo.afterDerived.maxSp,
    `rebuilt entry ${rebuiltFirst?.id} header.characterSnapshot = { level: ${snapshot?.level}, maxHp: ${snapshot?.maxHp}, maxSp: ${snapshot?.maxSp} } vs post-level-up level ${levelInfo.after.level} maxHp ${levelInfo.afterDerived.maxHp} maxSp ${levelInfo.afterDerived.maxSp}`,
  );
  h.assert(
    '§3.4 the rebuilt chain was simulated against the new stats, not the discarded ones',
    snapshot && snapshot.maxHp !== levelInfo.beforeDerived.maxHp,
    `rebuilt maxHp=${snapshot?.maxHp} vs the discarded chain's maxHp=${levelInfo.beforeDerived.maxHp}`,
  );

  // No BullMQ job may survive for a row that was deleted, or it would fire
  // against a row that no longer exists.
  const jobsNow = await h.bullJobIds();
  const orphaned = survivingJobIds.filter((id) => jobsNow.includes(id));
  h.assert(
    '§3.4 no BullMQ job remains for the discarded entries',
    orphaned.length === 0,
    orphaned.length === 0
      ? `none of the ${survivingJobIds.length} discarded job ids are still under bull:battle-queue:*`
      : `orphaned job ids still present: ${orphaned.join(', ')}`,
  );

  const rebuiltJobIds = jobsNow.filter((id) => queueIds.includes(id));
  h.assert(
    '§3.4 each rebuilt entry has a BullMQ job',
    rebuiltJobIds.length === queue.length,
    `${rebuiltJobIds.length} job(s) for ${queue.length} rebuilt entr${queue.length === 1 ? 'y' : 'ies'}`,
  );

  await h.clearQueue(ctx.charId);
  await h.clearBullJobs();
}

// ---------------------------------------------------------------------------
//  4. §6.3 — the multi-level case
// ---------------------------------------------------------------------------

/**
 * One resolve crossing TWO thresholds.
 *
 * design.md divergence #4: the code applies ONE ratio step across the whole
 * batch, from the stats before the first level-up to the stats after the last
 * one (battle.service.ts:453-484). For a single level-up that is exact; for a
 * multi-level gain it differs from compounding the ratio per level. The SPEC
 * does not say which is intended, so this asserts the CURRENT behaviour.
 */
async function assertMultiLevelScaling() {
  const label = 'multi-level';

  /**
   * Level 10 on purpose. From level 1 the two-threshold XP window is
   * [17+18, 17+18+19) = [35, 54) and no Green Grounds monster pays inside it
   * (the cheapest is mon_slime at 18, the rest are far above). At level 10 the
   * window is [30+32, 30+32+34) = [62, 96) and mon_thornsprout (64) /
   * mon_mudcrawler (89) both land in it, so one win crosses exactly two
   * thresholds. Green Grounds has no level gate, so this needs no map
   * privilege beyond seeding the level before the map entry.
   */
  const START_LEVEL = 10;
  const twoThresholdFloor = xpToNextLevel(START_LEVEL) + xpToNextLevel(START_LEVEL + 1);
  const threeThresholdCeiling = twoThresholdFloor + xpToNextLevel(START_LEVEL + 2);

  const { ctx, entries, first } = await buildSeededQueue({
    label,
    targetLevel: START_LEVEL,
    // Start badly damaged so the fight is a real fight and the post-fight HP is
    // well under the maximum — with a full-HP entry both readings of the
    // scaling rule clamp to the new max and become indistinguishable. The
    // values are returned to the builder, which is what seeds the character.
    pickKillIndex: ({ ctx: c, attributes, level }) => {
      const stats = BattleEngine.calculateDerivedStats(level, attributes, {});
      const hp = Math.max(1, Math.floor(stats.maxHp * 0.25));
      const sp = Math.max(1, Math.floor(stats.maxSp * 0.15));

      /**
       * Ranked by how LOW the fight leaves the character's HP, so the ratio
       * scaling is as far from the clamp as the encounters allow.
       */
      const candidates = [];
      for (let killIndex = 0; killIndex < 120; killIndex++) {
        const probe = simulateQueueStepAt({
          charId: c.charId, mapId: c.mapId, epoch: 0, killIndex, level, attributes, chainHp: hp, chainSp: sp,
        });
        if (probe.simulation.outcome !== 'win') continue;
        if (probe.simulation.hpAfter <= 0 || probe.simulation.spAfter <= 0) continue;
        if (probe.simulation.hpAfter >= stats.maxHp) continue;
        if (probe.rewards.xpGain < twoThresholdFloor || probe.rewards.xpGain >= threeThresholdCeiling) continue;
        candidates.push({ killIndex, ...probe, stats, hp, sp });
      }
      if (candidates.length === 0) {
        throw new Error(
          `[${label}] no Green Grounds kill index yields a survivable, DAMAGING win worth ` +
            `${twoThresholdFloor}..${threeThresholdCeiling - 1} XP from level ${level} at hp=${hp}/sp=${sp}`,
        );
      }
      candidates.sort((a, b) => a.simulation.hpAfter - b.simulation.hpAfter);
      const chosen = candidates[0];
      h.note(
        `[${label}] ${candidates.length} candidate kill index(es) in the XP window ` +
          `[${twoThresholdFloor}, ${threeThresholdCeiling}); chose ${chosen.killIndex} (${chosen.monster.id}, ` +
          `xp ${chosen.rewards.xpGain}) because it leaves the character lowest: hpAfter=${chosen.simulation.hpAfter} of maxHp ${stats.maxHp}`,
      );
      return chosen;
    },
  });

  const before = await h.getCharacterRow(ctx.charId);
  const beforeDerived = derivedStatsFor(before, Number(before.level));

  h.assert(
    '[multi-level] the entry left the character damaged, so the scaling was not clamped at the new maximum',
    Number(first.hpAfter) < beforeDerived.maxHp,
    `entry.hpAfter=${first.hpAfter} vs maxHp at level ${before.level} = ${beforeDerived.maxHp} ` +
      '(with a full-HP entry both scaling readings clamp to the new max and become indistinguishable)',
  );

  await h.setCharacterProgression(ctx.charId, { xp: xpToNextLevel(START_LEVEL) - 1 });
  await h.rewriteEndAtToPast(first.id, { secondsAgo: 5, startAtSecondsAgo: 600 });
  await h.enqueueResolveJob(first.id);

  const after = await h.waitFor(
    'the two-threshold resolve to land',
    async () => {
      const r = await h.getCharacterRow(ctx.charId);
      return Number(r.level) > Number(before.level) ? r : null;
    },
    60_000,
  );
  const levelsGained = Number(after.level) - Number(before.level);
  const afterDerived = derivedStatsFor(after, Number(after.level));

  h.divergence(
    4,
    'Multi-level scaling is ONE ratio step from the pre-first-level stats to the post-last-level stats ' +
      '(battle.service.ts:453-484), not one step per level. Settled 2026-09-28 as a SPEC §6.3 footnote with no code ' +
      'change: the two readings are unobservable in hpCurrent while maxHp is linear in level, so the choice can be ' +
      'deferred. This asserts the code as written and prints the compounded alternative alongside it.',
  );

  const oneStepHp = Math.min(
    afterDerived.maxHp,
    Math.max(1, Math.round(Number(first.hpAfter) * (afterDerived.maxHp / beforeDerived.maxHp))),
  );
  const compoundedHp = (() => {
    let hp = Number(first.hpAfter);
    for (let level = Number(before.level); level < Number(after.level); level++) {
      const from = derivedStatsFor(before, level);
      const to = derivedStatsFor(before, level + 1);
      hp = Math.min(to.maxHp, Math.max(1, Math.round(hp * (to.maxHp / from.maxHp))));
    }
    return hp;
  })();

  h.assert(
    '[xp-resolution] one resolve can increase level by at most one',
    levelsGained === 1,
    `seeded xp = xpToNext(${START_LEVEL}) - 1 = ${xpToNextLevel(START_LEVEL) - 1} + entry xpGain ${first.xpGain} = ${xpToNextLevel(START_LEVEL) - 1 + Number(first.xpGain)}; ` +
      `the entry was selected from the historical multi-threshold window [${twoThresholdFloor}, ${threeThresholdCeiling}), but the authoritative resolver now caps the resolution at +1 level → ${before.level} -> ${after.level}`,
  );
  h.assert(
    '[xp-resolution] unspentAttributePoints increased by exactly 5 for the single level gained',
    Number(after.unspentAttributePoints) - Number(before.unspentAttributePoints) === 5,
    `${before.unspentAttributePoints} -> ${after.unspentAttributePoints}`,
  );
  h.assertEqual(
    '[multi-level] hpCurrent matches the SINGLE-step ratio from the pre-gain level to the post-gain level (divergence #4)',
    Number(after.hpCurrent),
    oneStepHp,
    `one step (asserted) = ${oneStepHp}; per-level compounding (rejected alternative) = ${compoundedHp}; ` +
      `entry.hpAfter=${first.hpAfter}, maxHp ${beforeDerived.maxHp} -> ${afterDerived.maxHp}`,
  );
  h.note(
    `[multi-level] the two readings of the SPEC §6.3 multi-level rule differ by ${Math.abs(oneStepHp - compoundedHp)} HP here ` +
      `(one step ${oneStepHp} vs compounded ${compoundedHp}). That gap is small because maxHp = floor(80 + VIT*12 + level*18) ` +
      'is LINEAR in level, so compounding telescopes to the same product as a single step and only the Math.round at each ' +
      'intermediate level can differ. Consequence for the open question in design.md: with the current formulas the ' +
      '"one step or compounded per level" decision is not observable in hpCurrent, and only becomes observable if maxHp ' +
      'or maxSp ever gains a non-linear level term.',
  );

  await h.drainQueue(ctx.charId);
  void entries;
}

// ---------------------------------------------------------------------------
//  5. §6.3 on an EQUIPPED character — the ratio is derived from the real loadout
// ---------------------------------------------------------------------------

/**
 * `items.json` tier-1 physical armour: `levelReq 1`, so a level-1 character can
 * wear it, and each piece carries `VIT + 1` plus flat DEF. VIT feeds `maxHp`
 * directly (`maxHp = floor(80 + VIT*12 + level*18)`), which is what the level-up
 * ratio is taken over.
 */
const T1_ARMOR = [
  { slot: 'head', itemId: 'equip_head_phys_t1', def: 4, vit: 1 },
  { slot: 'body', itemId: 'equip_body_phys_t1', def: 8, vit: 1 },
  { slot: 'cape', itemId: 'equip_cape_phys_t1', def: 3, vit: 1 },
];

/**
 * SPEC §10.3: every equipment piece except shoes rolls ONE attribute for +1..6
 * at drop time and stores it forever in `instanceData`. `equipItem()` nulls
 * `instanceData` on every write (equipment.service.ts:266), so the roll is
 * seeded directly — it is permanent game state, not something the endpoint can
 * express. Three VIT+6 rolls take the total VIT bonus from 3 to 21.
 */
const EQUIP_ROLL = { rolledAttribute: 'VIT', rolledValue: 6 };

/**
 * A level-1 character has exactly 5 unspent points (SPEC §6.3). Spending all of
 * them in STR is the one legal allocation that shortens a Green Grounds fight
 * enough to leave both HP and SP below their maxima at the end.
 */
const SPENT_IN_STR = 10;

/**
 * 600 encounter indices rather than 120. The new scenarios need a fight that is
 * both winnable and SHORT, which is a much narrower slice of the stream than
 * "winnable and damaging" — roughly 100 qualifying indices per character here,
 * against about 1 in 40 for the SP condition alone over 120 indices, so a
 * 120-wide scan would fail often enough to be a flaky test rather than an
 * honest one. `mapKillCount` is just an index into the deterministic stream
 * (SPEC §11.2) and the §11.2 epoch rollover is at 10,000, so a wide scan costs
 * nothing but CPU.
 */
const WIDE_SCAN = 600;

/**
 * The level-up ratio on an equipped character.
 *
 * `maxHp = floor(80 + VIT*12 + level*18)` and the armour below adds VIT 21, so
 * the equipped maxima are ~2.6x the bare ones and the two readings of the rule
 * are far apart: with `hpAfter` in the 300s the equipment-aware ratio lands
 * around 360, while the equipment-blind one (`{}` for both ends of the ratio,
 * which is what battle.service.ts:453-484 used to pass) computes 349 x
 * 176/158 = 389 and then clamps it to the blind new maximum of 176. The
 * scenario is therefore not a near-miss check — the old code cannot produce the
 * asserted value.
 */
async function assertEquippedLevelUpRatio() {
  const label = 'equipped';
  const ctx = await h.createCharacter({ enterMap: false, level: 1 });
  console.log(`\n[${label}] character ${ctx.charId} (not yet on a map)`);
  await h.drainQueue(ctx.charId);

  for (const piece of T1_ARMOR) {
    const res = await h.request('PUT', '/equipment/equip', { slot: piece.slot, itemId: piece.itemId }, ctx.token);
    if (res.status >= 400) {
      throw new Error(`[${label}] PUT /equipment/equip ${piece.itemId} -> ${res.status} ${res.raw.slice(0, 200)}`);
    }
  }
  for (const piece of T1_ARMOR) {
    await h.setEquipmentRoll(ctx.charId, piece.slot, EQUIP_ROLL.rolledAttribute, EQUIP_ROLL.rolledValue);
  }

  const equipmentStats = await fetchEquipmentStats(ctx.token);
  const expectedVit = T1_ARMOR.length * (T1_ARMOR[0].vit + EQUIP_ROLL.rolledValue);
  const expectedDef = T1_ARMOR.reduce((sum, p) => sum + p.def, 0);
  h.assert(
    '§10.3 the character really is equipped: the API reports the summed VIT bonus and DEF',
    Number(equipmentStats.statBonus?.VIT) === expectedVit && Number(equipmentStats.def) === expectedDef,
    `GET /equipment/stats/total -> statBonus=${JSON.stringify(equipmentStats.statBonus)} def=${equipmentStats.def}; ` +
      `expected VIT ${expectedVit} (${T1_ARMOR.length} x (${T1_ARMOR[0].vit} fixed + ${EQUIP_ROLL.rolledValue} rolled)) and def ${expectedDef}`,
  );

  await h.setCharacterAttributes(ctx.charId, { str: SPENT_IN_STR });
  await h.setCharacterProgression(ctx.charId, {
    level: 1, xp: 0, unspentAttributePoints: 0, hpCurrent: 5, spCurrent: 0,
  });

  const row = await h.getCharacterRow(ctx.charId);
  const attributes = attributesOf(row);
  const equippedAttributes = h.attributesWithEquipment(attributes, equipmentStats);
  const equipmentArgs = h.equipmentArgsOf(equipmentStats);
  const beforeDerived = BattleEngine.calculateDerivedStats(1, equippedAttributes, equipmentArgs);
  const afterDerived = BattleEngine.calculateDerivedStats(2, equippedAttributes, equipmentArgs);
  // The reading the resolver used before the fix: bare attributes, `{}` gear.
  const blindBefore = BattleEngine.calculateDerivedStats(1, attributes, {});
  const blindAfter = BattleEngine.calculateDerivedStats(2, attributes, {});

  h.assert(
    '§6.3 the equipment actually moves maxHp, so this scenario can tell the two readings apart',
    beforeDerived.maxHp > blindBefore.maxHp,
    `equipped maxHp=${beforeDerived.maxHp} (VIT ${equippedAttributes.vit} = ${attributes.vit} base + ${equipmentStats.statBonus.VIT} from gear) ` +
      `vs equipment-blind maxHp=${blindBefore.maxHp} (VIT ${attributes.vit}); a character whose gear did not move VIT would ` +
      'make the ratio assertion below vacuous',
  );

  const pick = findKillIndex({
    charId: ctx.charId, mapId: ctx.mapId, epoch: 0, level: 1, attributes,
    equipmentStats, startHp: 5, startSp: 0, scan: WIDE_SCAN,
    // Both pools must still be short of their maximum when the level-up runs,
    // otherwise the ratio result clamps to the new maximum in either reading.
    accept: (probe, levelStats) =>
      probe.simulation.hpAfter < levelStats.maxHp && probe.simulation.spAfter < levelStats.maxSp,
  });
  if (!pick) {
    throw new Error(
      `[${label}] no kill index in 0..${WIDE_SCAN - 1} yields a winnable fight that leaves HP and SP below their ` +
        `maxima from hp=5/sp=0 at level 1 (equipped maxHp ${beforeDerived.maxHp}, maxSp ${beforeDerived.maxSp})`,
    );
  }
  h.note(
    `[${label}] pinned mapKillCount=${pick.killIndex} -> ${pick.monster.id} over ${pick.simulation.durationTicks} ticks; ` +
      `preview hpAfter=${pick.simulation.hpAfter}/${beforeDerived.maxHp} spAfter=${pick.simulation.spAfter}/${beforeDerived.maxSp} xp=${pick.rewards.xpGain}`,
  );

  await h.setKillCounter(ctx.charId, ctx.mapId, { mapKillCount: pick.killIndex, epoch: 0, perMonsterKillCount: {} });
  h.assertProgressionIntact(
    ctx.charId,
    { level: 1, xp: 0, hpCurrent: 5, spCurrent: 0 },
    `[${label}] after pinning the encounter stream`,
  );

  const entered = await h.request('POST', `/maps/${ctx.mapId}/enter`, {}, ctx.token);
  if (entered.status >= 400) {
    throw new Error(`[${label}] POST /maps/${ctx.mapId}/enter -> ${entered.status} ${entered.raw.slice(0, 200)}`);
  }
  h.assertProgressionIntact(
    ctx.charId,
    { level: 1, xp: 0, hpCurrent: 5, spCurrent: 0 },
    `[${label}] after the map entry that built the queue`,
  );

  const entries = await h.waitFor(
    'a 5-deep queue to exist',
    async () => {
      const q = await h.getUnresolvedEntries(ctx.charId);
      return q.length >= 5 ? q : null;
    },
    30_000,
  );
  const first = entries[0];
  h.assert(
    '§7.4.2 the seeded first entry is a win, so the resolve takes the payout path',
    first.outcome === 'win',
    `first entry ${first.id} vs ${first.monsterId} outcome=${first.outcome} hpAfter=${first.hpAfter}/${beforeDerived.maxHp} ` +
      `spAfter=${first.spAfter}/${beforeDerived.maxSp} (previewed hpAfter=${pick.simulation.hpAfter} spAfter=${pick.simulation.spAfter})`,
  );

  // The queue was built by the real API, so its log header carries the stats the
  // API derived — which already includes the equipment (buildCharacterSnapshot).
  const snapshot = first.log?.header?.characterSnapshot;
  h.assert(
    '§6.3 the entry itself was simulated against the EQUIPPED stats, not the bare ones',
    snapshot && snapshot.maxHp === beforeDerived.maxHp,
    `entry log.header.characterSnapshot.maxHp=${snapshot?.maxHp} (level ${snapshot?.level}) vs the equipment-aware maxHp ${beforeDerived.maxHp}; ` +
      `the equipment-blind reading would say ${blindBefore.maxHp}`,
  );

  await h.setCharacterProgression(ctx.charId, { xp: xpToNextLevel(1) - 1 });
  await h.rewriteEndAtToPast(first.id, { secondsAgo: 5, startAtSecondsAgo: 90 });
  await h.enqueueResolveJob(first.id);

  const after = await h.waitFor(
    'the equipped level-up resolve to land',
    async () => {
      const r = await h.getCharacterRow(ctx.charId);
      return Number(r.level) > 1 ? r : null;
    },
    60_000,
  );
  await h.waitFor(
    'the queue to be rebuilt to 5 entries',
    async () => {
      const q = await h.getUnresolvedEntries(ctx.charId);
      return q.length === 5 ? q : null;
    },
    60_000,
  );

  const expectedHp = Math.min(
    afterDerived.maxHp,
    Math.max(1, Math.round(Number(first.hpAfter) * (afterDerived.maxHp / beforeDerived.maxHp))),
  );
  const blindHp = Math.min(
    blindAfter.maxHp,
    Math.max(1, Math.round(Number(first.hpAfter) * (blindAfter.maxHp / blindBefore.maxHp))),
  );
  const expectedSp = Math.min(
    afterDerived.maxSp,
    Math.max(0, Math.round(Number(first.spAfter) * (afterDerived.maxSp / beforeDerived.maxSp))),
  );

  h.assertEqual(
    '§6.3 hpCurrent is ratio-adjusted with the REAL loadout: round(entry.hpAfter × newMaxHp/oldMaxHp) on the equipment-aware maxima',
    Number(after.hpCurrent),
    expectedHp,
    `entry.hpAfter=${first.hpAfter}; equipped maxHp ${beforeDerived.maxHp} -> ${afterDerived.maxHp} ` +
      `(ratio ${(afterDerived.maxHp / beforeDerived.maxHp).toFixed(5)}), so ${first.hpAfter} x ratio = ${expectedHp}. ` +
      `The equipment-blind reading gives ${blindHp}.`,
  );
  h.assert(
    '§6.3 the two readings are far enough apart that this assertion is not a near-miss',
    Math.abs(expectedHp - blindHp) >= 5,
    `equipment-aware hpCurrent would be ${expectedHp}, equipment-blind ${blindHp} (gap ${Math.abs(expectedHp - blindHp)} HP); ` +
      'a gap under 5 HP would let a rounding accident masquerade as a pass',
  );
  h.assert(
    '§6.3 hpCurrent is strictly below the new maxHp — ratio-adjusted, never topped up',
    Number(after.hpCurrent) < afterDerived.maxHp,
    `hp ${after.hpCurrent}/${afterDerived.maxHp} (${((Number(after.hpCurrent) / afterDerived.maxHp) * 100).toFixed(1)}% of the new maximum); ` +
      `a top-up would have set it to ${afterDerived.maxHp}`,
  );
  h.assertEqual(
    '§6.3 spCurrent is ratio-adjusted on the same pass (the loadout moves no INT, so both readings agree here)',
    Number(after.spCurrent),
    expectedSp,
    `entry.spAfter=${first.spAfter}; maxSp ${beforeDerived.maxSp} -> ${afterDerived.maxSp} (ratio ${(afterDerived.maxSp / beforeDerived.maxSp).toFixed(5)}), ` +
      `so ${first.spAfter} x ratio = ${expectedSp}, and it is ${((Number(after.spCurrent) / afterDerived.maxSp) * 100).toFixed(1)}% of the new maximum`,
  );

  // The rebuild is simulated by the same code path that fixed the ratio, so the
  // new chain's header must carry the same equipment-aware maxima.
  const rebuilt = await h.getUnresolvedEntries(ctx.charId);
  const rebuiltSnapshot = rebuilt[0]?.log?.header?.characterSnapshot;
  h.assert(
    '§6.3 the rebuilt chain is simulated against the equipment-aware maxima of the new level',
    rebuiltSnapshot && rebuiltSnapshot.level === Number(after.level) && rebuiltSnapshot.maxHp === afterDerived.maxHp,
    `rebuilt entry ${rebuilt[0]?.id} header.characterSnapshot = { level: ${rebuiltSnapshot?.level}, maxHp: ${rebuiltSnapshot?.maxHp} } ` +
      `vs post-level-up level ${after.level} / equipment-aware maxHp ${afterDerived.maxHp}`,
  );

  await h.drainQueue(ctx.charId);
  return { expectedHp, blindHp, beforeDerived, afterDerived };
}

// ---------------------------------------------------------------------------
//  6. §6.3 — "never topped up" on SP, proved on a real case
// ---------------------------------------------------------------------------

/**
 * The SP half of the §6.3 guarantee, on a character whose fight is short enough
 * for the regen window to stay open.
 *
 * The gap this closes (STATUS.md §6.4): every winning Green Grounds fight a
 * DEFAULT character can win runs 33+ ticks and `spRegenPerTick` is 3, so
 * `spAfter` is always `maxSp` and the ratio step lands exactly on the new
 * maximum. The formula was assertable; "strictly below the new maximum" was
 * not. Two changes make it observable, and both are ordinary game state:
 *
 *   - the character spends its 5 unspent points in STR (SPEC §6.3), which raises
 *     atk from 13 to 24 and cuts a slime fight from 39 ticks to 23;
 *   - the chain starts at `spCurrent = 0`, so 23 ticks x 3 SP of regen reaches
 *     69 — under the level-1 maxSp of 98.
 *
 * The result is an entry that hands the resolver a genuinely partial SP pool, so
 * "not topped up" and "the engine refilled it first" are distinguishable.
 */
async function assertSpNeverToppedUp() {
  const label = 'sp-never-topped-up';
  const ctx = await h.createCharacter({ enterMap: false, level: 1 });
  console.log(`\n[${label}] character ${ctx.charId} (not yet on a map)`);
  await h.drainQueue(ctx.charId);

  await h.setCharacterAttributes(ctx.charId, { str: SPENT_IN_STR });
  await h.setCharacterProgression(ctx.charId, {
    level: 1, xp: 0, unspentAttributePoints: 0, hpCurrent: 80, spCurrent: 0,
  });

  const row = await h.getCharacterRow(ctx.charId);
  const attributes = attributesOf(row);
  const beforeDerived = derivedStatsFor(row, 1);
  const afterDerived = derivedStatsFor(row, 2);

  const pick = findKillIndex({
    charId: ctx.charId, mapId: ctx.mapId, epoch: 0, level: 1, attributes,
    startHp: 80, startSp: 0, scan: WIDE_SCAN,
    accept: (probe, levelStats) => probe.simulation.spAfter < levelStats.maxSp,
  });
  if (!pick) {
    throw new Error(
      `[${label}] no kill index in 0..${WIDE_SCAN - 1} yields a winnable fight shorter than the SP regen window ` +
        `(maxSp ${beforeDerived.maxSp}, spRegenPerTick ${beforeDerived.spRegenPerTick}) from sp=0 at level 1`,
    );
  }
  h.note(
    `[${label}] pinned mapKillCount=${pick.killIndex} -> ${pick.monster.id} over ${pick.simulation.durationTicks} ticks; ` +
      `preview spAfter=${pick.simulation.spAfter}/${beforeDerived.maxSp} hpAfter=${pick.simulation.hpAfter}/${beforeDerived.maxHp} ` +
      `(spRegenPerTick ${beforeDerived.spRegenPerTick} x ${pick.simulation.durationTicks} ticks = ` +
      `${pick.simulation.durationTicks * beforeDerived.spRegenPerTick} SP, which is why the pool is still short)`,
  );

  await h.setKillCounter(ctx.charId, ctx.mapId, { mapKillCount: pick.killIndex, epoch: 0, perMonsterKillCount: {} });
  h.assertProgressionIntact(
    ctx.charId,
    { level: 1, xp: 0, hpCurrent: 80, spCurrent: 0 },
    `[${label}] after pinning the encounter stream`,
  );

  const entered = await h.request('POST', `/maps/${ctx.mapId}/enter`, {}, ctx.token);
  if (entered.status >= 400) {
    throw new Error(`[${label}] POST /maps/${ctx.mapId}/enter -> ${entered.status} ${entered.raw.slice(0, 200)}`);
  }
  h.assertProgressionIntact(
    ctx.charId,
    { level: 1, xp: 0, hpCurrent: 80, spCurrent: 0 },
    `[${label}] after the map entry that built the queue`,
  );

  const entries = await h.waitFor(
    'a 5-deep queue to exist',
    async () => {
      const q = await h.getUnresolvedEntries(ctx.charId);
      return q.length >= 5 ? q : null;
    },
    30_000,
  );
  const first = entries[0];

  h.assert(
    '§6.3 the entry really did hand the resolver a partial SP pool (spAfter < maxSp) — otherwise "never topped up" is unobservable',
    first.outcome === 'win' && Number(first.spAfter) < beforeDerived.maxSp,
    `entry ${first.id} vs ${first.monsterId} outcome=${first.outcome} over ${first.log?.durationTicks} ticks: ` +
      `spAfter=${first.spAfter} against maxSp ${beforeDerived.maxSp} at level 1 (spRegenPerTick ${beforeDerived.spRegenPerTick}, ` +
      `chain started at sp=0). Preview agreed: spAfter=${pick.simulation.spAfter}.`,
  );

  await h.setCharacterProgression(ctx.charId, { xp: xpToNextLevel(1) - 1 });
  await h.rewriteEndAtToPast(first.id, { secondsAgo: 5, startAtSecondsAgo: 90 });
  await h.enqueueResolveJob(first.id);

  const after = await h.waitFor(
    'the SP level-up resolve to land',
    async () => {
      const r = await h.getCharacterRow(ctx.charId);
      return Number(r.level) > 1 ? r : null;
    },
    60_000,
  );
  await h.waitFor(
    'the queue to be rebuilt to 5 entries',
    async () => {
      const q = await h.getUnresolvedEntries(ctx.charId);
      return q.length === 5 ? q : null;
    },
    60_000,
  );

  const expectedSp = Math.min(
    afterDerived.maxSp,
    Math.max(0, Math.round(Number(first.spAfter) * (afterDerived.maxSp / beforeDerived.maxSp))),
  );

  h.assertEqual(
    '§6.3 spCurrent is ratio-adjusted, not topped up: round(entry.spAfter × newMaxSp/oldMaxSp)',
    Number(after.spCurrent),
    expectedSp,
    `entry.spAfter=${first.spAfter}; maxSp ${beforeDerived.maxSp} -> ${afterDerived.maxSp} ` +
      `(ratio ${(afterDerived.maxSp / beforeDerived.maxSp).toFixed(5)}), so ${first.spAfter} x ratio = ${expectedSp}`,
  );
  h.assert(
    '§6.3 spCurrent is STRICTLY below the new maxSp — the level-up did not top the pool up',
    Number(after.spCurrent) < afterDerived.maxSp,
    `sp ${after.spCurrent}/${afterDerived.maxSp} (${((Number(after.spCurrent) / afterDerived.maxSp) * 100).toFixed(1)}% of the new maximum) ` +
      `after a ${first.log?.durationTicks}-tick fight that ended with ${first.spAfter}/${beforeDerived.maxSp} SP. ` +
      `A top-up would have set it to ${afterDerived.maxSp}.`,
  );
  h.assert(
    '§6.3 the SP percentage of the maximum is preserved across the level-up, not raised to 100%',
    Math.abs(Number(after.spCurrent) / afterDerived.maxSp - Number(first.spAfter) / beforeDerived.maxSp) < 0.01,
    `before: ${first.spAfter}/${beforeDerived.maxSp} = ${((Number(first.spAfter) / beforeDerived.maxSp) * 100).toFixed(2)}%; ` +
      `after: ${after.spCurrent}/${afterDerived.maxSp} = ${((Number(after.spCurrent) / afterDerived.maxSp) * 100).toFixed(2)}%`,
  );
  h.assert(
    '§6.3 the same resolve kept HP ratio-adjusted too, so the SP result is not a coincidence of a different code path',
    Number(after.hpCurrent) === Math.min(
      afterDerived.maxHp,
      Math.max(1, Math.round(Number(first.hpAfter) * (afterDerived.maxHp / beforeDerived.maxHp))),
    ),
    `entry.hpAfter=${first.hpAfter}, maxHp ${beforeDerived.maxHp} -> ${afterDerived.maxHp}, hpCurrent=${after.hpCurrent}`,
  );

  await h.drainQueue(ctx.charId);
}

async function main() {
  console.log('=== Phase 3 · Level-up mid-queue (SPEC §6.3, §3.4) ===');
  await h.preflight();

  console.log('\n--- 1. Single level-up mid-queue (SPEC §6.3) ---');
  const single = await setupScenario({ label: 'single', targetLevel: 1, searchKillIndex: null });
  h.assert(
    '§7.4.2 the seeded first entry is a win, so the character does not die before the level-up resolves',
    single.first.outcome === 'win',
    `first entry ${single.first.id} vs ${single.first.monsterId} has outcome=${single.first.outcome} (a level-1 character loses most fights organically — STATUS.md Issue #2 — so the kill counter is pinned to make this a known win)`,
  );
  const levelInfo = await assertLevelUpEffects(single, 1);
  await assertQueueRebuild(single, levelInfo);

  console.log('\n--- 2. Two level-ups in one resolve (SPEC §6.3, divergence #4) ---');
  await assertMultiLevelScaling();

  console.log('\n--- 3. Level-up ratio on an EQUIPPED character (SPEC §6.3, divergence #3) ---');
  await assertEquippedLevelUpRatio();

  console.log('\n--- 4. SP is never topped up by a level-up (SPEC §6.3) ---');
  await assertSpNeverToppedUp();

  await h.closeQueueAndRedis();
  h.summarize('Level-up mid-queue');
}

main().catch((error) => {
  console.error('FATAL:', error);
  h.closeQueueAndRedis().finally(() => process.exit(1));
});
