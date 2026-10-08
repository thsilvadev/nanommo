# Proposal

## Why
The previous map-presence work correctly separated socket connectivity from gameplay presence and added Redis reconciliation, but it still treated battle scheduling/start as a convenient refresh trigger. That couples a simple map-membership concern to the battle engine.

NanoMMO is about to gain character movement. Map presence should therefore be modeled around the actual gameplay transition: entering, leaving, or moving between maps. The same abstraction must also cover death, hunger/Town routing, and the special deferred Town request.

## What Changes
- Introduce a dedicated PresenceModule with MapPresenceService for gameplay map membership and OnlinePresenceService for online/socket presence.
- Make MapPresenceService.syncCharacter(characterId, previousMapId) the reusable synchronization boundary after authoritative Character map-state changes.
- Publish the existing absolute map:presence payload when map population actually changes.
- Keep Redis map hashes as a fast, self-healing runtime cache and Redis pub/sub as the cross-process transport bridge.
- Keep the existing 10-second reconciliation only as a recovery/safety mechanism.
- Remove the battle-start refresh-map-presence BullMQ job; battle lifecycle is no longer the normal map-presence trigger.
- Preserve the existing map:presence frontend contract and room model.
- Keep the future heartbeat modularized in OnlinePresenceService without implementing friend lists or heartbeat behavior now.
- Make encounter-search timing consume the same active-grinder definition used by map presence.

## Capabilities
### Modified Capabilities
- map-presence: gameplay map presence becomes event-driven from authoritative membership transitions and is centralized for future movement.
- online-presence: online/socket state is separated into a reusable service for the future heartbeat.

## Impact
Implementation areas:
- apps/api/src/modules/presence/*
- apps/api/src/modules/map/map.service.ts
- apps/api/src/modules/battle/battle.service.ts
- apps/api/src/modules/gateway/nanommo.gateway.ts
- apps/api/src/modules/gateway/gateway.service.ts
- apps/api/src/modules/battle/battle-queue.processor.ts
- apps/api/test/map-presence.test.js
- apps/api/test/map-presence-cleanup.test.js
- SPEC.md
- ARCHITECTURE.md
- STATUS.md

No database migration is expected. Redis map presence remains ephemeral runtime state.