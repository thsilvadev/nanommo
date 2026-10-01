# Design

## Context

The previous loadSeq change only orders concurrent HTTP responses within each store. It does not distinguish a response that started before a websocket event from one that started after it, and the UI still projects HP/SP and item quantities from BattleQueueEntry.log.

## Goals / Non-Goals

**Goals:**
- Make post-resolution Character and Inventory one coherent server snapshot.
- Establish causal ordering between HTTP refreshes and realtime snapshots.
- Remove battle-state projections from resource presentation.
- Preserve the existing server-authoritative battle engine and Socket.IO transport.

**Non-Goals:**
- No new gameplay clock, polling loop, client-side combat simulation, or battle mechanics.
- No changes to combat outcomes, regeneration rules, item consumption rules, or queue timing.

## Decisions

1. Battle resolution publishes the complete resource snapshot. The resolver already owns authoritative HP/SP, item consumption, drops, level changes, and Town transition. After all mutations are persisted, it publishes Character + Inventory together.
2. The server revision is Character.stateVersion, a TypeORM VersionColumn incremented by Character saves. The resolver saves Character after inventory/drop mutations, so the revision represents the completed battle state without depending on wall-clock timestamp precision.
3. Frontend stores use a causal barrier. Every HTTP load captures the store realtime generation. If a realtime snapshot is accepted while that request is in flight, its response is discarded. Existing request sequencing remains as a second guard for same-generation HTTP races.
4. Resource rendering reads stores only. Character Summary reads CharacterStore hpCurrent/spCurrent; Inventory Grid reads InventoryStore quantity. Battle logs remain presentation data for battle visuals and event feed, not resource authority.
5. Older realtime revisions are ignored. The store keeps the last accepted server revision and refuses a snapshot with an equal or older revision.
6. Cross-channel ordering is closed at the producer boundary. After a battle resolves, the following `battle:queueUpdated` carries the same Character + Inventory snapshot and revision as `battle:resolved`; the frontend accepts either event as an authoritative state update. This prevents Redis subscriber/channel scheduling from exposing the previous state during the encounter-search gap.

## Risks / Trade-offs

- The full inventory is slightly larger than the previous lightweight resolution event, but it removes an otherwise unavoidable race between separate Character and Inventory fetches.
- Non-battle REST mutations continue to use their existing response/load paths; battle resolution is the only flow that requires an atomic Character + Inventory realtime snapshot.

## Migration Plan

Add the Character.stateVersion VersionColumn with a forward/backward migration. Existing characters start at revision 1. The websocket payload is additive for clients that ignore the additional snapshot fields.
