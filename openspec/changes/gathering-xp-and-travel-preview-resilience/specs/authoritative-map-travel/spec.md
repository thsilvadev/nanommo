## ADDED Requirements

### Requirement: Active Traveling remains visible in the map preview

When the Character has an active persisted `travelIntent`, the frontend MUST derive the destination marker from `travelIntent.destinationMapId` and show the remaining canonical route from `routeMapIds` and `segmentIndex` whenever that route is valid, even if local preview state has been cleared by a battle-resolution update. The active server intent MUST take precedence over stale local suppression/preview state. If no authoritative route path is available, the frontend MAY render a canonical BFS preview from the current map to the active destination; it MUST NOT fabricate a non-cardinal connection. Normal preview clearing at authoritative arrival or cancelled/ended intent remains unchanged.

#### Scenario: Battle resolves while Traveling continues

- **WHEN** a battle resolves and the server retains a `travelIntent` toward a destination
- **THEN** the destination pin and route remain visible or are reconstructed from that intent, matching the location pin's active route

#### Scenario: Local preview was cleared but server route is active

- **WHEN** the local destination signal is empty while the Character snapshot contains a valid active route
- **THEN** the destination marker and remaining path are rendered from the server route

### Requirement: Moving location pin visual alignment

The location pin MUST be offset upward by 7 CSS pixels only during a valid cardinal route segment to align the marker artwork with the path. The settled/idle pin MUST retain its existing unshifted placement.

#### Scenario: Pin traverses a cardinal route leg

- **WHEN** the active route segment is a valid cardinal edge
- **THEN** the rendered pin position uses the projected route Y coordinate minus 7 pixels

#### Scenario: Pin is settled

- **WHEN** no valid route segment is being traversed
- **THEN** the rendered pin position equals its normal projected/stationary position with no vertical correction
