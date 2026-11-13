# Design

## Context

See `proposal.md` for motivation and scope.

The shared simulator in `packages/shared/src/battle-engine/index.ts` is integer-tick deterministic, but its constants and several callers currently assume 1,000 ms per tick. The API converts simulated durations and tick-indexed event positions to timestamps in `BattleService`; Angular separately reconstructs event ticks in Grind, resource projection, hit feedback and audio. The existing queue pre-simulates up to five battles and uses one Bull `battle-queue` with separate named processors. Bull's current named processors omit an explicit concurrency argument, so each defaults to concurrency 1. The API already has per-Character Redis queue locking, PostgreSQL Character/entry row locks, transactional reward idempotency, and post-commit socket publication; those are invariants, not things to replace.

There is an important boundary between simulated combat time and real-world activity time. Encounter search delays, Travel, Gathering, Cooking, Crafting, flee retry scheduling, off-battle HP/SP regeneration and Bull retry/backoff delays are wall-clock activities, not battle ticks. They must not be halved simply because combat gains a finer tick.

## Goals / Non-Goals

**Goals**
- Use 500 ms integer ticks inside the deterministic battle simulator.
- Make Character basic Attack Speed perceptibly improve from 9 seconds at AS 0 to 1 second at AS 800, without allowing the two-tick resolving lock to be shortened.
- Preserve the elapsed-time behavior of every current combat mechanic except the intentionally redesigned Character basic-attack preparation curve and the explicitly requested 2x reduction in CTR's elapsed-time efficiency.
- Keep battle queue state and outcomes exclusively server-authoritative.
- Permit bounded parallel work across different Characters while retaining same-Character serialization and exactly-once transaction semantics.
- Make queue-entry wait and delayed-job lag observable and understandable to the player.
- Make the alpha deployment cutover intentionally simple and reversible without deleting persistent Character progression.

**Non-Goals**
- Accelerating player skills, monster attacks, cooldowns, status effects, DoT, regeneration, battle movement, encounter search, travel, gathering, crafting, cooking, or flee timings.
- Rebalancing monster stats, equipment, skill power, status potency, loot, XP, or general Move Speed.
- Splitting API and workers into separate deployments, creating new Bull queues, introducing a telemetry stack, or implementing a load-test suite now.
- Claiming support for 250–300 simultaneous battlers before the future benchmark.
- Preserving interrupted battle logs or resuming pre-cutover unresolved battles.

## Decisions

### 1. One explicit combat tick constant; keep wall-clock activities separate

Introduce a single API/runtime value `BATTLE_TICK_DURATION_MS=500`. Validate it at startup as a positive integer and, for this release, reject values other than 500 rather than allowing a runtime value that the catalogue conversion and mechanics have not been calibrated for. The simulator itself remains pure and receives integer durations only; it must not read `Date.now()`, environment variables, Redis, or the database.

Provide centralized conversion helpers at the API boundary:
- seconds to battle ticks: `ceil(seconds × 1000 / BATTLE_TICK_DURATION_MS)`, preserving the existing no-shorter-than-configured-duration behavior;
- milliseconds to remaining battle ticks: use the existing documented ceiling/floor semantics at each call site, but divide by `BATTLE_TICK_DURATION_MS`;
- battle ticks to milliseconds: `ticks × BATTLE_TICK_DURATION_MS`.

Do not reuse the combat constant for ordinary seconds. Keep explicit values such as `1000 ms per second` and `10,000 ms per off-battle regeneration period` where the code means wall-clock time. In particular:
- `BattleQueueEntry.endAt` becomes `startAt + max(BATTLE_TICK_DURATION_MS, durationTicks × BATTLE_TICK_DURATION_MS)`;
- encounter-search delay remains the existing number of seconds × 1,000 ms;
- off-battle regeneration remains aligned to 10-second boundaries;
- Travel/Gathering/Cooking/Crafting/flee retry and Bull backoff timestamps remain unchanged.

### 2. Redesign only the Character basic-attack preparation curve

Do not change the derived Attack Speed rating formula or rating sources (AGI, equipment, status penalties and existing temporary modifiers). Resolve the effective rating as:

```
effectiveAttackSpeed = clamp(attackSpeed - activeAttackSpeedPenalty, 0, 800)
preparationTicks = 16 × (800 - effectiveAttackSpeed) / 800
```

This is equivalent to a preparation interval from 8 seconds at AS 0 to 0 seconds at AS 800. The gauge preserves fractional progress and adds `1 / preparationTicks` on each eligible tick. Handle preparationTicks = 0 as immediately ready; do not divide by zero and do not force an artificial one-tick preparation.

