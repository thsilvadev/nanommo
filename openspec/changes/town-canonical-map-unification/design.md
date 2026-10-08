# Design

## 1. Architectural invariant

There is exactly one logical Town:

`TOWN_MAP_ID === "map_town"`

The same identity must be used by:

- Character.currentMapId
- the canonical map catalog
- the single Board Town node
- Town map presence
- Socket.IO room `map:map_town`
- Town NPC location
- Town return destination

`status = "town"` remains an activity/state value. It is not an alternative physical location.

There must not be:

`map_town + legacy non-map Town`

## 2. Canonical map catalog

The canonical catalog continues to expose exactly one Town entry with the existing shape and `isTown: true`.

Town remains:

- a valid physical map/location;
- included in `GET /maps`;
- visible on the Grind Board;
- present in map presence;
- non-grindable;
- absent from encounter pools;
- excluded from recommended/grindable map lists.

Do not add another Town object or another Town ID.

## 3. Board rendering model

The Grind Board currently has two paths that can create a Town node:

- the dedicated legacy Town node;
- the generic `*ngFor` over `maps`.

The final implementation MUST have only the first semantic node:

`Town node -> map_town`

The generic renderer MUST exclude every map where `isTown === true`. An explicit `map.id === TOWN_MAP_ID` exclusion may be used as an additional defensive assertion, but `isTown` is the canonical category marker.

Conceptually:

`grindMaps = maps.filter(map => !map.isTown)`

The Town node may retain its current DOM/CSS implementation and position because its appearance is already established. What changes is its semantic backing: it is now explicitly the representation of `map_town`.

Do not visually redesign the Board.

## 4. Town node interaction

There are two different backend semantics:

### Grind map

A normal grind map uses:

`POST /maps/:mapId/enter`

This starts/continues grinding and must only accept grindable maps.

### Town

Town uses:

`POST /maps/leave`

This remains the authoritative return-to-Town operation.

The frontend must branch using the map definition/category before making the request. Never send `map_town` through the grind-entry path and wait for the backend to reject it.

Preferred conceptual API:

`requestMap(map)`

- if `map.isTown`: invoke Town return flow;
- otherwise: invoke grind entry.

The exact method names are implementation details.

## 5. Already in Town

If:

`character.currentMapId === TOWN_MAP_ID`

clicking the Town node is a gameplay no-op.

It must not:

- start a battle;
- create a queue;
- invoke grind entry;
- create a pending transition;
- reset a grind map encounter sequence;
- force a Town leave/re-entry cycle.

The UI may keep selection/highlight state unchanged.

For defense-in-depth, `POST /maps/leave` should be idempotent when the authoritative character is already in `map_town`. It must not run grind-map cleanup logic against Town.

## 6. Immediate Grind -> Town transition

When a character is on a grind map and no battle is actively running, the existing leave flow remains authoritative.

Final persisted state:

`currentMapId = map_town`
`status = town`
`pendingMapTransition = null`

Persistence occurs before MapPresenceService synchronization.

Presence changes:

- remove the character from the previous grind map;
- add the character to `map_town`;
- publish absolute `map:presence` snapshots for affected maps.

Encounter-sequence rollover applies only to the actual previous grind map.

## 7. Deferred Grind -> Town transition

When a battle is active, preserve the existing behavior:

Initial request state:

`currentMapId = previousGrindMap`
`pendingMapTransition = { destinationMapId: "map_town", reason: "town_request" }`

The request:

1. persists the pending transition;
2. removes old-map gameplay presence immediately;
3. cancels future queued battles;
4. allows the current battle to finish;
5. finalizes Town;
6. persists `currentMapId = map_town`, `status = town`, `pendingMapTransition = null`;
7. synchronizes presence into Town;
8. moves an already-connected socket into `map:map_town`.

Do not replace this with frontend timers or polling as the source of truth.

## 8. Town presence

Generic map presence remains:

`currentMapId IS SET AND pendingMapTransition IS NULL`

Therefore a settled Town resident counts on `map_town`.

Town population must use the same absolute public payload:

`map:presence { mapId, playersOnMap }`

