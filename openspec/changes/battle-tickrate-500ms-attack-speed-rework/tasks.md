# Tasks

Reference:
- `specs/battle-combat-timing/spec.md`
- `specs/battle-queue-lifecycle/spec.md`
- `design.md`

## 1. Baseline audit and temporal-unit inventory

- [ ] 1.1 Re-read root `STATUS.md`, `SPEC.md`, `openspec/specs/SPEC.md`, `ARCHITECTURE.md`, this change's proposal/specs/design, and current queue/mutation/encounter changes; record the exact baseline in the implementation handoff and verify the working tree is clean before editing.
- [ ] 1.2 Inventory every battle-engine timing constant, tick counter, gauge threshold, cooldown, cast duration, status duration/expiry, DoT interval, regeneration boundary, food digestion timer, and timestamp conversion in `packages/shared/src/**`; classify each as tick-native, seconds-based, or wall-clock and verify the inventory references actual fields/usages.
- [ ] 1.3 Inventory every API tick↔timestamp conversion, battle scheduling/recovery path, cooldown/status/food projection, and encounter-search delay; verify Travel, Gathering, Cooking, Crafting, flee retry/backoff and off-battle regeneration are explicitly classified as wall-clock and excluded from combat-rate scaling.
- [ ] 1.4 Inventory all frontend tick-to-time consumers, including Grind timeline/status projections, `core/game.store.ts`, `battle-hit-feedback.ts`, `game-audio.service.ts`, Battle Log, and any other matches; verify each entry lists its required `tickDurationMs` source.
- [ ] 1.5 Audit root and frontend mirrored catalogue fields (`monsters.json`, `skill_trees.json`, `status_effects.json`, items/food effects and other timing-bearing catalogues); produce a typed list of tick-native fields to double and seconds-based fields that must remain unchanged, verified by a machine-readable diff/check.
- [ ] 1.6 Capture baseline deterministic fixtures for representative Character/monster battles and existing status/cooldown/regen behavior before changing timing; verify the fixtures reproduce the current results and provide comparison evidence for unchanged mechanics.

## 2. Central 500 ms timebase and deterministic Attack Speed

- [x] 2.1 Add `BATTLE_TICK_DURATION_MS=500` to the API runtime configuration and `.env.example`; validate the value at startup and verify invalid/unsupported values fail with a clear configuration error rather than silently scheduling inconsistent battles.
- [x] 2.2 Introduce centralized seconds↔battle-ticks and milliseconds↔battle-ticks conversion helpers with explicit rounding contracts; add unit tests for 0, fractional seconds, exact seconds, remaining deadlines and expiry boundaries.
- [x] 2.3 Refactor Character basic-attack preparation to use `effectiveAttackSpeed = clamp(rawAttackSpeed - activePenalty, 0, 800)` and `preparationTicks = 16 × (800 - effectiveAttackSpeed) / 800`; verify the zero-preparation AS 800 case cannot divide by zero and fractional gauge progress remains continuous.
- [x] 2.4 Preserve the fixed one-second basic-attack resolving lock and correct tick-boundary countdown semantics; verify the exact event-to-event spacing is 18 ticks at AS 0, 14 ticks at AS 210, and 2 ticks at AS 800, including an explicit regression for the current end-of-tick decrement behavior.
- [x] 2.5 Add a deterministic Attack Speed table test at effective AS 0, 100, 200, 210, 300, 400, 600, 700 and 800; verify clamping below 0/above 800, fractional gauge firing boundaries, and that existing AGI/equipment/status/multiplier sources still feed the effective rating.
- [x] 2.6 Preserve temporary `attackSpeedMultiplier` behavior for the preparation phase only; verify it never shortens the fixed lock and that status application/stack/expiry changes future gauge refill without erasing earned progress.
- [x] 2.7 Keep the existing Character CTR rating, `CTR / 100` tick-subtraction coefficient and ceiling semantics against doubled base cast ticks; verify base casts retain their old elapsed seconds while the same CTR rating removes the same number of ticks and therefore half as many real seconds as before.
- [x] 2.8 Preserve the non-skill Character Cast gauge's real-time cadence by scaling both its base threshold and minimum from the old values; verify the DEX threshold curve against an old-vs-new elapsed-time comparison.
- [ ] 2.9 Add/adjust shared battle-engine deterministic tests for zero and positive preparation, lock timing, cast intent/resolution, cooldown start boundaries and status-modified attack cadence; verify the shared package test suite passes.

## 3. Scale tick-native combat mechanics without changing seconds-based values

