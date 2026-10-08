# Spec Delta

## ADDED Requirements

### Requirement: Authoritative self-healing realtime map presence

The server SHALL treat map presence as a cache of authoritative gameplay state. A character SHALL count in `playersInMap` while `status=grinding`, `currentMapId` is set, and `returnToTownAfterBattle` is not true, regardless of Socket.IO connection state. Redis members SHALL carry a last-refresh timestamp and stale members SHALL be excluded before counting.

#### Scenario: Disconnected grinder remains present

- **WHEN** a character is grinding on map M and its Socket.IO connection disconnects
- **THEN** the character continues counting in `playersInMap` while its authoritative gameplay state remains active grinding

#### Scenario: Server reconciliation refreshes active grinder

- **WHEN** a character is actively grinding on map M, whether connected or disconnected
- **THEN** server-side reconciliation refreshes its Redis presence before the stale-presence TTL expires

#### Scenario: Stale member is pruned

- **WHEN** a map-presence hash contains a member whose last-refresh timestamp is older than the stale-presence TTL
- **THEN** the member is removed before the map population count is returned or published

#### Scenario: Concurrent refresh wins over stale prune

- **WHEN** stale pruning observes an old timestamp and the character refreshes presence before deletion
- **THEN** the refreshed membership remains present and is counted

### Requirement: Disconnect does not imply map exit

The server SHALL NOT remove map presence solely because a Socket.IO connection disconnects.

#### Scenario: Disconnect while grinding

- **WHEN** a grinding character disconnects and its authoritative `status` and `currentMapId` remain active
- **THEN** no map-presence deletion occurs and the character remains eligible for `playersInMap`

### Requirement: Deferred Town return is absent from active map presence

The server SHALL remove presence immediately when a character requests deferred Town return and SHALL NOT re-add it while `returnToTownAfterBattle=true`.

#### Scenario: Deferred return during active battle

- **WHEN** a character requests Town while a battle is active
- **THEN** its map presence is removed and reconciliation does not re-add it while the deferred-return flag remains true

### Requirement: Queue-generation Town transition cleans presence

Every server path that clears `Character.currentMapId` and routes the character to Town SHALL clean the corresponding Redis map presence.

#### Scenario: Food exhaustion during queue generation with no active battle

- **WHEN** queue generation finds no valid projected food and no active battle exists
- **THEN** the character is saved in Town, its previous map presence is removed, and the corrected count is published

### Requirement: Correct published count

The `map:presence` event SHALL report the count after stale members have been pruned.

#### Scenario: Published count excludes stale member

- **WHEN** a map has two active members and one stale Redis member
- **THEN** the published payload reports exactly 2 players on the map

### Requirement: Map presence cleanup on all gameplay exit paths

The server SHALL remove a character from Redis map presence and publish the updated count whenever authoritative gameplay state stops that character from grinding on a map. Cleanup SHALL remain idempotent.

#### Scenario: Every authoritative Town transition cleans presence

- **WHEN** a server-authoritative path changes a grinding character to Town and clears its previous `currentMapId`
- **THEN** the previous map presence is removed and the updated count is published

### Requirement: Existing realtime map population channel

The server SHALL continue to use the existing `map:presence` event over `/game` Socket.IO. No frontend polling or new event type is introduced.

#### Scenario: Current map header receives population

- **WHEN** map population changes and the client is connected to that map room
- **THEN** the existing `map:presence` event supplies the current `playersOnMap` count
