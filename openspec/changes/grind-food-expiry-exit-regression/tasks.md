# Tasks

## 1. Establish repository and behavior baseline

- [x] 1.1 Read root `SPEC.md`, `STATUS.md`, `ARCHITECTURE.md` if present, plus the relevant active/previous OpenSpec changes: `diet-auto-feed`, `diet-autofeed-boundary-reliability`, `grind-authoritative-realtime-state`, `grind-loop-phase3-edge-cases`, and current food/queue follow-up. Record authoritative contracts and known tests.
- [x] 1.2 Trace production paths that route a character to Town. Confirm the relevant queue-generation branch in `BattleService.queueBattles()` and distinguish it from resolver/death/explicit-leave paths.
- [x] 1.3 Inspect current test harnesses and use a deterministic service test with controlled timestamps; no two-minute wall-clock wait.
- [x] 1.4 Record root-cause evidence in `design.md`: test setup, expiry and queue timing, pre-fix failure, resulting state and presence calls; distinguish the test proof from the incomplete production logs.

## 2. Regression coverage

- [x] 2.1 Reproduce early Town routing: food expires about two minutes in the future, no battle is active at `now`, and a future queued battle crosses expiry. The regression failed on the old code.
- [ ] 2.2 Add a resolver-level regression for a battle that starts before expiry but ends after it, verifying that it resolves normally and no following battle starts without valid food.
- [x] 2.3 Cover actual food exhaustion with no active battle and no replacement: Town transition, queue discard and map-presence synchronization occur once.
- [x] 2.4 Parameterize positive remaining durations (2 minutes, 1 minute, 5 seconds and 1 second) to prove there is no fixed early-exit grace period.
- [x] 2.5 Cover the Auto Feed opportunity at actual exhaustion and verify that a successful replacement avoids Town and rebuilds from the updated state. Existing Diet tests continue to cover authoritative food eligibility/consumption semantics.
- [x] 2.6 Cover Auto Feed disabled and enabled-but-no-eligible-food: no food is consumed and Town occurs only after actual food expiry.
- [ ] 2.7 Complete independent-path regression coverage for death, explicit Town request and ordinary queue top-up in this focused suite. Existing map-leave idempotency test passed; `map-presence-cleanup.test.js` has a separate outdated direct-death harness failure because it omits the transaction manager.
- [ ] 2.8 Add concurrent resolver/top-up boundary coverage for duplicate consumption/transition prevention.
- [x] 2.9 Run the focused regression before the fix (it failed with `town` instead of `grinding`) and after the fix (all focused cases pass).

## 3. Implementation

- [x] 3.1 Separate projected future-queue food from the persisted current Character food state; projection alone no longer routes a still-fed character to Town.
- [x] 3.2 Check food eligibility against the actual next encounter start after encounter-search delay.
- [x] 3.3 At actual exhaustion in queue generation, invoke the existing Auto Feed path before Hungry/Town fallback; successful feeding discards stale projections and rebuilds the queue.
- [x] 3.4 Do not queue a battle that cannot start before food expiry. If no battle is queued and food has a positive remaining duration, schedule the existing server-side `queue-battles` worker to re-evaluate at the exact expiry; otherwise use the authoritative Town/presence transition at actual exhaustion.
- [x] 3.5 Preserve the active battle and existing resolver behavior; the correction only changes future queue eligibility/maintenance.
- [ ] 3.6 Add explicit concurrent snapshot/revision and unresolved-job cleanup assertions for the Auto Feed rebuild path.
- [x] 3.7 No unrelated refactors, schema/API/dependency changes, frontend timers, heartbeat changes or production deployment.

## 4. Verification and documentation

- [x] 4.1 Run the focused regression suite; all included cases pass, including the regression that failed before the fix.
- [ ] 4.2 Finish all related food-type, Grind edge-case, map-transition and presence-cleanup suites. Diet Auto Feed tests, map-leave idempotency and encounter-search tests passed; `map-presence-cleanup.test.js` currently fails in its direct `handleCharacterDeath()` harness because no transaction manager is supplied.
- [x] 4.3 Run the applicable API build, `git diff --check`, and `openspec validate grind-food-expiry-exit-regression --strict`; all passed.
- [x] 4.4 Update root `STATUS.md`, root `SPEC.md`, canonical `openspec/specs/SPEC.md`, and `ARCHITECTURE.md` with the durable boundary and verification evidence.
- [x] 4.5 Record the exact root cause and clearly distinguish what the supplied production logs prove from what the deterministic regression test proves.
- [x] 4.6 No full deploy or production mutation; no deployment was performed.