- [x] 3.1 Convert player skill `baseCastTicks`, `cooldownTicks`, rank-specific cooldown arrays, and other explicitly tick-native skill fields; verify all converted values are exactly doubled and preserve elapsed seconds including current cooldown off-by-one/start-boundary semantics.
- [x] 3.2 Convert monster skill `baseCastTicks`, `cooldownTicks`, rank-specific tick fields and default cast durations; verify player and monster cast/cooldown regression fixtures retain their previous elapsed seconds.
- [x] 3.3 Double monster basic-attack `atkSpeedTicks` catalogue baselines and scale the tick-derived Attack Speed penalty conversion consistently; verify representative monsters preserve attack-event spacing in milliseconds, including Rage/speed modifiers.
- [x] 3.4 Double tick-native status durations, effect duration fields, rank variants and tick-indexed expiry values; verify Slow/Freeze/Stun/Disarm/Bleed/Burn/Poison and all currently supported statuses preserve real-time duration and stack-expiry boundaries.
- [x] 3.5 Double every periodic damage interval and preserve damage amount/tick ordering; verify Bleed, Burn, Poison and any other periodic effects produce the same sequence of wall-clock damage timestamps and total damage.
- [x] 3.6 Change Character and monster in-battle HP/SP regeneration cadence from 10 to 20 ticks while keeping amounts unchanged; update any user-facing “per 10 ticks” wording to “per 10 seconds”; verify the same globally aligned 10-second boundary ownership and knockout/death suppression.
- [x] 3.7 Keep seconds-based consumable cooldowns and effects unchanged in catalogues, converting potion/tonic/item cooldowns and status/food durations at the simulation boundary; verify potions retain 10-second cooldowns, tonics retain 30-second cooldowns, and seconds-based effects are not doubled in JSON.
- [ ] 3.8 Preserve food buff durations, per-food digestion deadlines and cooldown/status persistence across chained battles using the 500 ms conversion helpers; verify food expiry/auto-feed eligibility occurs at the same real timestamps as before.
- [x] 3.9 Preserve off-battle resource regeneration at globally aligned 10-second wall-clock boundaries; verify the implementation does not route the 10,000 ms off-battle cadence through combat tick conversion.
- [x] 3.10 Remove `every_n_ticks` from `GambitEvaluator`, its type/snapshot comments and any dead tick dependency used only by that condition; change Ruins Guardian (`mon_ruinsguardian`) stun condition to `always` in root and frontend monster catalogues, and verify grep/catalogue validation finds no remaining `every_n_ticks` entries.
- [x] 3.11 Add catalogue-mirror/schema regression checks for all tick-value conversions and confirm seconds-based fields remain byte-for-byte unchanged where not otherwise part of the change.

## 4. Battle movement cadence at 500 ms

- [x] 4.1 Change the battle-lane movement gauge threshold from 100 to 200 while keeping the current Move Speed values and accumulating the same effective Move Speed on each 500 ms tick; verify movement-gauge values are still server-simulated integers/fractions as appropriate.
- [x] 4.2 Restrict movement resolution to one-second boundaries (every two combat ticks), with at most one movement step per boundary and existing overflow retention; verify low, normal and high Move Speed produce the same wall-clock step timing as before.
- [ ] 4.3 Add movement regression scenarios for Move Speed below 100, exactly 100, between 100 and 200, and the maximum legal effective Move Speed; verify no character/monster can exceed one completed space per real-time second due to the former one-step-per-tick cap.
- [ ] 4.4 Verify movement intents, approach range, occupied positions, status penalties, equipment/buff modifiers and deterministic actor ordering remain unchanged; verify world-map Move Speed, travel duration and flee chance have no combat-tick dependency.

## 5. Persist tick metadata and convert API battle scheduling