Keep the observable basic-attack lock at exactly two 500 ms intervals (one second) between attack events at AS 800. If an attack resolves at tick N, tick N+1 is ineligible and the next attack may occur at N+2. The implementation must account for the simulator's current end-of-tick countdown (which decrements the lock on the same loop iteration that sets it) so this does not become a one-tick gap or a three-tick gap. The lock is independent of the preparation phase and is never reduced by Attack Speed or its multipliers. Apply the existing temporary `attackSpeedMultiplier` to the preparation phase only. Add exact event-tick regression tests for AS 800, AS 0 and fractional values before considering the lock conversion complete.

With the current per-tick discrete gauge, expected intervals are:

| Effective AS | Mathematical preparation | Eligible preparation ticks | Lock | Expected interval |
|---:|---:|---:|---:|---:|
| 0 | 8.0 s | 16 | 2 | 18 ticks = 9.0 s |
| 100 | 7.0 s | 14 | 2 | 16 ticks = 8.0 s |
| 200 | 6.0 s | 12 | 2 | 14 ticks = 7.0 s |
| 210 | 5.9 s | 12 (fractional gauge rounds by firing boundary) | 2 | 14 ticks = 7.0 s |
| 300 | 5.0 s | 10 | 2 | 12 ticks = 6.0 s |
| 400 | 4.0 s | 8 | 2 | 10 ticks = 5.0 s |
| 600 | 2.0 s | 4 | 2 | 6 ticks = 3.0 s |
| 700 | 1.0 s | 2 | 2 | 4 ticks = 2.0 s |
| 800 | 0.0 s | 0 | 2 | 2 ticks = 1.0 s |

The AS 210 mathematical interval is 6.9 seconds; the discrete 500 ms event boundary produces 7.0 seconds. Do not promise fractional battle events between ticks.

Monster basic-attack timing is not part of this new Character curve. Double monster `atkSpeedTicks` baselines and double tick-derived penalties/delays so their elapsed attack cadence remains the same. Preserve monster Rage or other existing speed multipliers.

### 3. Keep base skill casts in seconds but halve CTR's elapsed-time efficiency as requested

The current helper applies `ceil(baseCastTicks - CTR / 100)`. First double each tick-native base cast value so the unmodified skill still has the same base duration in seconds. Keep the existing CTR rating, the `CTR / 100` tick-subtraction coefficient, and the existing ceiling/rounding behavior. Do not multiply the CTR subtraction by two.

Because each new tick is 500 ms, the same CTR value now removes half as many real seconds as it did under the old clock. For example, a base cast of 4 seconds becomes 8 ticks. A CTR value that previously removed one 1-second tick still removes one tick, which now represents 500 ms; the unmodified 4-second base cast remains unchanged, while CTR's elapsed-time benefit is halved.

```
effectiveNewCastTicks =
  max(0, ceil(newBaseCastTicks - effectiveCTR / 100))
```

Do not change the derived CTR stat or introduce a new rating curve. Add table-driven tests that compare the base cast (without CTR) and CTR-adjusted elapsed durations so this intentional balance change is not confused with a base-cast acceleration.

### 4. Convert every tick-native combat duration, not every seconds-based duration

Keep the source unit clear:
- Tick-native catalogue values are doubled for the new clock: player/monster `baseCastTicks`, skill `cooldownTicks` and rank-specific cooldowns, `statusDurationTicks` and rank variants, effect `durationTicks`, `burnDurationTicks`, `atkSpeedTicks`, any poison/bleed/burn pulse interval, and other tick-indexed durations discovered by the audit.
- Engine timing constants and thresholds that represent elapsed combat ticks are doubled where needed. In particular, the non-skill Character Cast gauge threshold (currently 8 ticks with a 3-tick minimum) must preserve its real-time cadence; its new threshold/minimum are two times the previous tick counts.
- Ten-second Character and monster in-battle regeneration boundaries change from 10 to 20 ticks. Regen amounts stay unchanged. Existing legacy field names such as `hpRegenPerTenTicks`/`spRegenPerTenTicks` may remain for persisted/catalogue compatibility, but comments, tooltips and documentation must describe the amount as per 10 seconds rather than per 10 ticks. Keep off-battle 10-second regeneration on its existing millisecond schedule.
- `cooldownInSeconds`, `durationSeconds`, food/tonic seconds, and other seconds-based catalogue values remain unmodified and are converted to ticks using the central helper at simulation boundaries. This includes potion/tonic cooldown seeding, food buff expiry/digestion, and persistent cooldown/status deadline conversion.
- The attack lock is specifically not doubled: its value remains 2 ticks because its intended new elapsed duration is one second, not two seconds. Preserve the event-index boundary: an attack at N blocks N+1 and allows the next preparation/fire opportunity at N+2.

