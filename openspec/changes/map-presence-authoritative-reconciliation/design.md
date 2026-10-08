# Design

## Context
NanoMMO needs a realtime playersOnMap counter, but three different concepts were previously too easy to conflate:

- gameplay map membership: whether the authoritative Character state says the character is actively grinding on a map;
- online/socket presence: whether a user currently has a live Socket.IO connection;
- transport: how a changed gameplay state is delivered to connected clients.

The authoritative gameplay state is PostgreSQL. Redis remains useful as a fast, ephemeral runtime cache and pub/sub bridge, but it is not the source of truth. Socket.IO distributes absolute map-population snapshots to clients.

## Goals
- Make map membership changes the direct realtime trigger for map:presence.
- Centralize map-presence synchronization so future movement code has one reusable integration point.
- Keep the event payload absolute ({ mapId, playersOnMap }), not delta-based.
- Keep Redis as a self-healing runtime cache without making it the gameplay authority.
- Keep disconnected grinders in gameplay map presence.
- Keep the 10s reconciliation as a safety net for missed writes/process crashes, not as the normal realtime trigger.
- Separate online presence from gameplay map presence so the existing/future heartbeat can be reused later for friend and online-player lists.
- Keep returnToTownAfterBattle scoped to deferred battle-return semantics; it is only one input into the active-map-presence predicate.
- Make encounter-search timing use the exact same active-grinder definition as playersOnMap.

## Non-Goals
- Do not implement the future friend/online-player list.
- Do not implement a heartbeat loop in this change.
- Do not change battle timing or encounter-search rules.
- Do not introduce frontend polling.
- Do not make Socket.IO connection state authoritative gameplay state.
- Do not introduce a database presence table.
- Do not change the map:presence payload contract.

## Architecture

### Authoritative active map predicate
A character counts on a map when status=grinding, currentMapId is non-null, and returnToTownAfterBattle is not true.
This predicate is centralized in MapPresenceService.getActiveMapId().
returnToTownAfterBattle is not a generic movement state. It remains necessary for the special case where a player requests Town during an active battle: the flag prevents the battle loop from scheduling/continuing normal grind while the current battle finishes, and map presence is removed immediately.

### Centralized synchronization
MapPresenceService.syncCharacter(characterId, previousMapId) is the integration point for authoritative Character map-state changes.
The caller changes and saves the Character first, then calls the service with the map occupied before the mutation.

Examples:
- Town/map -> map: remove old membership, publish old map count.
- map A -> map B: remove A, publish A; add B, publish B.
- death -> Town: remove old map, publish decremented count.
- food exhaustion -> Town: remove old map, publish decremented count.
- deferred Town request during battle: the flag makes the active-map predicate false, so presence is removed immediately even though currentMapId stays populated until battle resolution.
- future movement: capture old currentMapId, persist the new map, then call this service once.

This makes map membership a state-transition concern rather than a battle-lifecycle concern.

### Redis cache
Redis stores map:players:{mapId} as characterId -> lastRefreshTimestamp.
It is intentionally ephemeral. The timestamp allows stale members to be pruned. PostgreSQL remains authoritative.
getPlayersOnMap() prunes entries older than 30 seconds and then returns the Redis count. Concurrent refresh protection rechecks the observed timestamp before deleting a stale field.

### Realtime publication
On an actual map-membership count change, MapPresenceService publishes gateway:map:presence with the absolute payload { mapId, playersOnMap }.
NanommoGateway consumes the Redis pub/sub channel and emits map:presence to the corresponding Socket.IO room map:{mapId}.
The frontend simply replaces its current playersOnMap value with the received absolute snapshot. It does not calculate +1/-1, inspect Redis, or count players itself.
Absolute snapshots are deliberate: missed/interleaved events do not accumulate client-side arithmetic drift.

### Reconciliation
Every 10 seconds, MapPresenceService queries authoritative active grinders from PostgreSQL and refreshes their Redis entries. It publishes only when the resulting count differs from the previous cache count.
Reconciliation is a repair mechanism for Redis member loss, API/process restarts, missed cleanup, stale/historical cache entries, and disconnected grinders that continue grinding.
It is not the source of normal realtime updates.

### Online presence and future heartbeat
OnlinePresenceService owns players:online, presence:{characterId}, online/offline operations, and a reusable touch() hook for the future heartbeat.
It deliberately does not determine whether a character is on a gameplay map.
A future friend/online-player system can reuse this service without coupling it to map movement or battle state.

## Module boundaries
- PresenceModule owns MapPresenceService and OnlinePresenceService.
- MapService owns map gameplay transitions and calls MapPresenceService after persistence.
- BattleService owns battle/death/hunger/Town rules and calls MapPresenceService only when those rules actually change map membership.
- NanommoGateway owns authentication, Socket.IO rooms and delivery.
- GatewayService owns generic Redis-backed server event publication for battle/chat/market/etc.; it does not own gameplay map presence or online presence.

## Why battle start is not a presence trigger
A battle is not a map-membership transition. A character can begin, end, or move between battles while remaining on the same map.
The previous refresh-map-presence BullMQ job existed only because the implementation lacked a direct event at startAt. That was a workaround for the realtime symptom, not a good ownership boundary. The job is removed. Map population now changes because membership changes.

## Failure / Recovery behavior
- Disconnecting a socket does not remove map presence.
- Leaving a map removes presence immediately (or, for deferred Town return, as soon as the return request makes the character ineligible).
- Death removes the previous map membership.
- If Redis loses a member, reconciliation restores it from PostgreSQL.
- If Redis contains a stale member, count/publish pruning excludes it.
- If an event is missed by a client, the next absolute snapshot corrects the client state; join/reconnect also receives a fresh snapshot.