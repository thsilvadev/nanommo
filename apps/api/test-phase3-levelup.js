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
 * SPEC §6.3 / design.md divergence #3: the level-up ratio is computed with an
 * EMPTY equipment argument (battle.service.ts:462-463), so it is reproduced
 * here with `{}` too. `buildCharacterSnapshot()` passes real equipment stats,
 * so on an equipped character the two disagree — that is divergence #3, and
 * this script asserts the code's current behaviour.
 */
function derivedStatsFor(row, level) {
  return BattleEngine.calculateDerivedStats(
    level,
    {
      str: Number(row.str),
      agi: Number(row.agi),
      dex: Number(row.dex),
      vit: Number(row.vit),
      int: Number(row.int),
      sor: Number(row.sor),
    },
    {},
  );
}

/**
 * Find a kill index whose first battle (a) is a win, (b) leaves the character
 * below full HP *and* full SP so the ratio scaling is visible on both, and
 * (c) grants an xpReward small enough that seeding `xp = xpToNext(1) - 1`
 * crosses exactly one threshold.
 *
 * Constraint (b) matters for HP: `mon_slime` is a 34-tick fight and
 * `hpRegenPerTick` refills over the fight, so a starting HP at the maximum
 * yields an `hpAfter` at the maximum, and the resulting `hpCurrent` would equal
 * the new maxHp — the "not topped up" assertion would then pass or fail for the
 * wrong reason.
 *
 * The same constraint is deliberately NOT applied to SP, because it is
 * unsatisfiable: every winning fight in Green Grounds runs at least 33 ticks
 * and `spRegenPerTick` is 3, so a character that starts the chain at any SP
 * finishes the fight at full SP. That is recorded as an observation below
 * rather than worked around.
 */
