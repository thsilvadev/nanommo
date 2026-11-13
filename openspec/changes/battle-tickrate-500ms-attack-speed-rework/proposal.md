# Proposal

## Why

Basic Attack Speed investment currently has poor moment-to-moment feedback: the existing gauge formula and resolving lock quantize meaningful AGI gains into long, coarse intervals. A character at 210 Attack Speed still observes roughly one basic attack every nine seconds, making repeated AGI investment feel unrewarding. Moving battle simulation to 500 ms ticks allows a more legible attack cadence without accelerating skills, cooldowns, statuses, regeneration, movement, travel, or other game systems.

## What Changes

- **Combat clock:** change the deterministic battle simulation from 1,000 ms to 500 ms per tick through validated `BATTLE_TICK_DURATION_MS=500`. Keep simulation integer-tick-based and server-authoritative; wall-clock timestamps remain the source of truth for scheduling and client presentation.
- **Basic Attack Speed redesign:** replace the old 10-to-1 preparation-tick curve with a 0-to-16 half-second preparation curve over effective Attack Speed 800-to-0. Clamp effective Attack Speed to 0–800. Keep a separate, fixed two-tick (1 second) basic-attack resolving lock. Expected total interval: 9 seconds at AS 0, about 7 seconds at AS 210 after tick quantization, and 1 second at AS 800.
- **Preserve all other elapsed-time behavior:** double tick-native cast durations, cooldowns, monster basic-attack intervals, status durations, periodic damage intervals, resource-regeneration periods, food digestion/expiry timers, and any other battle timer that must keep its existing real-time duration. Keep seconds-based item/catalogue values in seconds and convert them at the simulation boundary.
- **Cast Time Reduction:** preserve base skill cast durations in seconds by doubling tick-native base cast values, but retain the current CTR rating and `CTR / 100` tick-subtraction/rounding rule. Each removed tick now represents 500 ms, so the same CTR rating removes half as many real seconds as before. This is an explicit, intentional CTR-efficiency reduction.
- **Battle movement:** change the movement-gauge threshold from 100 to 200, continue accumulating effective Move Speed on each 500 ms tick, and resolve movement only at one-second boundaries (every two combat ticks), at most one space per boundary. Keep Move Speed values, movement intent rules, world movement speed and the existing one-space-per-second ceiling unchanged.
- **Gambits:** remove the temporal `every_n_ticks` condition from the evaluator and monster data. Change the affected monster's stun line to `always`; the skill's own cooldown and normal action-legality checks govern when it can execute.
- **Queue and frontend timing:** retain the five-entry precomputed queue and server authority. Record `tickDurationMs` with each battle entry/log and use it for every client-side event/timeline projection (battle bars, event status/resource projection, hit feedback, and battle audio). A client must never infer an attack result or invent progress while waiting for an authoritative queue entry.
- **Queue consumers:** keep the current Bull queue and backend deployment topology, but configure bounded per-handler concurrency through `BATTLE_RESOLVE_CONCURRENCY=4`, `BATTLE_QUEUE_CONCURRENCY=2`, and `WORLD_ACTIVITY_CONCURRENCY=1`. These are conservative starting limits, not capacity guarantees. Preserve Redis per-character serialization, PostgreSQL row locks, transaction idempotency, and post-commit socket publication.
- **Queue experience:** prioritize initial queue preparation when entering Grind. Keep the existing searching/preparing state visible when the server has not supplied the next battle; avoid stale snapshots and unexplained frozen bars when queue top-up is late or a mutation invalidates future battles.
- **Deployment cutover:** use a planned downtime and a deliberately simple alpha reset rather than mixed-tick battle compatibility. Preserve Character progression and persistent game data, clear old battle queue/log records and obsolete combat jobs, and place all characters in `map_town` before the new runtime starts.
- **Documentation:** update `SPEC.md`, its maintained OpenSpec mirror, `ARCHITECTURE.md`, and `STATUS.md`. Correct §11.4's encounter-search description to match the already-implemented formula and counting behavior; this documentation correction does not change encounter timing.
- **Technical debt:** create a dedicated debt entry for future queue/performance benchmarking (50, 100, 200, and 250–300 concurrent characters) and possible API/worker separation. Do not build a load-test suite or claim a 250–300-player capacity in this change.

## Capabilities

### New Capabilities

- `battle-combat-timing`: 500 ms deterministic combat ticks, Attack Speed curve and lock, preserved base/timer durations with the explicitly reduced real-time CTR efficiency, movement-gauge conversion, and removal of tick-scheduled Gambit conditions.
- `battle-queue-lifecycle`: authoritative precomputed queue lifecycle, tick-duration metadata, safe concurrent consumers, observable queue waiting/replenishment, and planned alpha deployment reset.

### Modified Capabilities

None. The repository currently has no registered capability specs (`openspec list --specs` returns no specs); these two capabilities establish the initial behavior contracts for this change.

## Impact

- Shared simulation: `packages/shared/src/battle-engine/**` and related battle types/tests.
- API scheduling and persistence: `apps/api/src/modules/battle/**`, `apps/api/src/modules/map/**`, battle queue entity/migrations, queue recovery, DTOs and configuration.
- Data catalogues: root and frontend mirrors of `monsters.json`, `skill_trees.json`, `status_effects.json`, and any other catalogue fields found by the timing audit. Seconds-based source values remain seconds.
- Frontend: Grind battle/status projection in `features/play/components.ts`, `core/game.store.ts`, `shared/battle-hit-feedback.ts`, `shared/game-audio.service.ts`, and any additional tick-to-time projection found by repository-wide search.
- Runtime configuration: `.env.example`, Docker/backend environment forwarding, and deployment instructions for all new variables.
- Documentation: `SPEC.md`, `openspec/specs/SPEC.md`, `ARCHITECTURE.md`, `STATUS.md`, and `technical_debts/battle-queue-performance-benchmark/README.md`.
- No new infrastructure service, dedicated worker deployment, queue split, load-test project, broad gameplay rebalancing, or unrelated frontend redesign.
