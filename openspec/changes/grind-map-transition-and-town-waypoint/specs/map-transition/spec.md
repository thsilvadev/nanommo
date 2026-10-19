# Map Transition

## ADDED Requirements

### Requirement: A started unresolved battle defers movement to the latest requested destination

The server SHALL persist a map-transition intent without changing `currentMapId` while any battle queue entry for the character is unresolved and has `startAt <= now`. This includes entries whose `endAt` has passed but whose resolution has not committed. The transition SHALL preserve the currently started battle, discard future entries simulated for the origin map, and record the requested Town/Grind destination and request time. A later request SHALL replace the pending destination; a request with an older request time SHALL NOT overwrite a newer pending intent. After authoritative battle resolution, the server SHALL commit the latest valid destination before generating a replacement queue. Death and exhausted food SHALL retain the existing Town fallback.

#### Scenario: Change Grind maps during battle

- **GIVEN** a character is grinding on map A and has a started unresolved battle
- **WHEN** the character requests map B
- **THEN** `currentMapId` remains A, `pendingMapTransition.destinationMapId` becomes B, and future precomputed battles for A are removed
- **AND** the active battle remains immutable
- **WHEN** the battle transaction commits
- **THEN** the character arrives on B and a new queue is built for B

#### Scenario: An overdue unresolved battle still blocks immediate movement

- **GIVEN** a queue entry has `startAt <= now < endAt` OR `startAt <= now` with `endAt <= now`, while `resolved = false`
- **WHEN** another map is requested
- **THEN** the request is deferred until the unresolved row is committed as resolved

#### Scenario: Last click wins

- **GIVEN** a pending request for map B with a later `requestedAt` than a second request for map C
- **WHEN** the delayed C request is processed after B
- **THEN** the server keeps B as the destination and returns the currently accepted intent

### Requirement: Encounter sequence and queue generation are concurrency-safe

The server SHALL serialize queue generation, the transactional authoritative battle claim/resolution and map-transition requests using one distributed per-character encounter-chain lock. `MapKillCounter` creation SHALL be idempotent under concurrent first access while retaining the unique `(characterId, mapId)` constraint. Every actual departure from a Grind map SHALL increment its encounter `epoch` and reset map/per-monster kill counts, for both immediate/deferred and Grind/Town destinations.

#### Scenario: Concurrent first use of a map kill counter

- **GIVEN** queue generation and battle resolution both request a missing counter for the same character/map
- **WHEN** both attempt creation concurrently
- **THEN** exactly one counter row is created and both operations read the same row without a unique-constraint exception

#### Scenario: Leave and later return to a Grind map

- **GIVEN** a character leaves Grind map A for another map
- **WHEN** the movement commits
- **THEN** A's epoch increments and its kill counters reset, so a later return starts a fresh deterministic encounter sequence

### Requirement: Pending map intent is visible and destination preview is animated

The Character DTO SHALL expose `pendingMapTransition`. After a successful map request, the frontend SHALL show the requested destination marker `/project/destination_pinpoint.png` and an animated dashed shortest route across cardinally adjacent canonical map nodes. While a transition is pending, the map UI SHALL show the exact text `waiting for battle to end to move...`. The visual route SHALL NOT itself mutate authoritative location or queue state.

#### Scenario: Successful deferred map request

- **GIVEN** a character remains on map A while a request for B is pending
- **WHEN** the request succeeds
- **THEN** the destination marker appears on B, a moving dashed route from A to B is rendered, and the waiting text is visible
- **WHEN** the server commits the transition
- **THEN** the waiting text disappears and current location/queue refresh from authoritative Character state

### Requirement: A character may save one settled Town waypoint

The server SHALL persist a nullable `savedTownMapId`. `POST /maps/save-town` SHALL succeed only when the character's current map resolves to `type = town`, `status = town`, and no map transition is pending; it saves that current Town. The frontend SHALL display `Save here` in the Town panel until that Town is saved, then show non-clickable `Saved ✔`; the saved Town tile SHALL display `/project/T_waypoint.png`. This change SHALL NOT restrict existing map-click teleport behavior.

#### Scenario: Save the Town currently occupied

- **GIVEN** a character is settled in a Town and has not saved that Town
- **WHEN** they click `Save here`
- **THEN** the server persists the current Town ID and the UI switches to `Saved ✔`
- **AND** that Town's world-map tile displays the waypoint icon after reload

#### Scenario: Saving while moving is rejected

- **GIVEN** `pendingMapTransition` is not null or the character is not settled in a Town
- **WHEN** a save request is received
- **THEN** the server rejects it and leaves `savedTownMapId` unchanged
