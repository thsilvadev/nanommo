# Tasks

Reference: specs/battle-loop-websocket-gateway/spec.md.

## 1. Gateway wiring and authentication

- [x] 1.1 Enable GatewayModule and required imports/providers.
- [x] 1.2 Enable Socket.IO namespace /game and configured frontend CORS.
- [x] 1.3 Preserve JWT handshake authentication and activeSessionId validation.
- [x] 1.4 On connection, associate the character and join char:<characterId>.
- [x] 1.5 Do not let disconnect affect gameplay state.

## 2. Socket map intents

- [x] 2.1 Implement map:enter { mapId } by delegating to MapService.enterMap().
- [x] 2.2 After success, update map room/presence and emit the authoritative queue.
- [x] 2.3 Implement map:leave {} by delegating to MapService.leaveMap().
- [x] 2.4 On leave, remove the map room/presence and cancel pending work according to the existing map-leave contract.
- [x] 2.5 Ensure socket map behavior matches REST semantics.

## 3. Battle event publication

- [x] 3.1 Emit battle:queueUpdated after map entry and live queue rebuild/top-up.
- [x] 3.2 Emit battle:resolved after successful authoritative resolution.
- [x] 3.3 Emit character:leveledUp only when a resolve gains one or more levels.
- [x] 3.4 Emit character:died after death state and lastDeathLog are persisted.
- [x] 3.5 Ensure death produces no replacement queue.
- [x] 3.6 Ensure duplicate resolution emits no duplicate authoritative event set.

## 4. Authority boundary

- [x] 4.1 Catch/log publication failures without changing resolution behavior.
- [x] 4.2 Verify Socket.IO/Redis availability is not required for BullMQ resolution.
- [x] 4.3 Verify reconnect/disconnect does not pause, cancel, or alter queued battles.
- [x] 4.4 Document that the client never decides outcome, timing, queue contents, or resolution order.
