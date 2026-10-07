# Proposal

## Why

Map presence counts shown in the UI (`playersInMap()`) include characters that are already back in town. The Redis hash used to broadcast `map:presence` is only cleaned up on the WebSocket `map:leave` event and on disconnect while `currentMapId` is still set. When a character leaves via the HTTP `/maps/leave` endpoint, dies, or returns to town after a deferred battle resolution, their Redis presence entry is never removed. The result is an inflated player count that does not reflect actual grinders on the map.

## What Changes

- Ensure every server path that moves a character off a map also removes that character from the Redis map-presence hash and publishes the updated count.
- Specifically cover:
  - `MapService.leaveMap` (HTTP leave, immediate and deferred)
  - `BattleService.handleCharacterDeath` (death → town)
  - `BattleService.resolveBattle` when the character returns to town (`returnToTownAfterBattle` or hunger after battle)
- Make the cleanup idempotent so it is safe to call even if the character was already removed by another path.

## Capabilities

### Modified Capabilities
- `map-presence`: Add requirements that presence cleanup happens on all map-exit paths, not only WebSocket leave and disconnect.

## Impact

- `apps/api/src/modules/map/map.service.ts` — inject `GatewayService` and call presence cleanup in `leaveMap`
- `apps/api/src/modules/battle/battle.service.ts` — call presence cleanup in `handleCharacterDeath` and `resolveBattle` when the character leaves the map
- `apps/api/src/modules/gateway/gateway.service.ts` — no new APIs required; reuse existing `removePlayerFromMap` and `publishMapPresence`
- Frontend `playersInMap()` in `apps/frontend/src/app/features/play/components.ts` does not need changes; once the server stops broadcasting stale counts, the UI will reflect the correct number
