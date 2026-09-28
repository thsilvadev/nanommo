# Proposal

## Why

The grind loop's happy path is verified (STATUS.md §7: register → attribute allocation → map entry → 5-deep queue → BullMQ resolve → replenish, all passing against docker-compose). Everything that makes the loop *hard* is unverified: level-up mid-queue, death, determinism, idempotent resolution, crash recovery, and gambit legality.

That gap is not academic. Determinism (§3.1) is the project's central promise, and `resolveBattle()` is reached from two independent callers — the BullMQ delayed job and the boot recovery pass — so double-application is a live hazard, not a hypothetical. STATUS.md currently asserts these behaviours as "Tested" based on evidence from prior sessions that is not reproducible from any committed script; `apps/api` has `"test": "jest"` but no jest config, no test directory, and `npx jest --listTests` returns zero files. Phase 3 converts those claims into a re-runnable suite that fails loudly when a guarantee regresses.

## What Changes

- Add a Phase 3 verification suite for the grind loop, following the project's existing ad-hoc Node-script harness pattern (`apps/api/test-s63.js`: HTTP + `pg` + `ioredis` against docker-compose) rather than introducing Jest or any new test infrastructure or dependency.
- Six verification scenarios, one script each, sharing a common bootstrap helper (register → bypass email verification → allocate attributes → enter map):
  1. **Level-up mid-queue** — a resolve that crosses `xpToNextLevel` grants exactly +5 attribute points per level, recomputes `maxHp`/`maxSp` without topping up `hpCurrent`/`spCurrent` (ratio-adjusted, §6.3), and discards + rebuilds the remaining 4 queue entries against the new stats.
  2. **Death** — an `outcome = 'loss'` resolve sets `status = 'town'`, `currentMapId = null`, `hpCurrent = 1`, applies the §6.4 XP loss with a floor at zero, overwrites `lastDeathLog` with that battle's full log, and deletes every remaining unresolved queue entry plus its BullMQ job.
  3. **Determinism** — `BattleEngine.simulateBattle()` with an identical `(characterSnapshot, monsterDefinition, gambitPage, seed)` tuple produces a byte-identical `BattleResult`.
  4. **Idempotency** — concurrent `resolveBattle(battleId)` calls on the same id apply XP/gold/drops/inventory exactly once, enforced by the conditional-UPDATE claim at `battle.service.ts:372-378`.
  5. **Crash recovery** — unresolved `BattleQueueEntry` rows with `endAt` in the past are resolved oldest-first on boot, and the queue is topped back up to 5 for characters still alive and still on a map.
  6. **Gambit validation** — the six §8.4 save-time rules reject with `400` + field-level errors before any DB write, and the runtime checks (potion item existence, the shared 5-tick potion cooldown category, and condition-true-but-illegal line skipping, §7.3 step 4) behave as specified.
- Each script prints a pass/fail line per assertion and exits non-zero on the first failure, so it can be run standalone or chained.
- Record the outcome of the pass in `STATUS.md`, replacing the unreproducible "Tested" claims in STATUS.md §1 with evidence that points at a specific committed script.
- **Deliberately out of scope:** production code changes. The suite asserts code-as-written. Three divergences found during planning are documented in `design.md` and reported as follow-ups, not fixed here.

## Capabilities

### New Capabilities

- `grind-loop-verification`: The observable guarantees the grind loop must uphold at its edges — level-up mid-queue, death, determinism, idempotent resolution, crash recovery, and gambit save-time/runtime validation — together with the requirement that each guarantee be covered by a re-runnable verification script. This is the first OpenSpec capability in the project; `openspec/specs/SPEC.md` is the raw design document, not a capability spec, and no capability inventory exists yet.

### Modified Capabilities

None. No existing capability spec is present in `openspec/specs/`, so there is nothing whose requirements change.

## Impact

**New files (test-only):**

- `apps/api/test/helpers/phase3.js` — shared bootstrap: register a unique user, set `users.emailVerified = true` directly in Postgres (STATUS.md §7 "Email verification bypass"), allocate attributes, enter a map; plus `request()`, `sqlQuery()`, `waitFor()`, and assertion helpers.
- `apps/api/test-phase3-levelup.js`
- `apps/api/test-phase3-death.js`
- `apps/api/test-phase3-determinism.js`
- `apps/api/test-phase3-idempotency.js`
- `apps/api/test-phase3-recovery.js`
- `apps/api/test-phase3-gambits.js`
- `apps/api/test-phase3-all.js` — runs all six in sequence against a single stack instance.

**Modified files:**

- `STATUS.md` — replace the unverifiable "Tested" rows in §1 with pointers to the new scripts; add a Phase 3 results section; add the documented divergences from `design.md`.

**Code under test (read-only in this change):**

- `apps/api/src/modules/battle/battle.service.ts` — `queueBattles()`, `resolveBattle()`, `handleCharacterDeath()`, `incrementKillCounter()`, `requeueBattlesAfterLevelUp()`
- `apps/api/src/modules/battle/battle-recovery.service.ts` — `onApplicationBootstrap()`, `resolveStaleBattles()`, `topUpQueues()`
- `apps/api/src/modules/battle/battle-queue.processor.ts` — the `resolve-battle` job handler
- `apps/api/src/modules/gambit/gambit.service.ts` — `validateNode()`, `validateGambitLine()`, `validateGambitPage()`, `assertValidGambitPage()`
- `packages/shared/src/battle-engine/index.ts` — `simulateBattle()`, `GambitEvaluator.isActionLegal()`, `evaluateGambitPage()`
- `packages/shared/src/battle-engine/prng.ts` — `mulberry32Seed()`, `rngForIndex()`

**Runtime:** docker-compose (`db` + `redis` + `backend` on host port `3010`). No new dependencies, no schema migration, no API surface change.
