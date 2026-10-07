# Spec Delta

## Purpose

Tracks how many characters are currently grinding on each map and broadcasts that count to connected clients so the UI can show realtime map population.

## ADDED Requirements

### Requirement: Map presence cleanup on all exit paths
The server SHALL remove a character from the Redis map-presence hash and publish the updated count whenever that character stops grinding on a map, regardless of which code path caused the exit.

#### Scenario: Leave via HTTP endpoint
- **WHEN** a character calls the HTTP `/maps/leave` endpoint and the leave succeeds (immediate or deferred)
- **THEN** the character is removed from the old map's presence hash and connected clients on that map receive the decremented count

#### Scenario: Leave via WebSocket event
- **WHEN** a character emits the `map:leave` socket event
- **THEN** the character is removed from the old map's presence hash and connected clients on that map receive the decremented count

#### Scenario: Death sends character to town
- **WHEN** a battle resolves as a loss and the character is routed to town
- **THEN** the character is removed from the battle map's presence hash and connected clients on that map receive the decremented count

#### Scenario: Deferred town return resolves
- **WHEN** a character requested town return while a battle was active, and that battle later resolves
- **THEN** the character is removed from the map's presence hash and connected clients on that map receive the decremented count

#### Scenario: Hunger exhausts food buff during battle
- **WHEN** a battle resolves and the character's food buff has expired, causing a town return
- **THEN** the character is removed from the map's presence hash and connected clients on that map receive the decremented count

#### Scenario: Disconnect while on a map
- **WHEN** a connected character disconnects and their persisted `currentMapId` is still set
- **THEN** the character is removed from that map's presence hash and connected clients on that map receive the decremented count

#### Scenario: Idempotent cleanup
- **WHEN** a presence cleanup is triggered for a character who was already removed from the map's presence hash by an earlier cleanup
- **THEN** the operation SHALL succeed without error and publish the current count