- [ ] 5.1 Add required `tickDurationMs` to `BattleQueueEntry`, its TypeORM entity, API DTOs and immutable log header; add a migration with a safe default for existing rows and verify TypeScript builds and database migration up/down behavior.
- [ ] 5.2 Update queue generation so all new entries store the configured 500 ms duration and calculate `endAt`, minimum battle duration and inter-entry chain timestamps using the same value; verify a simulation of N ticks is scheduled for N × 500 ms.
- [x] 5.3 Replace every combat tick↔timestamp conversion inside `BattleService` (including food/status/cooldown projection, resource regen checkpoints, FLEE partial replay, persisted buff expiry and event timestamp derivation); verify all use one conversion contract and no combat path retains a hard-coded 1,000 ms-per-tick assumption.
- [x] 5.4 Keep encounter-search delay in wall-clock seconds and correct only its documentation formula: randomized integer 2–6 seconds plus `max(1, floor(totalActiveGrindersOnMap))` seconds, where the active grinder count includes the Character being queued; verify no production search-time behavior changes.
- [x] 5.5 Update battle recovery/startup logic so new entries/jobs use 500 ms metadata and never attempt to interpret retained old entries under a different clock; verify recovery remains behind the existing startup gate and idempotency checks.
- [ ] 5.6 Add focused API queue tests for persisted `tickDurationMs`, `startAt`/`endAt`, status/cooldown carry-over, 10-second regen checkpoints, encounter-search delay and recovery; verify old real-time durations remain unchanged outside basic attacks.
- [x] 5.7 Audit BattleQueueEntry history reads, Battle Log DTOs, socket payloads and any API response serializers; verify `tickDurationMs` is present wherever a client can project tick-indexed events.

## 6. Frontend projections consume authoritative per-entry timing

- [x] 6.1 Update Grind active battle elapsed-tick/status/event projections in `features/play/components.ts` to use the active entry's `tickDurationMs`; verify status icons and event-boundary displays align with server timestamps.
- [x] 6.2 Update all other Grind tick calculations (including `elapsedTick`, `elapsedTicks`, event resource snapshots and historical queue selection) to use the matching entry's metadata; verify a 500 ms battle renders intermediate events at the correct half-second boundary.
- [x] 6.3 Update `core/game.store.ts` live HP/SP reconstruction to use the current BattleQueueEntry's tick duration; verify the Character resource display no longer lags or leads battle log events.
- [x] 6.4 Update `shared/battle-hit-feedback.ts` to derive the active battle tick from `tickDurationMs`; verify damage number and portrait/sprite flash timing matches the authoritative event.
- [x] 6.5 Update `shared/game-audio.service.ts` combat sound dispatch to use `tickDurationMs`; verify hits, skills and other event sounds do not drift relative to the battle timeline.
- [x] 6.6 Audit remaining frontend timestamp/tick consumers and make missing metadata an explicit invalid-entry/await-authoritative-data state instead of silently falling back to 1,000 ms; verify grep shows no unreviewed combat tick conversion.
- [ ] 6.7 Preserve server authority for initial Grind entry and queue exhaustion: use the existing searching/preparing UI until a valid authoritative queue arrives; verify no placeholder battle bar, fabricated event, client-simulated result or speculative progress is introduced.
- [ ] 6.8 Update focused frontend tests for half-second event projection, status expiry, HP/SP state, hit feedback, sound timing and searching/preparing fallback; verify frontend production build passes.

## 7. Bounded Bull consumer concurrency and queue observability

- [x] 7.1 Add validated environment variables `BATTLE_RESOLVE_CONCURRENCY=4`, `BATTLE_QUEUE_CONCURRENCY=2`, and `WORLD_ACTIVITY_CONCURRENCY=1`; document safe positive integer bounds and verify all are forwarded to the backend container through the existing `.env` mechanism.
- [x] 7.2 Configure named Bull processors with explicit per-handler concurrency from the validated values; verify Bull receives the intended concurrency for `resolve-battle`, `queue-battles` and each world activity handler without creating a second queue or worker service.
- [ ] 7.3 Preserve per-Character serialization and transactional battle resolution invariants while allowing independent Characters to run concurrently; add a focused parallel-job regression proving two Characters can progress at once while overlapping jobs for one Character remain serialized and idempotent.
- [x] 7.4 Preserve lock/row-lock ordering, duplicate-delivery behavior, startup gate, and post-commit socket publication under the configured concurrency; verify the existing battle queue atomicity/recovery regressions still pass.
- [x] 7.5 Add structured logs for queue-generation duration/resulting depth, scheduled-vs-actual resolve start, handler execution duration, retry/failure and Character-lock wait where available; verify logs distinguish queue wait and worker lag from simulated battle duration.
- [ ] 7.6 Prioritize initial queue generation when a Character enters Grind and preserve the existing five-entry buffer; verify the first queue payload is published promptly after persistence and top-up does not overwrite valid active state.
- [ ] 7.7 Verify queue-exhaustion and mutation-invalidation behavior across equipment, attributes and active Gambit changes; ensure the client shows searching/preparing while no valid new queue exists and never receives a stale snapshot as current state.

## 8. Planned alpha cutover and rollback tooling

