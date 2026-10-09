# Tasks

Reference: specs/character-mutation-queue-invalidation/spec.md.

## 1. Baseline and implementation audit

- [x] 1.1 Re-read root STATUS.md, SPEC.md, openspec/specs/SPEC.md, ARCHITECTURE.md, PLAY_WINDOW_SPEC.md, and the latest Gambit/equipment/queue-related changes before implementation.
- [x] 1.2 Reconfirm the current BattleService discard/rebuild paths and the exact active-battle predicate used by the code.
- [x] 1.3 Preserve the user's pre-existing working-tree change in apps/frontend/src/app/features/play/components.ts; do not overwrite, reformat or include it accidentally.

## 2. Central mutation boundary

- [x] 2.1 Add one BattleService-owned operation for the future-combat mutation boundary, reusing the existing unresolved-entry deletion and BullMQ job cancellation code.
- [x] 2.2 Make the boundary preserve an active battle snapshot/job while invalidating only stale future entries.
- [x] 2.3 Make the boundary rebuild only when the character is still eligible to grind; preserve Town and pending-transition behavior.
- [x] 2.4 Publish the normal battle:queueUpdated payload after a successful mutation-triggered rebuild.
- [x] 2.5 Refactor existing level-up/equipment/Auto Feed rebuild call sites to use the same helper when this can be done without changing established semantics.

## 3. Attribute allocation

- [x] 3.1 Inject the BattleService boundary into CharacterService using explicit Nest circular-dependency handling (forwardRef) rather than duplicating queue code.
- [x] 3.2 On a successful spendAttributePoints(), invalidate/rebuild the future queue from the resulting authoritative Character state.
- [x] 3.3 Allow attribute allocation during an active battle while preserving the active BattleQueueEntry/job and invalidating only stale future entries.
- [x] 3.4 Keep existing validation atomic from the caller's perspective: invalid point requests do not trigger queue invalidation.

## 4. Gambit mutations

- [x] 4.1 Inject the BattleService boundary into GambitService.
- [x] 4.2 In updateGambitPage(), validate/canonicalize first, then trigger invalidation only when the target page is the active page.
- [x] 4.3 Leave inactive-page edits completely outside the queue invalidation path.
- [x] 4.4 In activateGambitPage(), allow active-battle changes while preserving the active battle and invalidating only stale future entries.
- [x] 4.5 Rebuild after activating a different page.
- [x] 4.6 Treat activation of the already-active page as a no-op without queue invalidation.
- [x] 4.7 Ensure active-page validation/save failures never discard an existing queue.

## 5. Nest module dependency correctness

- [x] 5.1 Add the minimal forwardRef module/provider changes required for CharacterService <-> BattleService.
- [x] 5.2 Keep BattleService as the sole owner of queue reconstruction/deletion; do not introduce a duplicate scheduler/queue service.
- [x] 5.3 Confirm GambitModule can consume the boundary without introducing a second dependency cycle.

## 6. Regression verification

- [x] 6.1 Create a committed re-runnable mutation regression script following the existing apps/api/test-phase3-*.js pattern.
- [x] 6.2 Add the attribute scenario: capture 5 old entries/jobs, spend an attribute, assert old rows/jobs disappear, assert 5 replacement entries and a changed snapshot/derived stat.
- [x] 6.3 Add active Gambit activation scenario: switch A -> B, assert active page B, old rows/jobs gone, replacement snapshots use B.
- [x] 6.4 Add active Gambit edit scenario: edit active page, assert old rows/jobs gone and replacement simulation uses the edited page.
- [x] 6.5 Add inactive Gambit edit scenario: edit inactive page and assert queue row ids/jobs remain unchanged.
- [x] 6.6 Add already-active activation scenario and assert it is a no-op for the queue.
- [x] 6.7 Add active-battle preservation scenarios for attributes, active-page activation and active-page edit; assert successful mutation, unchanged active entry/job/snapshot, stale future deletion, and post-resolution queue rebuild.
- [x] 6.8 Add a failed-validation scenario proving the queue is unchanged when an active Gambit save is rejected.
- [ ] 6.9 Assert battle:queueUpdated is emitted/observable for successful mutation-triggered rebuilds using the existing transport/verification mechanism available in the repository.

## 7. Frontend integration

- [x] 7.1 Keep CharacterStore authoritative for the REST mutation response.
- [x] 7.2 Refresh/consume the rebuilt BattleStore queue from the existing battle:queueUpdated path; do not calculate queue data in Angular.
- [x] 7.3 Keep Character/Gambit state server-authoritative after successful mutation and consume the queue update; do not locally recalculate battle snapshots.
- [ ] 7.4 Add only the minimum active-battle control-state UX needed; no new visual system and no layout redesign.

## 8. Documentation

- [x] 8.1 Update SPEC.md and openspec/specs/SPEC.md to make attribute-allocation queue recalculation and active-battle protection explicit.
- [x] 8.2 Update ARCHITECTURE.md with BattleService queue-invalidation ownership and Character/Gambit call boundaries.
- [x] 8.3 Update STATUS.md with the original missing connections, the final invariant and re-runnable verification evidence.
- [ ] 8.4 Update PLAY_WINDOW_SPEC.md only if the implemented active-battle control-state behavior requires a presentation contract.

## 9. Verification and hygiene

- [ ] 9.1 Run the focused mutation regression script(s) against the local stack.
- [x] 9.2 Run pnpm --filter @nanommo/shared build.
- [x] 9.3 Run pnpm --filter @nanommo/api build.
- [x] 9.4 Run pnpm --filter @nanommo/frontend build.
- [x] 9.5 Run pnpm exec openspec validate character-mutation-queue-invalidation --strict.
- [x] 9.6 Run git diff --check.
- [x] 9.7 Verify no production deployment is performed.
- [x] 9.8 Before finalizing implementation, verify the pre-existing modification in apps/frontend/src/app/features/play/components.ts remains untouched unless explicitly included by the user.

## 10. Review traps

- [x] 10.1 Do not call queueBattles() without first discarding stale unresolved entries; a full queue causes queueBattles() to return the old snapshots unchanged.
- [x] 10.2 Do not invalidate for inactive Gambit edits.
- [x] 10.3 Do not invalidate when re-activating the already-active page.
- [x] 10.4 Allow active Gambit/attribute mutation during an in-flight battle, but never modify/re-simulate the in-flight battle; invalidate only its stale future chain.
- [x] 10.5 Do not let CharacterService/GambitService delete BullMQ jobs directly.
- [x] 10.6 Do not add a client-side "recalculate battle" algorithm.
- [x] 10.7 Do not convert this into a schema/migration change without concrete repository evidence.
