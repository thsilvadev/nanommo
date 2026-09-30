# Map Presence

## ADDED Requirements

### Requirement: Realtime map population
The server SHALL maintain authoritative grinder presence per map and broadcast the current population to connected clients over the existing /game Socket.IO connection whenever map membership changes.

#### Scenario: Enter map
- **WHEN** a character enters a map
- **THEN** all connected players on that map receive the new player count in realtime

#### Scenario: Leave map
- **WHEN** a character leaves a map
- **THEN** remaining connected players on that map receive the decremented count in realtime

#### Scenario: Disconnect
- **WHEN** a connected grinder disconnects
- **THEN** their map presence is removed and the remaining map players receive the updated count

#### Scenario: Header display
- **WHEN** the player is viewing a map in the central grind view
- **THEN** the location header shows Players in map: X aligned to the right