Do not globally multiply arbitrary JSON numbers. Use a typed field audit and transform only values whose unit is explicitly ticks. Keep root JSON and frontend public mirrors identical and validate their schemas/mirrors after conversion.

### 5. Preserve movement in real time with the approved 200-point gauge

Change the battle movement threshold from 100 to 200 while retaining Move Speed values and movement-intent semantics. Continue adding the current Move Speed value on each half-second tick, but evaluate/consume the movement gauge only on every second combat tick (one-second boundaries), with at most one step at that boundary. Across two half-second ticks, the gauge gains 2 × Move Speed; the threshold is also doubled to 200, so this is the exact old 100-point-per-one-second gauge expressed in doubled units. This avoids both accidentally accelerating high Move Speed and changing the old one-step-per-second cap. Keep world map travel and flee calculations untouched. Add a deterministic regression for ordinary, high and maximum legal effective Move Speed, including changes from equipment/buffs.

### 6. Remove the tick-timer Gambit condition and use the skill's own cooldown

Remove `every_n_ticks` from `GambitEvaluator` and its stale comments/snapshot tick dependency if no other behavior requires it. The only catalogue instance found is Ruins Guardian (`mon_ruinsguardian`) using `monster_skill_stun` every 8 ticks. Change that condition to `always`. Existing skill cooldown and legality evaluation already skip a skill that is unavailable and continue to the lower-priority attack line. Retain state predicates such as `skill_ready`, HP/SP thresholds and status checks.

### 7. Keep five-entry queue, persist per-entry time base, and project events from it

Add a required integer `tickDurationMs` to the BattleQueueEntry persistence/entity/DTO contract and to the immutable log header; new entries store 500. API scheduling, status/cooldown/food projection, battle resource checkpoints, damage events and queue timestamps must use this entry/runtime duration consistently.

Frontend consumers must use the active or historical entry's `tickDurationMs` when converting elapsed milliseconds to event ticks. Audit and update, at minimum:
- Grind's active status and event projections in `features/play/components.ts`;
- `elapsedTick`, `elapsedTicks`, and timestamp-to-log-event selection paths;
- live HP/SP projection in `core/game.store.ts`;
- `battle-hit-feedback.ts`;
- `game-audio.service.ts`;
- any other frontend timeline consumer found by repository-wide search.

The cutover deletes old battle rows/logs, so no complex dual-clock compatibility path is needed. Missing tick-duration metadata on a newly created entry is an invalid server payload, not an invitation for the client to guess 1,000 ms.

### 8. Optimize the existing Bull consumers without splitting infrastructure

Keep the single existing `battle-queue` and current backend process topology. Add explicit, validated, environment-configured concurrency to named handlers. Initial conservative defaults for the current 8-vCPU host:

| Variable | Default | Applies to |
|---|---:|---|
| `BATTLE_RESOLVE_CONCURRENCY` | 4 | `resolve-battle` |
| `BATTLE_QUEUE_CONCURRENCY` | 2 | `queue-battles` |
| `WORLD_ACTIVITY_CONCURRENCY` | 1 | named world activity handlers |

These are starting limits, not proven capacity numbers. Validate every value as an integer in a safe positive range (1–8). Do not create a second worker service or another queue now.

Concurrency is across independent jobs/Characters. Keep:
- `withCharacterQueueLock` around the Character's queue/mutation chain;
- PostgreSQL Character then BattleQueueEntry locking order;
- one transaction for rewards and `resolved = true`;
- idempotent duplicate-job handling;
- job cleanup/queue rebuild/socket publication after DB commit.

Add structured normal-level timing logs for queue generation duration/depth, scheduled-versus-actual resolution start, handler duration, retry/failure, and lock wait where available. Do not add a metrics service.

### 9. Make queue waiting legible without inventing progress

On initial Grind entry, prioritize the existing queue-generation path and publish the first authoritative queue as soon as it is persisted. Until it arrives, keep the existing searching/preparing presentation; do not create a placeholder battle bar, estimate an outcome, or animate a fictitious event. During normal grind keep the five-entry buffer. If a top-up is late and the queue is exhausted, show the existing searching/preparing state until the next authoritative queue payload arrives.

For mutations, reuse the current safe queue-invalidation boundary: preserve an in-flight battle, discard only stale future snapshots, and rebuild from the new Character state at the existing safe point. The player may notice a wait if queue regeneration is not ready, but must never see an old equipment/Gambit snapshot presented as the new state.

### 10. Use a planned alpha cutover rather than mixed-tick replay

