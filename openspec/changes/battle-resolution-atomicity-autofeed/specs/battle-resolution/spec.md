# Battle Resolution

## ADDED Requirements

### Requirement: Atomic idempotent battle resolution

The authoritative PostgreSQL effects of a BattleQueueEntry SHALL be committed in the same transaction as `resolved = true`. Resolution SHALL lock the Character row before the BattleQueueEntry row, and all database changes needed to apply the result SHALL use that transaction. If an authoritative database operation throws, the transaction SHALL roll back both the effects and the `resolved` marker so a retry or boot recovery can apply the battle safely. Concurrent callers for the same Character SHALL serialize, and a caller observing a committed resolved battle SHALL apply no rewards or inventory mutations again.

#### Scenario: A transaction fails while applying a battle

- GIVEN a BattleQueueEntry is unresolved and due
- WHEN a database operation in its authoritative resolution fails before commit
- THEN XP, HP/SP, inventory consumption/drops, Diet, equipment substitutions, kill counters, death/Town state, and future-row cleanup from that attempt are rolled back
- AND the BattleQueueEntry remains unresolved
- AND a retry can re-run the complete resolution.

#### Scenario: Duplicate jobs resolve the same entry

- GIVEN BullMQ and boot recovery or a duplicate BullMQ job attempt to resolve the same battle concurrently
- WHEN both callers enter resolution
- THEN Character locking serializes their database work
- AND exactly one transaction applies the battle effects and commits `resolved = true`
- AND the other caller skips the already-resolved entry without duplicating effects.

#### Scenario: External side effect fails after commit

- GIVEN the battle transaction committed all authoritative PostgreSQL effects and `resolved = true`
- WHEN BullMQ cleanup, map-presence synchronization, queue maintenance, or socket publication fails afterward
- THEN that external failure does not roll back or reapply the battle payout.

### Requirement: Auto Feed uses the latest retained digestion state

For repeated occurrences of the same food `itemId` in the retained ordered Diet, Auto Feed SHALL determine digestion eligibility from the newest retained occurrence, matching the authoritative `consumeFood()` guard. An expired older occurrence SHALL NOT make the same food eligible while its newest retained occurrence is still digesting. Auto Feed SHALL skip that food candidate and continue checking other retained food entries; this expected eligibility condition SHALL NOT become a battle-resolution ERROR.

#### Scenario: Older occurrence expired, latest occurrence still digesting

- GIVEN Diet contains an older bread entry whose digestion has ended and a newer bread entry whose `digestUntil` is in the future
- AND Auto Feed is enabled and bread is available in Inventory
- AND another retained food is eligible and available
- WHEN the authoritative battle resolution evaluates Auto Feed
- THEN bread is skipped without attempting to consume it
- AND the other eligible food may be consumed normally
- AND the battle resolves without an Auto Feed digestion error.
