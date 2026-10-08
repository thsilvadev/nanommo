# Proposal

## Why

The previous map-presence cleanup fixed several explicit map-exit paths, but the Redis population cache can still become stale. More importantly, Socket.IO connection state is not gameplay presence: a character that disconnects while grinding continues grinding and MUST continue counting in `playersInMap`.

The current Redis hash is therefore a cache of authoritative gameplay state, not an online-player set. It can retain stale members after crashes, missed cleanup, or historical bugs, while the current `handleDisconnect()` incorrectly removes a grinding character merely because its socket closed.

There is also an uncovered server-authoritative Town transition in `BattleService.queueBattles`: when projected food is exhausted and there is no active battle, the character is moved to Town and `currentMapId` is cleared without removing map presence.

## What Changes

- Keep Redis `map:players:{mapId}` as the realtime presence cache, with timestamped members and bounded stale-entry pruning.
- Make authoritative gameplay state the source of presence eligibility: a character counts while `status=grinding`, `currentMapId` is set, and it has not requested deferred Town return.
- Refresh presence from a server-side reconciliation that queries authoritative grinding characters, not from connected sockets. Disconnected grinders therefore remain present.
- NEVER remove map presence merely because a Socket.IO connection disconnects. Disconnect cleanup only removes connection/session state; gameplay presence remains until the authoritative character leaves grind.
- Prune stale Redis members before counting/publishing.
- Cover the remaining `BattleService.queueBattles` Town transition with explicit cleanup.
- Keep explicit cleanup on authoritative Town/death/leave transitions; cleanup remains idempotent.
- Add regression tests proving disconnected grinders remain counted, stale members are pruned, and the queue-generation Town path cleans presence.
- Do not change the frontend `playersInMap` contract or add polling.

## Capabilities

### Modified Capabilities

- `map-presence`: Presence becomes an authoritative, self-healing gameplay-state cache rather than a socket-connected-player count.

## Impact

Likely implementation areas:

- `apps/api/src/modules/gateway/gateway.service.ts`
- `apps/api/src/modules/gateway/nanommo.gateway.ts`
- `apps/api/src/modules/battle/battle.service.ts`
- `apps/api/test/map-presence.test.js`
- `apps/api/test/map-presence-cleanup.test.js`
- OpenSpec/root documentation describing the map-presence contract

No database migration is expected. Redis presence remains ephemeral runtime state.
