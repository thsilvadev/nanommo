# Design

## Context

Map population is represented by Redis hashes:

`map:players:{mapId}` → `characterId -> lastRefreshTimestamp`

The frontend receives `map:presence` through the existing `/game` Socket.IO connection. Encounter-search timing already uses authoritative Character rows and does not depend on the Redis count.

A critical gameplay rule is that disconnecting does NOT stop grinding. Therefore socket connectivity must never determine whether a character counts on a map.

## Goals

- Count every character that is authoritatively grinding on the map, whether connected or disconnected.
- Remove stale/historical Redis members without allowing them to inflate the visible count.
- Recover after API process crashes without permanently corrupting population.
- Keep deferred Town return absent from presence.
- Preserve the existing `map:presence` event and Redis hash shape.

## Non-Goals

- Do not change encounter-search timing.
- Do not introduce frontend polling.
- Do not treat Socket.IO connection state as gameplay state.
- Do not add a database presence table.
- Do not change the Grind map header layout.

## Decisions

### 1. Redis fields carry refresh timestamps

`addPlayerToMap(characterId, mapId)` stores the current epoch-millisecond timestamp. The configured stale-presence TTL is 30 seconds.

### 2. Authoritative server reconciliation, independent of sockets

A server-side interval (target: 10 seconds) queries authoritative Character rows whose state qualifies as active map grinding:

- `status === 'grinding'`
- `currentMapId` is set
- `returnToTownAfterBattle !== true`

Every qualifying character refreshes its Redis map membership. This query is deliberately not limited to connected sockets, so a disconnected grinder remains counted.

The reconciliation publishes the corrected count for affected maps. A stale Redis member is removed by the normal count/prune path before publication. Battle queue generation also refreshes and publishes the affected map after each newly scheduled battle, so the realtime population is refreshed at least once per battle cycle rather than only on map entry/exit.

### 3. Disconnect is not map-exit

`handleDisconnect()` MUST NOT remove a character from `map:players:*` solely because the socket disconnected. It may remove online/session presence, socket rooms/subscribers, and connection bookkeeping.

Map presence is removed only by an authoritative gameplay transition out of grinding (Town, death, explicit leave, etc.).

### 4. Prune stale entries before counting

Before `getPlayersOnMap` returns a count, fields older than the 30-second TTL are removed. The prune compares the timestamp observed during the read with the current field value before deleting, so a concurrent refresh wins.

### 5. Explicit cleanup remains authoritative

When a server path changes a character out of active grinding, it captures the previous map ID before clearing it, saves the authoritative state, removes the Redis member, and publishes the corrected count.

This includes the existing leave/deferred-leave, death and battle-resolution Town paths, plus the queue-generation food-exhaustion/no-active-battle path.

### 6. Deferred Town return

Requesting Town during an active battle sets `returnToTownAfterBattle=true` and removes map presence immediately. Reconciliation excludes that character until the battle resolver completes the Town transition.

### 7. Publish the post-prune count

`publishMapPresence(mapId)` obtains the count only after stale pruning, so direct socket responses and Redis-published `map:presence` events share the same corrected count.

## Failure / Recovery Behavior

- A disconnected grinder remains in the authoritative DB state and is refreshed by reconciliation.
- If Redis loses a member, the next reconciliation re-adds it.
- If the API crashes, old Redis members become stale and are excluded/pruned on the next count; active grinders are restored by reconciliation.
- If a character leaves grind, explicit cleanup removes its Redis member; later reconciliation does not re-add it.
- Duplicate cleanup remains harmless.

## Verification Strategy

1. Redis/hash test: active members count, stale members are pruned, refreshed members survive, and published count is post-prune.
2. Disconnect regression: disconnecting a character while its authoritative state remains grinding leaves map presence intact.
3. Reconciliation regression: disconnected/connected grinding characters are refreshed; Town/deferred-return characters are not.
4. Battle regression: queue-generation food-exhaustion/no-active-battle Town transition removes presence.
5. Existing map cleanup and encounter-search tests remain green.
6. Run shared/API/frontend builds, strict OpenSpec validation and `git diff --check`.
