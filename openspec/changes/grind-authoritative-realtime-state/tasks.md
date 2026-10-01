# Tasks

## 1. Authoritative backend snapshot

- [x] 1.1 Extend the battle-resolution event contract with a server revision, full Character DTO, and complete inventory snapshot, and verify the payload type compiles.
- [x] 1.2 Publish the snapshot only after all battle Character and Inventory mutations are persisted; add the persistent Character VersionColumn and migration used as the revision.
- [x] 1.3 Extend the battle gateway smoke to assert the authoritative resolution snapshot and the subsequent queue advance after battle resolution.

## 2. Frontend causal synchronization

- [x] 2.1 Add realtime revision/generation guards to CharacterStore and InventoryStore so in-flight HTTP responses cannot overwrite a newer websocket snapshot, and verify with out-of-order unit tests.
- [x] 2.2 Apply the battle-resolution snapshot atomically to CharacterStore and InventoryStore, rejecting older realtime revisions, and verify newer updates still apply.
- [x] 2.4 Carry the same authoritative snapshot on the post-resolution `battle:queueUpdated` event so cross-channel delivery order cannot expose a stale search-state snapshot.
- [x] 2.3 Remove battle.active()-based HP/SP and inventory quantity projections from CharacterSummary and InventoryGrid, and verify the components render store authority during search and battle transitions.

## 3. Regression coverage and documentation

- [x] 3.1 Add/extend tests for old HTTP after new websocket and old websocket after new websocket for both Character and Inventory.
- [x] 3.2 Update STATUS.md with the root cause, failed prior strategy, authoritative source, and verification evidence.
- [x] 3.3 Update SPEC.md and openspec/specs/SPEC.md where the authoritative realtime contract was not explicit, without changing unrelated gameplay rules.
- [x] 3.4 Run shared/API/frontend builds, the focused frontend synchronization suite, OpenSpec strict validation, and git diff --check; live gateway smoke is documented separately because the local API was not running. No deploy.