function findSingleLevelUpKillIndex({ charId, mapId, epoch, level, attributes }) {
  const needed = xpToNextLevel(level);
  const nextNeeded = xpToNextLevel(level + 1);
  const levelStats = BattleEngine.calculateDerivedStats(level, attributes, {});

  for (let killIndex = 0; killIndex < 120; killIndex++) {
    const { monster, simulation, rewards } = simulateQueueStepAt({
      charId, mapId, epoch, killIndex, level, attributes, chainHp: SEED_HP, chainSp: SEED_SP,
    });
    if (simulation.outcome !== 'win') continue;
    if (simulation.hpAfter <= 0 || simulation.spAfter <= 0) continue;
    if (simulation.hpAfter >= levelStats.maxHp) continue;
    // `xp = needed - 1`, then `xp += gain`, then one subtraction of `needed`
    // must leave less than `nextNeeded` — i.e. exactly one level-up.
    const remainder = needed - 1 + rewards.xpGain - needed;
    if (remainder >= nextNeeded) continue;
    return { killIndex, monster, simulation, rewards, needed, nextNeeded, levelStats };
  }
  return null;
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
async function buildSeededQueue({ label, targetLevel, pickKillIndex, startHp, startSp }) {
  const ctx = await h.createCharacter({ enterMap: false, level: targetLevel });
  console.log(`\n[${label}] character ${ctx.charId} (not yet on a map)`);

  await h.drainQueue(ctx.charId);
  const row = await h.getCharacterRow(ctx.charId);
  const attributes = attributesOf(row);

  // `pickKillIndex` may choose the starting HP/SP itself (the multi-level case
  // needs a level-scaled value), so it is resolved before anything is seeded.
  const pick = await pickKillIndex({ ctx, attributes, level: targetLevel, startHp, startSp });
  const hp = pick.hp ?? startHp ?? SEED_HP;
  const sp = pick.sp ?? startSp ?? SEED_SP;
  const seeded = { level: targetLevel, xp: 0, hpCurrent: hp, spCurrent: sp };

  await h.setCharacterProgression(ctx.charId, seeded);
  const stats = derivedStatsFor(row, targetLevel);
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
  // FIRST, then ratio-scales them (battle.service.ts:433, 465-472).
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
   * same ratio formula — but the "strictly less than the new maximum" half of
   * that property is UNOBSERVABLE through the queue rather than violated.
   *
   * `spRegenPerTick = 1 + floor(INT/2) + floor(maxSp/2%)` is 3 at INT=5, and
   * every winning fight in Green Grounds runs at least 33 ticks, so a character
   * starting the chain at ANY SP finishes the entry at exactly maxSp. The ratio
   * step from 98 to 106 therefore lands precisely on the new maximum. The
   * level-up code did not top it up; the engine had already refilled it.
   */
  const spWasFullBeforeLevelUp = Number(first.spAfter) >= beforeDerived.maxSp;
  h.assert(
    '§6.3 spCurrent is exactly the ratio result (and is at the new maximum only because the engine refilled SP during the fight)',
    Number(after.spCurrent) === expectedSp && (spWasFullBeforeLevelUp ? Number(after.spCurrent) === afterDerived.maxSp : Number(after.spCurrent) < afterDerived.maxSp),
    `entry.spAfter=${first.spAfter} vs old maxSp ${beforeDerived.maxSp} (sp was ${spWasFullBeforeLevelUp ? 'ALREADY full when the level-up ran' : 'not full'}) ` +
      `→ ratio result ${expectedSp}, new maxSp ${afterDerived.maxSp}, actual ${after.spCurrent}; spRegenPerTick=${beforeDerived.spRegenPerTick}, battle ran ${first.log?.durationTicks} ticks`,
  );
  h.note(
    '§6.3 observation (not a divergence, but it limits what the suite can prove): the "never topped up" guarantee is ' +
      `demonstrable on HP but not on SP through the queue. Every winning Green Grounds fight lasts >= 33 ticks and ` +
      `spRegenPerTick is ${beforeDerived.spRegenPerTick}, so spAfter is always maxSp before the level-up runs and the ratio ` +
      'step lands on the new maximum. Proving the SP half would need a fight shorter than the regen window, which no ' +
      'winnable Green Grounds encounter provides.',
  );
  h.assert(
    '§6.3 the cross-check against BattleEngine.calculateDerivedStats agrees with the engine used in-process',
    viaApiAfter.id === ctx.charId && Number(viaApiAfter.hpCurrent) === Number(after.hpCurrent) && Number(viaApiAfter.spCurrent) === Number(after.spCurrent),
    `GET /characters -> level=${viaApiAfter.level} hp=${viaApiAfter.hpCurrent} sp=${viaApiAfter.spCurrent}; DB -> level=${after.level} hp=${after.hpCurrent} sp=${after.spCurrent}`,
  );

  // Remaining XP: the level-up loop subtracts xpToNext once per threshold.
  const expectedRemainingXp = xpToNextLevel(Number(before.level)) - 1 + Number(first.xpGain) - levelsGained * xpToNextLevel(Number(before.level) + levelsGained - 1);
  h.assertEqual(
    '§4.2 xp is XP toward the next level: the loop subtracted xpToNext once per threshold',
    Number(after.xp),
    expectedRemainingXp,
    `seeded ${xpToNextLevel(Number(before.level)) - 1} + xpGain ${first.xpGain} - ${levelsGained} × xpToNext`,
  );

  h.divergence(
    3,
    'The ratio above was computed with an EMPTY equipment argument, matching battle.service.ts:462-463. ' +
      'buildCharacterSnapshot() (battle.service.ts:144-160) passes real equipmentStats, so on an equipped character ' +
      'the scaled HP is off by the equipment contribution. Masked here because this character is unequipped, exactly ' +
      'as design.md divergence #3 describes.',
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
 * one (battle.service.ts:453-472). For a single level-up that is exact; for a
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
      '(battle.service.ts:453-472), not one step per level. The SPEC does not state which is intended, so this ' +
      'asserts the code as written and prints the compounded alternative alongside it.',
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
    '[multi-level] one resolve crossed two level thresholds',
    levelsGained === 2,
    `seeded xp = xpToNext(${START_LEVEL}) - 1 = ${xpToNextLevel(START_LEVEL) - 1} + entry xpGain ${first.xpGain} = ${xpToNextLevel(START_LEVEL) - 1 + Number(first.xpGain)}; ` +
      `two-threshold window was [${twoThresholdFloor}, ${threeThresholdCeiling}) → ${levelsGained} threshold(s) crossed → level ${before.level} -> ${after.level}`,
  );
  h.assert(
    '[multi-level] unspentAttributePoints increased by exactly 10 (5 per level)',
    Number(after.unspentAttributePoints) - Number(before.unspentAttributePoints) === 10,
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

  await h.closeQueueAndRedis();
  h.summarize('Level-up mid-queue');
}

main().catch((error) => {
  console.error('FATAL:', error);
  h.closeQueueAndRedis().finally(() => process.exit(1));
});
