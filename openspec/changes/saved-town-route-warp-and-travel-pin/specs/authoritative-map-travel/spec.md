## ADDED Requirements

### Requirement: Saved Town as an intermediate route waypoint

When the canonical deterministic shortest route from the current map to a different requested destination contains the Character's valid saved Town strictly between the route origin and its final destination, the server MUST use that saved Town as a one-time instant teleport waypoint, then recompute and continue the route from the saved Town to the original destination. The origin and final destination MUST NOT be treated as intermediate waypoints. This MUST preserve the original destination and remain idempotent under the persisted travel generation/schedule contract.

#### Scenario: Route contains the saved Town between origin and destination

- **WHEN** the requested canonical BFS route includes the valid saved Town as a node after the origin and before the clicked destination
- **THEN** Traveling commits a one-time teleport to the saved Town and continues by a fresh canonical route to the clicked destination

#### Scenario: Saved Town is the origin or final destination

- **WHEN** the saved Town is the current route origin or the clicked final destination
- **THEN** no intermediate-waypoint teleport is added and the existing origin/direct saved-Town behavior applies

#### Scenario: A battle is already in progress

- **WHEN** the route request chooses a saved-Town waypoint while a battle is active
- **THEN** the server MUST NOT commit the waypoint mid-battle and MUST wait for the battle to resolve before processing the waypoint intent

#### Scenario: Character dies during saved-Town-waypoint Traveling

- **WHEN** the Character dies while a persisted route marked for saved-Town-waypoint travel is waiting on or continuing after combat
- **THEN** the Character respawns at the saved Town and the originally requested destination route resumes from the actual respawn map

#### Scenario: Character dies outside a saved-Town-waypoint route

- **WHEN** the Character dies without an active route marked for the saved-Town waypoint behavior
- **THEN** the existing death handling clears active Traveling and Gathering state

### Requirement: Location pin projects authoritative Traveling progress

The map location pin MUST remain presentation-only and use the exact progress percentage and pause behavior of the existing Traveling gauge. It MUST follow the active authoritative route segment along cardinal tile geometry, entering from the edge that faces the previous route node, passing through the tile center when the route turns, and reaching the exit edge that faces the next route node when progress reaches 100%. Segment commits MUST preserve position across the shared map boundary. During active battle, waiting-for-battle, or a zero-speed pause, pin position MUST stop advancing whenever the gauge is frozen. The pin MUST NOT affect or persist gameplay movement state.

#### Scenario: Travel segment progress advances

- **WHEN** the authoritative Traveling gauge advances along a route segment
- **THEN** the location pin follows the same progress from the current tile's entry edge through its center to the outgoing edge

#### Scenario: Route changes direction at a tile

- **WHEN** the route enters and exits a tile on perpendicular edges
- **THEN** the pin turns at the tile center and never follows a diagonal shortcut across the corner

#### Scenario: Segment commit crosses the map boundary

- **WHEN** the server commits arrival at the next route node
- **THEN** the pin's outgoing-edge position on the previous tile equals the incoming-edge position on the new tile

#### Scenario: Battle or speed pause freezes Traveling

- **WHEN** the Traveling gauge is frozen because of battle, waiting-for-battle, or zero effective Move Speed
- **THEN** the location pin remains at its current visual coordinate until the gauge resumes

#### Scenario: Route completes

- **WHEN** the Character reaches the final route destination
- **THEN** the pin remains at the entry edge from the previous map, while its normal settled animation may resume, and no client-side movement timer continues
