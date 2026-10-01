# Proposal

## Why

Character HP/SP and Inventory can regress visually during the encounter-search gap because the frontend combines battle-log projections with Character/Inventory HTTP snapshots that may have started before a newer authoritative websocket update. Existing request sequencing orders responses but does not establish causal ordering between HTTP and realtime sources.

## What Changes

- Publish one authoritative post-resolution Character + Inventory snapshot with a monotonic server revision.
- Treat that snapshot as the frontend source of truth outside an active battle; during an active battle, retain the existing read-only HP/SP display projection from the immutable queued battle log without writing it back into resource stores.
- Make HTTP refreshes causal: a response that was in flight when a newer realtime snapshot arrived cannot replace that snapshot.
- Ignore realtime snapshots whose revision is older than the currently accepted snapshot.
- Add deterministic regression tests for battle-resolved → searching → next battle and out-of-order HTTP/realtime delivery.
- Update the Grind synchronization contract and project status with the diagnosed root cause and evidence.

## Capabilities

### New Capabilities
- realtime-character-inventory: authoritative Character/Inventory synchronization across battle and encounter-search transitions.

### Modified Capabilities

## Impact

Affected areas are the battle resolution websocket payload, Character/Inventory frontend stores, Character Summary and Inventory Grid presentation, and focused API/frontend synchronization tests. No gameplay rules, combat simulation, or production deployment are changed.
