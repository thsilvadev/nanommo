# Tasks

## 1. Redis presence becomes self-healing

- [x] 1.1 Keep `map:players:{mapId}` values as last-refresh timestamps and define stale-presence TTL (30s).
- [x] 1.2 Prune stale entries before `getPlayersOnMap` returns a count.
- [x] 1.3 Ensure concurrent refresh cannot be deleted by a stale prune that observed an older timestamp.
- [x] 1.4 Make `publishMapPresence` publish the post-prune count.

## 2. Authoritative server reconciliation

- [x] 2.1 Add a server-side reconciliation interval (10s) independent of Socket.IO connections.
- [x] 2.2 Refresh every authoritative active grinder (`status=grinding`, `currentMapId` set, `returnToTownAfterBattle=false`).
- [x] 2.3 Ensure disconnected grinders are included in reconciliation and remain in `playersInMap`.
- [x] 2.4 Exclude deferred-Town characters from reconciliation.
- [x] 2.5 Publish corrected counts for affected maps and stop the interval on gateway shutdown.
- [x] 2.6 Refresh and publish the affected map when each new battle is scheduled, ensuring a per-battle-cycle population update.

## 3. Socket lifecycle correction

- [x] 3.1 Remove map-presence deletion from `handleDisconnect()`.
- [x] 3.2 Keep online/socket cleanup on disconnect unchanged.
- [x] 3.3 Keep explicit map cleanup on map leave, death, battle Town return and other authoritative exits.

## 4. Complete authoritative exit coverage

- [x] 4.1 In `BattleService.queueBattles`, capture map ID before the projected-food/no-active-battle Town transition.
- [x] 4.2 After saving Town state, remove presence and publish the corrected count.
- [x] 4.3 Re-check every `currentMapId = null` / Town transition in API code and ensure each exit has explicit cleanup or reconciliation coverage.

## 5. Regression tests

- [x] 5.1 Prove stale Redis members are actually pruned and excluded from published count.
- [x] 5.2 Prove refreshed active members survive stale pruning.
- [x] 5.3 Prove disconnect does NOT remove presence for a character still grinding.
- [x] 5.4 Prove server reconciliation refreshes disconnected grinders.
- [x] 5.5 Prove `returnToTownAfterBattle=true` is not re-added by reconciliation.
- [x] 5.6 Prove queueBattles food-exhaustion/no-active-battle cleanup.
- [x] 5.7 Keep existing immediate/deferred leave, death and resolveBattle cleanup assertions.

## 6. Verification

- [x] 6.1 Run map presence tests.
- [x] 6.2 Run encounter-search regression test.
- [x] 6.3 Run shared/API/frontend production builds.
- [x] 6.4 Run strict OpenSpec validation.
- [x] 6.5 Run `git diff --check`.
- [ ] 6.6 Perform live authenticated smoke when the local stack is available.
