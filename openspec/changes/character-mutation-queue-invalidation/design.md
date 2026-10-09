# Design

## 1. Existing invariant

BattleQueueEntry rows are precomputed combat results. Their log.header.characterSnapshot, hpAfter, spAfter, item consumption and outcomes describe the state used when the entry was simulated.

Therefore changing any state that affects a future simulation invalidates the unresolved chain. The existing authoritative pattern is:

1. keep the already-resolved/current battle untouched;
2. discard unresolved entries;
3. remove their BullMQ jobs;
4. rebuild from the current persisted Character state to depth 5.

queueBattles() by itself is intentionally insufficient because it returns the existing queue when it already has five entries.

## 2. One mutation boundary

Add a single public method on BattleService representing the mutation boundary, conceptually:

assertSafeForFutureCombatMutation(characterId) + invalidateAndRebuildAfterMutation(characterId)

The exact names are implementation details, but the behavior is not.

The boundary is the only place that decides whether a future combat-state mutation may replace the pending queue. It reuses the existing private unresolved-entry/job cleanup logic rather than duplicating BullMQ deletion in CharacterService or GambitService.

For a character that is no longer grinding, has no canonical map, or has a pending Town transition, the boundary must not create a grind queue. Existing Town/pending-transition semantics remain authoritative.

For a grinding character that remains eligible after the mutation, the boundary discards the unresolved chain and invokes the existing queueBattles(characterId, 5, true) path so the client receives the authoritative rebuilt queue.

## 3. Active-battle rule

A mutation is allowed to change the authoritative Character/Gambit state while a battle is running, but it is never allowed to alter the battle that is already running.

The backend MUST determine the active battle from the authoritative unresolved queue, using the established time window:

startAt <= now < endAt

When an active battle exists, the mutation is persisted normally. The active BattleQueueEntry and its BullMQ resolution job are preserved exactly as they are. Only unresolved entries after that active battle are stale and are discarded. The future chain is rebuilt after the active battle resolves, using the post-mutation authoritative state.

This rule applies to:

- spendAttributePoints;
- activation of a different Gambit page;
- any write to the currently active Gambit page, including title/line changes.

It does not apply to edits of inactive Gambit pages because those pages are not part of the active combat simulation.

The frontend may grey out/disable relevant controls only if that is an existing UX choice, but there is no server-side 409 restriction for these mutations during an active battle. Server authority is expressed by preserving the immutable active snapshot and invalidating stale future snapshots.

## 4. Gambit semantics

### 4.1 Active page edit

When updateGambitPage() targets the character's activeGambitPageId, a successful validated write changes the combat script used for future battles and therefore triggers the mutation boundary.

Validation must finish first. A 400 validation failure MUST leave both the saved page and the queue unchanged.

### 4.2 Inactive page edit

When the edited page is not active, persist the page normally and do not touch the battle queue.

This preserves the intended workflow of preparing another Gambit page while the current page keeps driving combat.

### 4.3 Activation

When activateGambitPage() targets a page different from the current active page:

1. verify the page belongs to the character;
2. persist the new activeGambitPageId;
3. if a battle is active, preserve that battle and discard only stale future entries; otherwise invalidate/rebuild the unresolved future queue immediately;
4. when the active battle resolves, rebuild the future queue from the newly active page;
5. publish the authoritative queue state.

Selecting the already-active page is a no-op and must not invalidate anything.

## 5. Attribute semantics

spendAttributePoints() is a combat-state mutation because STR/AGI/DEX/VIT/INT/SOR feed derived combat statistics.

The operation must validate the requested point spend first. After the authoritative Character update succeeds, the same mutation boundary invalidates/rebuilds the future queue.

The rebuilt queue MUST be simulated from the persisted post-spend Character state, so its first log.header.characterSnapshot reflects the changed attributes/derived values.

No frontend formula calculation is introduced.

## 6. Keep the current battle untouched

The current battle is never edited, re-simulated or replaced by this change.

When a mutation is accepted during the active-battle window, the active BattleQueueEntry and its scheduled resolution job remain untouched. Every unresolved entry after it is stale and is discarded. No replacement future battle is scheduled while the current battle is still running.

