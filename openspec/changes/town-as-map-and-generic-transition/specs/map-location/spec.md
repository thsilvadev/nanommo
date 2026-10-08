# Spec Delta

## ADDED Requirements

### Requirement: Town is a first-class map location

The system SHALL represent Town with the canonical map ID `map_town`. `Character.currentMapId` SHALL be non-nullable and SHALL always identify the character's authoritative physical gameplay location.

#### Scenario: Character creation
- **WHEN** a character is created
- **THEN** its `currentMapId` is `map_town` and its status remains `town`

#### Scenario: Town is not a sentinel
- **WHEN** any backend or frontend subsystem needs to determine whether a character is in Town
- **THEN** it checks the canonical Town map identity rather than interpreting NULL/undefined `currentMapId` as Town

#### Scenario: Town is a map but not a grind map
- **WHEN** the map catalog is loaded
- **THEN** Town exists as a canonical map/location but cannot be selected through the normal grind-entry path and has no monster encounter pool

### Requirement: Generic pending map transition

The system SHALL represent a deferred map transition with a generic `pendingMapTransition` state containing at least a destination map ID and a reason. The state SHALL be independent from battle-specific map-presence logic.

#### Scenario: Deferred Town request
- **WHEN** a character requests Town during an active battle
- **THEN** the current `currentMapId` remains the current battle map, `pendingMapTransition.destinationMapId` becomes `map_town`, and the character becomes ineligible for current-map presence

#### Scenario: Generic presence does not inspect transition reason
- **WHEN** MapPresenceService determines map membership
- **THEN** it only checks whether the pending transition exists, not why it exists or whether the destination is Town

#### Scenario: Immediate transition
- **WHEN** an authoritative map transition completes immediately
- **THEN** `currentMapId` is set to the destination and `pendingMapTransition` is cleared before presence synchronization

### Requirement: Authoritative map presence uses physical location

A character SHALL count on exactly one map when `currentMapId` is set and `pendingMapTransition` is null. Presence SHALL NOT depend on Socket.IO connection state or Character.status.

#### Scenario: Town population
- **WHEN** a character is in Town with `currentMapId = map_town` and no pending transition
- **THEN** the character counts in Town's `playersOnMap`

#### Scenario: Grinding population
- **WHEN** a character is grinding on map M with no pending transition
- **THEN** the character counts on M

#### Scenario: Deferred transition
- **WHEN** a character has a pending map transition while its current map remains M
- **THEN** it does not count on M

#### Scenario: Socket disconnect
- **WHEN** a present character disconnects its Socket.IO connection
- **THEN** its gameplay map membership remains unchanged

### Requirement: Encounter timing remains grinder-specific

Encounter-search timing SHALL count only characters whose status is `grinding`, whose `currentMapId` is the target grind map, and whose pending map transition is null.

#### Scenario: Town residents do not affect encounter search
- **WHEN** multiple characters are in Town
- **THEN** they do not contribute to the encounter-search delay for any grind map

#### Scenario: Deferred grinder does not affect search load
- **WHEN** a grinding character has a pending map transition
- **THEN** it is excluded from the other-grinder count

### Requirement: Presence changes stream in realtime

The system SHALL preserve the public `map:presence` payload `{ mapId, playersOnMap }` as an absolute snapshot and SHALL publish it whenever authoritative map membership/count changes.

#### Scenario: Enter Town
- **WHEN** a character changes from a grind map to Town
- **THEN** the old map receives its decremented absolute count and Town receives its incremented absolute count

#### Scenario: Move between grind maps
- **WHEN** a character changes from map A to map B
- **THEN** A and B receive their current absolute counts

#### Scenario: Deferred Town request
- **WHEN** a character requests Town during an active battle
- **THEN** the old map receives an immediate decremented absolute count even though `currentMapId` is finalized only after battle resolution

### Requirement: Socket rooms follow authoritative location

The server SHALL keep connected sockets joined to the map room corresponding to their authoritative presence location.

#### Scenario: Connect in Town
- **WHEN** a connected character is authoritative in Town
- **THEN** its socket joins `map:map_town` and receives a fresh Town population snapshot

#### Scenario: Server-driven transition
- **WHEN** an authoritative map transition changes membership for a connected character
- **THEN** the gateway moves the socket from the previous map room to the new map room without requiring a frontend poll

#### Scenario: Deferred Town completion
- **WHEN** an active battle finishes a pending Town transition
- **THEN** the connected socket leaves the old map room, joins Town, and receives the current Town population snapshot

### Requirement: Legacy battle-specific presence flag is retired

The system SHALL no longer use `returnToTownAfterBattle` as a persistence or presence mechanism.

#### Scenario: Legacy deferred state migration
- **WHEN** the database migration finds a legacy character with `returnToTownAfterBattle = true`
- **THEN** it preserves the deferred Town intent as an equivalent `pendingMapTransition` before removing the legacy column

#### Scenario: Production source cleanup
- **WHEN** the migration and code change are complete
- **THEN** production code has no reads or writes of `returnToTownAfterBattle`

### Requirement: Reconciliation repairs all map memberships

Periodic reconciliation SHALL rebuild Redis membership from the generic authoritative map-membership rule, including Town.

#### Scenario: Missing Town Redis member
- **WHEN** a Town resident is absent from `map:players:map_town`
- **THEN** reconciliation restores the member and publishes the corrected Town population when the count changes

#### Scenario: Stale Town member
- **WHEN** a stale member exists in the Town Redis hash
- **THEN** stale pruning excludes/removes it before counting

## ADDED Requirements

### Requirement: Canonical Character map location

`currentMapId` changes from nullable to required, with `map_town` as the canonical default/bootstrap location. The Character API representation SHALL no longer use undefined/null as the normal Town representation.

#### Scenario: Existing character normalization
- **WHEN** an existing character is loaded after the migration
- **THEN** its `currentMapId` is always a concrete map ID and a character previously represented by NULL is represented by `map_town`

#### Scenario: API Town representation
- **WHEN** a Town character is serialized for the frontend
- **THEN** `currentMapId` is `map_town`, not undefined/null

### Requirement: Map presence ownership

MapPresenceService SHALL own generic location membership synchronization. MapService and other authoritative state transitions SHALL call it after persistence; BattleService SHALL only invoke it when a battle rule actually changes map membership.

#### Scenario: Authoritative transition hook
- **WHEN** an authoritative transition changes a character's map location or pending-transition state
- **THEN** the responsible domain service persists the Character first and calls MapPresenceService with the previous map ID so affected membership is synchronized

#### Scenario: Battle lifecycle isolation
- **WHEN** a battle starts or ends without a map membership transition
- **THEN** BattleService does not publish a map-presence change merely because the battle lifecycle changed