- [ ] 8.1 Implement a targeted maintenance cutover command/runbook that requires old API and Bull consumers to be stopped, removes BattleQueueEntry rows/logs and obsolete battle/encounter jobs only, and explicitly refuses broad Redis flush or Character deletion; verify it is safe to run in a disposable local database first.
- [ ] 8.2 Reset all Characters to `status='town'` and `currentMapId='map_town'`, clear transient Grind/Travel/Gathering/flee/map-transition state and stale tick-bound combat projections, and preserve Character rows, identity, XP/level, attributes, equipment, inventory, Gold/Soul Tokens, quests and Mastery; verify before/after data comparisons for representative Characters.
- [ ] 8.3 Preserve valid persisted Cooking/Crafting sessions and their real-time deadlines while removing/reconciling incompatible world activity jobs; verify the existing activity recovery path can re-arm supported Town jobs after restart.
- [x] 8.4 Provide a documented rollback path: stop new consumers, repeat targeted queue/transient cleanup, deploy the old code and let old one-second queues rebuild from Town; verify no old 500 ms queue is replayed under the prior version.
- [ ] 8.5 Add safety gates and a dry-run/report mode for the cutover utility; verify it reports affected Character/queue/job counts and requires explicit maintenance-mode confirmation before destructive execution.

## 9. Documentation and deferred performance debt

- [x] 9.1 Update root `SPEC.md` §7.1–7.3 for 500 ms ticks, the new Attack Speed curve/lock, preserved elapsed-time durations, doubled cast/cooldown/status/DoT/regeneration ticks, movement-gauge behavior and removal of temporal Gambit conditions; verify formulas and example intervals match the spec delta.
- [x] 9.2 Update root `SPEC.md` §7.4–7.5 and `ARCHITECTURE.md` for per-entry `tickDurationMs`, 500 ms scheduling, queue consumer concurrency, queue-latency observability, server-authoritative searching/preparing state and planned cutover; verify docs match actual implementation.
- [x] 9.3 Correct root `SPEC.md` §11.4 and both maintained documentation copies to describe the implemented randomized 2–6 second delay plus one second per total active grinder (minimum one), including the currently queued Character; verify this task changes documentation only, not encounter timing code.
- [x] 9.4 Update `openspec/specs/SPEC.md` consistently with root `SPEC.md` and verify the two documented contracts agree on tick duration, attack intervals, queue timing and encounter search.
- [x] 9.5 Add a dated `STATUS.md` entry summarizing the 500 ms cutover, key behavior and conversion rules, concurrency defaults, verification results and explicit no-deployment status; verify it does not claim load-tested capacity.
- [x] 9.6 Review and finalize the existing `technical_debts/battle-queue-performance-benchmark/README.md` with future 50/100/200/250–300 Character benchmarks, the current 8-vCPU Xeon E5-2680 v3 @ 2.50 GHz / 15 GiB RAM / 150 GB disk host snapshot, CPU/RAM/p95/p99 targets, PostgreSQL/Redis/Bull observations, and future API-worker separation decision; verify it explicitly states these are unmeasured targets and no load test is included now.
- [x] 9.7 Update `.env.example` and the deployment checklist with every new variable: `BATTLE_TICK_DURATION_MS`, `BATTLE_RESOLVE_CONCURRENCY`, `BATTLE_QUEUE_CONCURRENCY`, and `WORLD_ACTIVITY_CONCURRENCY`; verify all are documented with their selected values and that the final handoff tells the operator to set them in the server `.env`.

## 10. Verification and implementation hygiene

- [x] 10.1 Run all focused shared battle-engine deterministic tests and verify exact attack-event intervals, skill/cooldown/status/DoT/regen timing, monster cadence and movement timing.
- [ ] 10.2 Run focused API integration/regression tests for BattleQueueEntry metadata, BattleService scheduling/recovery, per-Character locking, cross-Character concurrency, queue mutations and targeted cutover dry-run; verify no duplicate rewards or stale snapshots.
- [x] 10.3 Run catalogue JSON/schema/mirror validations and verify no unsupported temporal Gambit condition remains.
- [x] 10.4 Run `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, and `pnpm --filter @nanommo/frontend build`; verify all three pass.
- [x] 10.5 Run `openspec validate battle-tickrate-500ms-attack-speed-rework --strict` and `git diff --check`; verify both succeed.
- [x] 10.6 Do not run a load test, claim 250–300 player capacity, split API/workers, deploy to production, or execute the destructive maintenance cutover in the implementation session unless explicitly included in a later deployment instruction; verify final report distinguishes completed code checks from the user's later manual test.