Once the current battle resolves, the normal queue-advance path rebuilds the missing future entries from the already-persisted post-mutation Character/Gambit state. This is the point at which the next battle can legitimately depend on the mutation.

## 7. Dependency shape

The current BattleService already owns the canonical queue rebuild mechanics and already depends on CharacterService for existing gameplay operations.

To let Character/Gambit call the same boundary without duplicating queue code:

- expose the narrow mutation operation from BattleService;
- inject BattleService into CharacterService and GambitService;
- resolve the existing Character <-> Battle service cycle with Nest's forwardRef on the affected module/provider edges;
- change BattleModule's CharacterModule import to the corresponding forwardRef;
- do not create a second queue service that copies queueBattles() or BullMQ cleanup.

This keeps queue ownership in the Battle module and makes the invalidation rule explicit.

## 8. Event and frontend behavior

A successful mutation-triggered rebuild uses the existing battle:queueUpdated event contract. No new socket event is needed.

The REST mutation response remains authoritative for Character/Gambit state. The queue event supplies the authoritative rebuilt queue.

The frontend must not predict the new queue, mutate queue snapshots locally, or invent a client-side "recalculate" algorithm. Its responsibility is only to consume the mutation response and the normal queue update.

During an active battle the frontend continues to consume the successful authoritative mutation response. It must not locally modify the active battle snapshot or invent a replacement queue; the server publishes the preserved active entry and later publishes the rebuilt future queue through the existing contract.

## 9. Existing mutation paths that must remain consistent

The new boundary is additive but should be used to remove divergence where the current code already manually performs the same sequence.

The implementation SHOULD route the existing post-level-up/equipment/Auto Feed rebuild sequence through the same helper where that can be done without changing their established semantics.

At minimum, both paths must continue to mean:

discard unresolved -> rebuild from authoritative state

No second implementation of queue invalidation is permitted.

## 10. Queue and job correctness

For each successful mutation while grinding:

- every unresolved old BattleQueueEntry is deleted;
- every old unresolved BullMQ job is cancelled/removed;
- the replacement queue contains up to the canonical target depth of 5 according to existing eligibility rules;
- the first replacement entry uses the post-mutation Character state;
- no deleted entry can later resolve and apply stale rewards/effects;
- the battle:queueUpdated payload describes the replacement queue.

Do not reuse old queue entries merely because their monster/map is unchanged; the simulation snapshot is the reason they are invalid.

## 11. Failure boundaries

Validation errors happen before queue invalidation.

If a mutation succeeds but queue regeneration encounters an infrastructure error, do not fabricate a client-successful queue. Preserve the existing server recovery/read-path behavior and log the rebuild failure for diagnosis. The implementation must not silently report a successful recalculation when no replacement queue exists.

## 12. Verification strategy

Use the repository's established re-runnable Node-script pattern (fetch + pg + ioredis) rather than introducing new test infrastructure.

The regression script should make stale-vs-fresh state observable by recording:

- old unresolved entry ids;
- old BullMQ job ids;
- character active Gambit/attributes before and after;
- the first rebuilt entry's log.header.characterSnapshot;
- the final unresolved queue depth;
- whether old rows/jobs remain.

The active-battle scenario should place the first queue entry inside startAt <= now < endAt, perform each combat-state mutation successfully, verify that the active entry id/job/snapshot remain unchanged while stale future entries disappear, and verify that the next queue is rebuilt from the updated state after the active battle resolves.

## 13. Documentation

After implementation and verification:

- root SPEC.md and openspec/specs/SPEC.md: make attribute allocation's recalculation and the active-battle protection explicit; clarify the shared mutation boundary.
- ARCHITECTURE.md: document BattleService as the owner of future-queue invalidation and the Character/Gambit mutation callers.
- STATUS.md: record the previous missing connections, the final invariant, and committed verification evidence.

No visual/layout document needs a gameplay rule change unless the frontend implementation adds a control-state note.

## 14. No migration

This is a behavior/coordination change over existing Character, GambitPage and BattleQueueEntry data. No schema migration is expected.