Town population must not be included in encounter-search population. Encounter timing continues to count only active grinders.

## 9. Socket rooms

A connected Town character belongs to:

`map:map_town`

On an authoritative transition from a grind map to Town, the gateway must move the socket from the old map room to Town through the existing internal membership-transition flow.

Do not add frontend room management.

Do not make Socket.IO connection state authoritative gameplay location.

## 10. Town NPC eligibility

Town-only functionality must not rely on `status === "town"` as the sole physical-location proof.

Use the canonical location boundary:

`currentMapId === TOWN_MAP_ID`
and
`pendingMapTransition === null`

Existing `status === "town"` checks may remain as consistency guards where appropriate, but they must not create a second location model.

This ensures a stale or inconsistent status cannot grant Town NPC access to a character still physically on a grind map.

No new NPC system is introduced.

## 11. Legacy TownCenter cleanup

The repository currently contains `TownCenter` and `town-center.html/css`, but exact reference search must be performed before deletion.

If there are no production imports, route entries, template references or other valid uses, remove the dead component/files.

Do not replace them with:

- a new Town page;
- a `/play/town` route;
- another Town component.

The existing map-first Play shell remains the UI for Town.

## 12. Data and defensive assertions

Verify that all map catalog copies contain exactly one `map_town`.

Where a frontend mirror exists, it must agree with the backend catalog on:

- ID;
- name;
- Town marker;
- unlock level;
- non-grind semantics.

The frontend should fail safely if the catalog ever contains multiple Town entries rather than rendering duplicates.

A duplicate Town entry is a data-integrity error, not a reason to render two Towns.

## 13. API contract

Keep:

- `GET /maps` -> Town + grind maps;
- `POST /maps/:mapId/enter` -> grindable maps only;
- `POST /maps/leave` -> request/execute return to canonical Town.

Town MUST remain rejected by the grind-entry endpoint.

No new endpoint is necessary.

No client-facing endpoint should be added just to represent Town.

## 14. Idempotency and stale-client behavior

The implementation must be safe under duplicate clicks and stale frontend state.

Cases:

### Already in Town

Town click is a no-op.

### Repeated Town clicks during active battle

There remains one authoritative pending transition. A second request must not create another independent Town transition.

### Stale client sends grind entry for map_town

The backend rejects it. Frontend production code must not intentionally generate this request.

### NPC request during pending Town transition

Reject until Town is finalized.

### Socket disconnected

Gameplay state does not change because of socket connectivity. Reconnect places the socket in the canonical room.

### Redis cache missing member

Existing reconciliation repairs the membership.

## 15. Forbidden implementations

Never:

- keep both current Town nodes;
- render `map_town` in the generic grind-map loop;
- create another Town ID;
- interpret null/undefined as Town;
- send `map_town` to `/maps/:mapId/enter`;
- modify backend to make Town grindable;
- create `/play/town`;
- revive `TownCenter` as a second Town screen;
- use `status` as the generic physical-location authority;
- add frontend polling as a substitute for authoritative transitions or socket events;
- alter the established Board visual composition;
- introduce a movement/pathfinding subsystem.

## 16. Documentation obligations

Update the authoritative documents only after code semantics are settled:

### Root / OpenSpec SPEC

State explicitly:

- one Town identity;
- one `map_town` entry;
- Town is non-grindable;
- Town has one Board node;
- Town uses leave/transition semantics, not grind entry.

### ARCHITECTURE.md

Document:

`one Town identity -> one catalog entry -> one Board node -> one Town-return path`

and the ownership boundary between MapService, BattleService, MapPresenceService, Gateway and TownService.

### PLAY_WINDOW_SPEC.md

State that the single visible Town node is the visual representation of `map_town`.

Preserve current visual rules.

### STATUS.md

Record the root cause, the exact duplication, the architectural invariant and verification results.

## 17. No migration

This change is UI/semantics cleanup around the already-established canonical Town model.

No database schema migration is expected unless implementation inspection proves the current database contract differs from the already-applied `town-as-map-and-generic-transition` model. Do not invent a migration just for this change.
