# Proposal

## Change

Unify Town so there is exactly one logical Town and exactly one visible Town node in the Grind Board.

## Why

The completed `town-as-map-and-generic-transition` change made `map_town` the canonical physical Town location, but the frontend retained the legacy dedicated Town node while also rendering the new `map_town` catalog entry through the generic map loop.

This currently produces two Towns in the Board:

1. The legacy dedicated Town node, which correctly calls `POST /maps/leave` and preserves immediate/deferred return-to-Town behavior.
2. The canonical `map_town` catalog entry, which incorrectly reaches the normal `POST /maps/:mapId/enter` path and is rejected because Town is not a grind map.

The intended architecture is one Town only. The visual Town node must be the UI representation of the canonical `map_town` location, not a second location.

## What changes

- Preserve `TOWN_MAP_ID = "map_town"` as the only Town identity.
- Preserve exactly one Town entry in the canonical map catalog.
- Keep exactly one visible Town node on the Grind Board.
- Exclude Town entries (`isTown: true`) from the generic grind-map renderer.
- Make the remaining Town node explicitly represent `map_town`.
- Route Town clicks through the existing authoritative `POST /maps/leave` semantics, never through `POST /maps/:mapId/enter`.
- Preserve immediate return when no battle is active.
- Preserve deferred return while an active battle finishes.
- Preserve `pendingMapTransition`, MapPresenceService, Redis reconciliation and Socket.IO room synchronization.
- Keep Town as a real presence map, including `map:map_town` and `map:presence`.
- Make Town-only NPC access rely on canonical Town location, not on `status === "town"` alone.
- Remove dead legacy `TownCenter` frontend code only after exact repository-wide reference verification.
- Do not add a second Town route, component, ID, endpoint or movement system.
- Preserve all established visual/layout/scaling behavior.

## Capabilities

### Modified

- **map-location:** one canonical Town identity and one Board representation.
- **town-transition:** Town requests use the existing authoritative leave/deferred-transition path.
- **town-access:** Town NPC access is tied to canonical physical Town location.

## Impact

Expected implementation areas:

- `apps/frontend/src/app/features/play/map-board.html`
- `apps/frontend/src/app/features/play/map-board.css`
- `apps/frontend/src/app/features/play/components.ts`
- `apps/frontend/src/app/features/play/town-center.*` (only if confirmed dead)
- `apps/frontend/src/app/features/play/grind.component.*` if required by rendering cleanup
- `apps/api/src/modules/map/map.service.ts`
- `apps/api/src/modules/town/town.service.ts`
- relevant shared map/catalog data
- committed verification/regression scripts
- `SPEC.md`
- `openspec/specs/SPEC.md`
- `ARCHITECTURE.md`
- `PLAY_WINDOW_SPEC.md`
- `STATUS.md`

No new database migration is expected. No production deployment.
