# Proposal

## Why

STATUS.md §5–§9 confirms that the grind/battle loop is implemented and verified at 163/163 assertions, but WebSocket delivery remains the explicit next gap: the existing Socket.IO gateway is only a skeleton, is not enabled by its module, and no battle event is emitted by the resolver.

The frontend does not exist yet. We therefore need a stable server-side realtime contract before UI work begins: the socket must authenticate like REST, expose the character-private room, accept map entry/leave intents, and publish authoritative battle/progression facts without becoming part of the resolution decision path.

## What Changes

- Enable and wire the /game Socket.IO gateway.
- Authenticate the handshake with the existing JWT sessionId check from SPEC §15.2.
- Associate the authenticated connection with its character and join char:<characterId>.
- Implement map:enter and map:leave through MapService, not by duplicating map/battle state transitions in the gateway.
- Emit battle:queueUpdated, battle:resolved, character:leveledUp, and character:died from authoritative BattleService resolution/top-up paths.
- Event publication failure must never prevent battle resolution, XP/gold/drop application, death handling, or queue rebuilding.
- Add committed verification for handshake auth, map socket delegation, event payloads, and the non-blocking emission invariant.
- Create root FRONTEND_SPEC.md describing real payloads, UI reactions, REST resync rules, reconnect behavior, and server authority.

## Non-Goals

- No Angular/frontend implementation.
- No Chat/Mail/Market/Town loop integration.
- No new gameplay rules or battle-engine changes.
- No client-side simulation, outcome prediction, or timing authority.
- No replacement of existing REST endpoints.

## Capabilities

### New Capabilities

- battle-loop-websocket-gateway: authenticated /game transport, map socket intents, authoritative battle/progression synchronization events, and frontend resynchronization contract.

### Modified Capabilities

None.

## Impact

Production:
- apps/api/src/modules/gateway/*
- apps/api/src/modules/battle/*
- apps/api/src/modules/map/*
- apps/api/src/app.module.ts

Documentation:
- FRONTEND_SPEC.md

Verification:
- Add a focused gateway/battle WebSocket verification script using the existing Node-script testing style.

No database migration or new gameplay dependency is expected.
