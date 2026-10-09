# Proposal — Atomic Battle Resolution and Auto Feed Eligibility

## Why

A normal Auto Feed candidate check can select an expired older Diet entry even when the newest retained occurrence of that same food is still digesting. `InventoryService.consumeFood()` correctly rejects the attempt, but the rejection currently escapes into `BattleQueueProcessor` as an ERROR. More importantly, battle resolution previously committed `BattleQueueEntry.resolved = true` before applying XP, inventory, Diet, equipment, kill-counter and routing effects. Any later exception could therefore leave a partially applied battle that retries would skip.

## What changes

- For repeated `itemId` values in the ordered three-slot Diet, Auto Feed eligibility follows only the newest retained occurrence. If that occurrence is still digesting, skip that item and continue checking other food candidates.
- Treat `Food is still digesting` as an ordinary eligibility race inside Auto Feed, not as a battle-resolution failure. Other unexpected errors must still propagate.
- Apply authoritative PostgreSQL battle effects and commit `resolved = true` atomically in a single transaction. Acquire row locks in Character → BattleQueueEntry order, and make inventory, pending equipment, Diet, drop, kill-counter and death/Town queue changes use the same `EntityManager`.
- Keep BullMQ job cleanup, Redis map-presence synchronization, queue rebuilds and socket publication outside the transaction. Those external side effects run only after the authoritative database state has committed.
- Add a repeated-food Auto Feed regression and update the committed concurrent-resolution integration test to validate the transaction/idempotency contract rather than its old conditional-UPDATE implementation detail.

## Non-goals

- No schema migration or new persisted resolution state.
- No change to the Diet's three-slot FIFO/streak semantics, food durations, or eligibility rules beyond matching Auto Feed to `consumeFood()`'s newest-retained-entry rule.
- No change to shared battle simulation, monster outcomes, or the frontend.
- No production deployment.

## Acceptance

1. An expired older Diet occurrence cannot make a repeated food eligible while its newest occurrence is digesting.
2. Auto Feed skips that food and can consume a different eligible food without emitting an ERROR.
3. If any authoritative database write in battle resolution fails, XP/resources, inventory, Diet, equipment substitutions, kill counters, death routing, future-row cleanup and `resolved` all roll back together.
4. Concurrent or retried callers apply authoritative battle effects at most once; a successful retry applies them completely.
5. Existing queue advancement, Town/death routing, post-commit presence/event behavior, and overflow handling remain intact.
6. API build, targeted Diet/Auto Feed regression, idempotency integration script syntax, strict OpenSpec validation and `git diff --check` pass. Live database/Redis race execution is separately recorded if the local stack is available.
