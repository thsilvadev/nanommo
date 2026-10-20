# Spec Delta

## Purpose

Define authoritative map-by-map travel and persisted Hunting/Gathering/Traveling state while preserving the existing world-map topology, location pin, Town protections and saved waypoint.

## ADDED Requirements

### Requirement: Every canonical map has a validated map length

Every map record MUST contain mapLength. Current grind maps MUST use mapLength 25 for this change, while every Town map MUST use mapLength 0. The map validator/build check MUST reject missing/invalid lengths, Town lengths other than 0, and grind lengths below 25.

#### Scenario: Validate the initial world catalogue
- **WHEN** the canonical and frontend map catalogues are validated
- **THEN** all 36 current grind maps have mapLength 25, all five Towns have mapLength 0, and root/frontend records match
- **AND** existing coordinates, NPC assignments, monster rosters, presence weights and assets remain unchanged

### Requirement: Map clicks start authoritative route traversal

Clicking a different map MUST create or update a server-authoritative shortest cardinal route. currentMapId and the location pin MUST remain on the current map until each segment completes. Every committed intermediate arrival MUST update discovery and gameplay map presence exactly once.

#### Scenario: Travel across multiple grind maps
- **WHEN** a player clicks a reachable non-saved destination several maps away
- **THEN** the server computes deterministic BFS across adjacent canonical map nodes
- **AND** the pin remains at the source until a segment completes
- **AND** the source map remains the gameplay-presence map during that segment
- **AND** each completed intermediate map commits and is discovered before the next segment proceeds

### Requirement: Travel time uses dynamic Move Speed and a gauge

A timed segment MUST use its source mapLength and current authoritative character Move Speed. For mapLength 25, speed 51 MUST take 30 seconds, speed 100 MUST take 20 seconds and speed 250 MUST take 5 seconds under constant speed. The approved piecewise curve, low-speed extension, zero-speed pause, 250 cap and 5-second minimum are defined by the design. Speed changes MUST alter fill rate without erasing accrued progress.

#### Scenario: Speed increases during a segment
- **WHEN** speed-affecting equipment or a buff changes during travel
- **THEN** progress accrued under the old speed is retained
- **AND** future progress uses the new speed
- **AND** arrival occurs only after the server gauge completes

### Requirement: Town-to-adjacent-grind movement is instant

A cardinal edge between a Town and grind map MUST commit immediately in either direction. Every other edge MUST use timed traversal with the timed length floor. Saved-Town teleport is a separate exception.

#### Scenario: Leave a Town for an adjacent grind map
- **WHEN** a player selects a cardinally adjacent grind map from a Town
- **THEN** the map transition commits immediately
- **AND** the persisted non-travel stance is restored for the grind map

### Requirement: Destination changes preserve a segment when possible

When the player changes destination, the server MUST recompute the shortest route from the current authoritative location. The current segment gauge MUST be retained if the next map ID is unchanged and MUST reset only when the next map ID changes.

#### Scenario: Destination changes beyond the same next map
- **WHEN** the destination changes but the recomputed route has the same next map
- **THEN** progress is preserved and only the route after that next map is replaced

#### Scenario: Destination changes the next map
- **WHEN** the recomputed route selects a different next map
- **THEN** the new segment begins with zero progress

### Requirement: Hunting and Gathering are persisted stationary stances

Hunting and Gathering MUST be the only user-selectable stances. The last non-travel stance MUST remain persisted while Traveling and while settled in a Town. Traveling MUST be automatically derived from active travel intent and MUST NOT be clickable. Settled Town UI MUST not visually mark Hunting/Gathering active, but MUST preserve the stored stance for departure.

#### Scenario: Restore Gathering after travel
- **WHEN** a player selects Gathering and then clicks another map
- **THEN** Traveling activates automatically while Gathering remains saved
- **AND** Gathering is restored at final arrival, including Town arrival

#### Scenario: Cancel travel
- **WHEN** the player clicks the current map or chooses Hunting/Gathering during travel
- **THEN** route and destination preview are cancelled without changing currentMapId
- **AND** an active battle continues normally unless FLEE independently succeeds

### Requirement: Saved Town is a teleport waypoint and death respawn

Clicking saved Town MUST teleport instantly while idle. During battle it MUST set teleport intent and request FLEE; successful FLEE teleports immediately, otherwise combat continues and teleport occurs after normal battle resolution unless death happens first. Death MUST respawn at a valid saved Town, falling back to map_town. Other existing Town fallbacks remain unchanged.

#### Scenario: Saved Town clicked while idle
- **WHEN** a settled character clicks the saved Town
- **THEN** the server teleports there immediately and clears travel/Gathering work

#### Scenario: Saved Town clicked during combat
- **WHEN** a character clicks the saved Town during battle
- **THEN** Traveling/teleport intent activates and the first eligible FLEE roll occurs on the next combat tick
- **AND** successful FLEE cancels the battle without rewards and teleports
- **AND** if battle resolves first, normal outcome applies before teleport unless death occurs

#### Scenario: Death away from saved Town
- **WHEN** normal death resolution commits
- **THEN** the character respawns at saved Town or map_town fallback
- **AND** stale activity jobs cannot restart Grind

### Requirement: Travel and activity continue authoritatively offline

Travel progress and encounter timing MUST persist across reload, disconnection and server restart. Catch-up MUST process travel, encounter, battle and Gathering timestamps in chronological order and MUST NOT accrue travel or Gathering progress during battle intervals.

#### Scenario: Reconnect after offline travel
- **WHEN** the server recovers an active travel intent after offline time
- **THEN** elapsed non-battle intervals are applied by the server
- **AND** aggressive encounters/battles pause travel in their recorded intervals
- **AND** the client receives reconciled location, route and gauge progress

### Requirement: Activity gauges render authoritative progress

While Traveling, map-head MUST show a blueberry-blue progress gauge with bold white “Traveling…” above Players in map at the upper right, opposite Currently in. While stationary on a grind map in Hunting or Gathering, it MUST show an orange “Gathering…” gauge. The applicable gauge stays visible/frozen during battle. Traveling is visually distinct and uses the boots icon; only Hunting/Gathering controls are clickable. The “Searching for monster…” indicator MUST be removed.

#### Scenario: Battle pauses a route segment
- **WHEN** combat starts during a route segment
- **THEN** Traveling gauge remains visible and stops advancing until battle exits
- **AND** route resumes from the same segment/progress unless cancelled or superseded

#### Scenario: Stationary Hunting between encounters
- **WHEN** a character is stationary on a grind map in Hunting and not fighting
- **THEN** the orange Gathering gauge accrues passive collection
- **AND** no Searching for monster… indicator is shown
