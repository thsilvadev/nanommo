# Tasks

## 1. Domain and shared contract

- [x] 1.1 Add shared `TOWN_MAP_ID = 'map_town'` constant and export it.
- [x] 1.2 Add the shared TypeScript shape for `pendingMapTransition` (destination + current supported reason).
- [x] 1.3 Update Character/entity/DTO contracts so `currentMapId` is required and the pending transition is representable.

## 2. Static map catalog

- [x] 2.1 Add `map_town` to the canonical map catalog with explicit Town marker.
- [x] 2.2 Keep Town non-grindable and absent from monster encounter pools.
- [x] 2.3 Exclude Town from recommended/grindable map lists while retaining it as the canonical location.
- [x] 2.4 Reject `/maps/:mapId/enter` for Town so Town cannot accidentally enter the grind loop.

## 3. Database migration

- [x] 3.1 Add nullable `pendingMapTransition` JSONB.
- [x] 3.2 Migrate legacy `returnToTownAfterBattle=true` rows to an equivalent pending Town transition before dropping the legacy column.
- [x] 3.3 Backfill NULL `currentMapId` rows to `map_town`.
- [x] 3.4 Make `currentMapId` NOT NULL with default `map_town`.
- [x] 3.5 Remove `returnToTownAfterBattle`.
- [x] 3.6 Provide a reversible down migration.

## 4. Presence architecture

- [x] 4.1 Change MapPresenceService's generic membership predicate to `currentMapId is set AND pendingMapTransition is null`, independent of status.
- [x] 4.2 Keep `countActiveGrinders(mapId)` explicitly status-filtered for encounter timing.
- [x] 4.3 Update reconciliation to include Town residents and use the same generic membership rule.
- [x] 4.4 Preserve timestamped Redis hashes, stale pruning and absolute count publication.
- [x] 4.5 Add internal map-membership transition publication for connected socket room synchronization.
- [x] 4.6 Keep OnlinePresenceService separate; do not couple heartbeat/online presence to gameplay map membership.

## 5. Map and battle transition logic

- [x] 5.1 Update MapService normal map entry/exit to persist canonical `currentMapId` values.
- [x] 5.2 Replace deferred Town handling with `pendingMapTransition.destinationMapId = map_town`.
- [x] 5.3 Preserve future queue cancellation and active-battle completion semantics.
- [x] 5.4 Finalize pending Town transition after active battle resolution.
- [x] 5.5 Route death and food-exhaustion exits directly to `map_town`.
- [x] 5.6 Replace all battle/controller guards using `returnToTownAfterBattle` with the generic pending-transition semantics.
- [x] 5.7 Remove all writes/reads of `returnToTownAfterBattle` from production code.

## 6. Socket transport

- [x] 6.1 Subscribe NanommoGateway to the internal map-membership transition channel.
- [x] 6.2 Move connected sockets between map rooms on authoritative transitions.
- [x] 6.3 Join `map:map_town` for connected Town residents.
- [x] 6.4 Emit a fresh absolute presence snapshot after room changes.
- [x] 6.5 Preserve existing client-facing `map:presence { mapId, playersOnMap }` contract.

## 7. Frontend

- [x] 7.1 Make Character.currentMapId required in the frontend model.
- [x] 7.2 Replace null/undefined Town fallbacks with `TOWN_MAP_ID`.
- [x] 7.3 Render Town's realtime `playersInMap` count.
- [x] 7.4 Remove local state patches that clear currentMapId to undefined.
- [x] 7.5 Keep the existing Town tile/panel and all established layout/scaling conventions unchanged.

## 8. Regression coverage

- [x] 8.1 New character starts in `map_town`.
- [x] 8.2 Town residents are counted in Town presence.
- [x] 8.3 Town -> grind map decrements Town and increments target map.
- [x] 8.4 Grind map -> Town decrements old map and increments Town.
- [x] 8.5 Deferred Town during active battle removes old-map presence immediately.
- [x] 8.6 Deferred Town resolution adds presence to Town exactly once.
- [x] 8.7 Death moves map presence old -> Town.
- [x] 8.8 Food exhaustion moves map presence old -> Town.
- [x] 8.9 Disconnected Town/grinding characters remain present.
- [x] 8.10 Reconciliation restores missing Town and grind-map memberships.
- [ ] 8.11 Stale Redis members are pruned for every map, including Town.
- [x] 8.12 Encounter-search timing still counts only active grinders and does not count Town residents.
- [x] 8.13 No production source reference to `returnToTownAfterBattle` remains.
- [ ] 8.14 Socket room transition works for REST/battle-driven changes when a socket is connected.

## 9. Documentation and verification

- [x] 9.1 Update `SPEC.md` and `openspec/specs/SPEC.md` so Town is a real map and NULL is no longer a location sentinel.
- [x] 9.2 Update `ARCHITECTURE.md` with the location/pending-transition/presence ownership boundaries and internal room-transition flow.
- [x] 9.3 Update `PLAY_WINDOW_SPEC.md` only where the Town map/presence UI contract requires it.
- [x] 9.4 Update `STATUS.md` with migration, verification and architectural traps discovered.
- [x] 9.5 Run shared/API/frontend builds.
- [ ] 9.6 Run map-presence, cleanup, encounter-search and migration regression tests.
- [x] 9.7 Run strict OpenSpec validation.
- [x] 9.8 Run `git diff --check`.
- [ ] 9.9 Perform live authenticated smoke when the local stack is available; do not claim it when unavailable.
