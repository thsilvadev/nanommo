# Proposal

## Why

NanoMMO's current location model overloads `currentMapId = null` to mean "Town". This makes location an exception instead of a value, forces frontend/backend fallbacks, and prevents Town from participating naturally in the same map-presence and movement model as every other map.

The current deferred Town-return mechanism also exposes a battle-specific flag (`returnToTownAfterBattle`) to answer the generic question "does this character currently belong to a gameplay map?". That is functionally correct today, but it couples map membership to battle semantics and will become a trap when real character movement is introduced.

## What Changes

- Make Town a canonical map with a stable `map_town` identifier.
- Make `Character.currentMapId` non-nullable and authoritative for physical gameplay location; Town is represented by `map_town`.
- Replace `returnToTownAfterBattle` as the generic deferred-transition state with a generic `pendingMapTransition` value containing at least destination and reason.
- Keep the battle-specific meaning ("finish the active battle before completing the Town request") in Battle/Map transition logic, not in MapPresenceService.
- Define map presence from location + absence of a pending map transition, independent of `status`. Town residents therefore count in Town.
- Keep encounter-search population distinct: only grinding characters on a grindable map contribute to the search delay.
- Keep the existing absolute `map:presence` client payload.
- Make authoritative map transitions also update Socket.IO map-room membership so REST/battle-driven movement is realtime, including Town.
- Keep Redis as runtime cache/pub-sub; PostgreSQL/Character state remains authoritative.
- Preserve the existing deferred Town gameplay behavior and frontend layout/visual language.

## Capabilities

### Modified Capabilities

- map-location: Town becomes a first-class map and `currentMapId` becomes the canonical location field.
- map-presence: gameplay presence is based on generic map membership/transition state rather than battle-specific flags.
- battle-return: deferred Town return keeps its existing gameplay timing while using the generic transition model.

## Impact

Primary areas:

- `apps/api/src/database/entities/character.entity.ts`
- new migration under `apps/api/src/database/migrations/`
- `apps/api/src/modules/map/*`
- `apps/api/src/modules/presence/*`
- `apps/api/src/modules/battle/*`
- `apps/api/src/modules/gateway/nanommo.gateway.ts`
- `apps/api/src/modules/character/character.service.ts`
- `apps/api/test/map-presence*.test.js`
- `apps/api/test/encounter-search.test.js`
- `packages/shared/*`
- `monsters.json` and frontend mirror data
- relevant frontend Character/map-board/play-shell code
- `SPEC.md`, `openspec/specs/SPEC.md`, `ARCHITECTURE.md`, `STATUS.md`

A database migration is required because existing rows use NULL for Town and the battle-specific boolean must be retired. No new database table is required.
