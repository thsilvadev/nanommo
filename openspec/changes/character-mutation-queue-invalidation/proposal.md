# Proposal

## Change

Connect character combat-state mutations to the existing battle-queue invalidation/rebuild boundary.

## Why

The current grind loop already has one authoritative mechanism for changes that invalidate pre-simulated future battles: discard every unresolved queue entry, cancel its BullMQ job, and rebuild the queue from the new authoritative character state.

That mechanism is currently used by level-up, equipment changes and Auto Feed, but three REST mutations that can change future combat simulation are not connected to it:

- editing the currently active Gambit page;
- activating a different Gambit page;
- spending attribute points.

As a result, the Character can change while four or five future BattleQueueEntry rows still contain snapshots produced from the previous Gambit/stat state. queueBattles() alone cannot fix this because it intentionally returns the existing queue when it is already at depth 5.

The change must also respect the established rule that a battle already in progress is immutable: Gambit activation/editing and attribute allocation remain allowed while the current battle is running, but they must never modify or re-simulate that battle. Their stale future entries are discarded while the active entry and its scheduled resolution remain intact; the future chain is rebuilt after the current battle resolves.

## What changes

- Add one reusable BattleService mutation boundary that:
  - persists the mutation without changing an already-running battle;
  - when a battle is active, preserves that active entry/job, discards only stale future entries/jobs, and defers rebuilding until the active battle resolves;
  - when no battle is active, discards unresolved stale entries/jobs and immediately rebuilds to the normal depth of 5 from the post-mutation authoritative Character + Equipment + Inventory + active Gambit state;
  - publishes the authoritative queue state through the existing battle:queueUpdated event.
- Connect CharacterService.spendAttributePoints() to that boundary after a successful attribute mutation.
- Connect GambitService.updateGambitPage() only when the edited page is the character's active page.
- Connect GambitService.activateGambitPage() when the selected page differs from the current active page.
- Preserve edits to inactive Gambit pages without queue invalidation, because they cannot affect the current/future simulation until activated.
- Preserve no-op activation of the already-active page without invalidation.
- Enforce the active-battle immutability boundary server-side for all three combat-state mutations; frontend disabling is UX only and mutation acceptance is not blocked by an active battle.
- Ensure failed validation mutations do not discard or rebuild the queue.
- Reuse the existing invalidation semantics already exercised by level-up/equipment/food rather than introducing a second recalculation implementation.
- Keep the client server-authoritative: the frontend consumes the authoritative mutation response and the resulting queue update; it does not simulate or rebuild battles locally.
- Add committed re-runnable regression coverage for Gambit edit, Gambit activation and attribute allocation, including stale-entry deletion, BullMQ job cancellation, queue depth, updated battle snapshots and the active-battle rejection boundary.
- Update the authoritative project documentation only after implementation/verification so the new mutation boundary is explicit.

## Non-Goals

- No new battle engine rules.
- No changes to how a battle already in progress is simulated or resolved.
- No client-side battle simulation.
- No new queue storage model, scheduler, socket event type or API endpoint.
- No changes to equipment/effect semantics.
- No migration or database schema change is expected.
- No production deployment.

## Acceptance

1. An attribute spend performed between battles changes the authoritative Character and leaves a fresh 5-entry queue whose snapshots contain the new derived statistics; the previous unresolved entries are gone and their BullMQ jobs are gone.
2. Activating a different Gambit page between battles changes the authoritative active page and rebuilds the future queue from that page.
3. Editing the currently active Gambit page between battles rebuilds the future queue from the edited page.
4. Editing an inactive Gambit page does not invalidate the queue.
5. Activating the already-active page is a no-op and does not invalidate the queue.
6. Attribute spending, active-page activation, and active-page editing are accepted while a battle is in progress; the current battle remains untouched and only stale future entries are invalidated.
7. A failed Gambit validation does not delete or replace any pending queue entry.
8. Every successful future-combat-state mutation uses the same discard/cancel/rebuild boundary as the existing level-up/equipment flow.
9. A rebuilt queue is topped back to the canonical depth of 5 whenever the character remains grinding and is eligible to continue.
10. The server emits the normal battle:queueUpdated snapshot after the mutation-triggered rebuild.
11. Shared/API/frontend builds, relevant regression scripts, strict OpenSpec validation and git diff --check pass.
