# Design

## Context

The server tracks how many characters are grinding on each map using a Redis hash (`map:players:{mapId}`) and broadcasts updates via the `map:presence` Socket.IO event. This count feeds both the UI header (`playersInMap()`) and encounter search timing.

Currently, Redis cleanup only happens in two places:
1. `NanommoGateway.handleMapLeave` (WebSocket `map:leave` event)
2. `NanommoGateway.handleDisconnect` (only when `character.currentMapId` is still populated)

When a character leaves via the HTTP `/maps/leave` endpoint, dies, or returns to town after a deferred battle resolution, the Redis hash is not updated. The character remains in `map:players:{mapId}` until they manually disconnect while `currentMapId` is still set.

## Goals / Non-Goals

**Goals:**
- Ensure `map:players:{mapId}` accurately reflects characters currently grinding on that map
- Cover all server-side paths that move a character off a map
- Keep cleanup idempotent so duplicate calls are harmless

**Non-Goals:**
- Change the Redis data structure or presence protocol
- Alter the frontend `playersInMap()` logic
- Add new gateway events or REST endpoints

## Decisions

### Decision: Add presence cleanup to `MapService.leaveMap`
Inject `GatewayService` into `MapService` and call `removePlayerFromMap` + `publishMapPresence` at the end of `leaveMap`, using the `oldMapId` captured before any state changes.

**Rationale:** The HTTP `/maps/leave` endpoint is the primary path players use to return to town. The gateway's `handleMapLeave` already performs this cleanup for the WebSocket path, but the HTTP controller bypasses the gateway entirely. Centralizing cleanup in `mapService.leaveMap` ensures both paths behave identically.

**Alternatives considered:**
- Move cleanup into the HTTP controller (`MapController.leaveMap`): Rejected because `MapService` is the authoritative place for leave logic and the gateway path also calls it.
- Emit a socket event from the frontend after HTTP leave: Rejected because the server must remain authoritative; the client cannot be trusted to clean up server state.

### Decision: Add presence cleanup to `BattleService` death and town-return paths
In `handleCharacterDeath` and `resolveBattle` (when the character leaves the map), call `gatewayService.removePlayerFromMap` and `gatewayService.publishMapPresence` using the battle's `mapId`.

**Rationale:** Death and deferred town returns modify `Character.currentMapId` to `null` and `status` to `'town'` without touching Redis. These are server-authoritative state transitions and must include presence cleanup.

**Alternatives considered:**
- Rely on `handleDisconnect` to eventually clean up: Rejected because `handleDisconnect` checks `character.currentMapId`, which is already `null` after these transitions, so it skips cleanup entirely.
- Add a periodic Redis reconciliation job: Rejected because it masks the bug rather than fixing it and introduces eventual-consistency windows.

### Decision: Use existing `GatewayService` methods
Reuse `removePlayerFromMap` and `publishMapPresence` directly rather than adding a new combined helper.

**Rationale:** Both methods are already idempotent (`HDEL` is a no-op for missing fields; `hlen` is read-only). Adding a wrapper would duplicate logic without benefit. The gateway's `handleMapLeave` already calls them sequentially, so this pattern is proven.

## Risks / Trade-offs

[Duplicate publish on WebSocket leave] → Mitigation: After adding cleanup to `MapService.leaveMap`, `NanommoGateway.handleMapLeave` will call `removePlayerFromMap` and `publishMapPresence` a second time. `HDEL` is idempotent and `publishMapPresence` publishes the same count twice, which is harmless. If desired, `handleMapLeave` can be simplified later to rely on `MapService.leaveMap` exclusively.

[Redis unavailability] → Mitigation: `GatewayService` methods are async Redis operations. If Redis is down, the character still leaves the map correctly; only the presence count becomes temporarily stale until Redis recovers. This matches the existing tolerance for Redis pub/sub failures.

## Migration Plan

1. Inject `GatewayService` into `MapService`
2. Add presence cleanup to `MapService.leaveMap`
3. Add presence cleanup to `BattleService.handleCharacterDeath`
4. Add presence cleanup to `BattleService.resolveBattle` when character leaves the map
5. No database migration required; Redis hashes are ephemeral

## Open Questions

None.