Do not attempt to resume a pre-deploy unresolved battle using the new clock. The release runbook is:
1. Announce a short maintenance window and stop accepting gameplay mutations.
2. Stop the old API and all old Bull consumers so no old process can add or resolve jobs.
3. Run a targeted cutover utility while the app is stopped: remove old BattleQueueEntry rows/logs; remove only obsolete battle/encounter queue jobs (do not FLUSHDB); clear transient Grind/Travel/Gathering/flee/map-transition state; set every Character's canonical location/status to Town/`map_town`.
4. Preserve Character rows and all persistent progression/inventory/equipment/currency/quest/mastery data. Preserve valid persisted Cooking/Crafting sessions and let existing reconciliation recreate their real-time jobs.
5. Apply the schema migration that adds `tickDurationMs` and starts the 500 ms runtime, then start the new backend and allow startup recovery/presence reconciliation to complete before reopening the game.

The cutover is intentionally destructive only to battle queue rows/logs and transient map/combat state; no Character deletion, inventory wipe, Redis database flush, or broad world reset is allowed. On rollback, stop the new version, repeat the targeted Town/queue cleanup, deploy the previous version and allow it to rebuild its old one-second queues. Since the cutover has already placed everyone in Town and no pre-cutover battle history is promised, no per-entry mixed-clock rollback layer is needed.

### 11. Record the deferred scale investigation as technical debt

Create `technical_debts/battle-queue-performance-benchmark/README.md`. It must capture the current host facts supplied by the user (8 vCPUs, Intel Xeon E5-2680 v3 @ 2.50 GHz, 15 GiB RAM, approximately 12 GiB available at observation time, 150 GB disk with 30 GB free), without claiming the host's capacity. The future investigation covers realistic simulations at 50, 100, 200, and 250–300 concurrent grinding Characters; queue-generation/resolution CPU, RAM, event-loop delay, PostgreSQL connection/lock/pool behavior, Redis/Bull wait/delay, job completion lag and queue-depth starvation; and the option of separating API from workers or splitting queues only if measurements justify it.

Record the accepted guardrails for that future benchmark: target average CPU at or below approximately 65–70%, brief spikes no higher than approximately 85%, no sustained 100% saturation; at least 20% of RAM (about 3 GiB on this host) available; resolution delay target average <100 ms, p95 <500 ms and p99 <1,000 ms. These are future measurement/acceptance targets, not claims or gates for this implementation. No load test is part of this change.

## Risks / Trade-offs

- [A remaining hard-coded 1,000 ms conversion desynchronizes the client or scheduled queue] → Centralize combat conversion helpers, audit every backend/frontend tick projection, record `tickDurationMs` per entry, and test all timeline consumers.
- [Tick-based and seconds-based catalogue fields are accidentally multiplied together] → Audit by typed field/unit; double only explicit tick fields and keep seconds fields untouched.
- [The attack gauge fires one tick early/late at fractional AS values] → Add deterministic tests at AS 0, 100, 200, 210, 300, 400, 600, 700 and 800, including exact event ticks and lock windows.
- [CTR's elapsed-time benefit is accidentally preserved or reduced by more than the intended 2x] → Keep the existing `CTR / 100` tick subtraction against doubled base cast ticks; test that each same rating removes the same number of ticks, now worth half as many seconds.
- [A high Move Speed crosses the new movement cap] → calculate the legal effective speed ceiling and test it; preserve wall-clock movement rather than silently increasing Move Speed.
- [Higher Bull concurrency creates same-Character races] → retain Redis/DB serialization and idempotency, and add parallel multi-Character plus same-Character regression scenarios.
- [A slow initial queue or late top-up looks like a frozen battle] → keep a truthful searching/preparing state and log queue-generation/job-delay separately from battle duration.
- [Deployment discards interrupted battle outcomes/logs] → schedule maintenance, make the data reset explicit and targeted, preserve all persistent Character data, and verify the rollback runbook.
- [The host cannot sustain the desired population] → do not claim capacity; defer real load testing and worker-topology decisions to the dedicated technical debt.

## Migration Plan

1. Implement the central 500 ms combat timebase and deterministic engine conversions, with focused shared-engine regression tests.
2. Convert tick-native catalogue fields and mirrored data; retain seconds-based source values and add catalogue mirror/schema validation.
3. Add `tickDurationMs` to BattleQueueEntry, log metadata and client DTOs; implement migration and API scheduling conversion.
4. Update all frontend event/timeline projection paths to consume entry metadata.
5. Configure bounded Bull handler concurrency, queue latency logs, and initial-queue/searching UX while preserving all existing locks and transactional invariants.
6. Add deterministic engine and focused API queue integration tests; build shared, API and frontend. No load test.
7. Update root/mirrored SPEC, ARCHITECTURE and STATUS; create the benchmark technical-debt note.
8. Execute the maintenance cutover only as part of the later apply/deploy session after backup/confirmation. This proposal session does not run it or deploy anything.

## Open Questions

None. Product behavior and the deployment strategy were confirmed before this design was written.
