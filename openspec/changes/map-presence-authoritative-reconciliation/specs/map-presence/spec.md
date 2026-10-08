# Spec Delta

## ADDED Requirements

### Requirement: Centralized authoritative map membership
The server SHALL derive gameplay map presence from the Character state and SHALL expose one reusable synchronization service for authoritative map-state changes.
A character counts on a map exactly when status=grinding, currentMapId is set, and returnToTownAfterBattle is not true.

#### Scenario: Map entry
- **WHEN** an authoritative map-entry transition saves a character on map M
- **THEN** the map-presence service adds that character to M and publishes the resulting absolute population for M

#### Scenario: Map movement
- **WHEN** an authoritative movement transition changes a character from map A to map B
- **THEN** the service removes the character from A and publishes A's new count, then adds the character to B and publishes B's new count

#### Scenario: Death exits the map
- **WHEN** a grinding character dies and its authoritative state becomes Town with currentMapId=null
- **THEN** the previous map membership is removed and the previous map receives the decremented absolute population

#### Scenario: Food exhaustion exits the map
- **WHEN** authoritative grind continuation stops because the character has no valid food and the character is routed to Town
- **THEN** the previous map membership is removed and its corrected population is published

### Requirement: Realtime map population is event-driven
The server SHALL publish map:presence when map membership actually changes. Battle start/end is not itself a map-presence trigger.

#### Scenario: Battle start without movement
- **WHEN** a battle starts and the character remains on the same map with the same active-map eligibility
- **THEN** no map-presence change is inferred solely from battle start

#### Scenario: Membership change
- **WHEN** a character enters, leaves, or moves between maps
- **THEN** the affected map(s) receive the current absolute playersOnMap value through the existing map:presence event

### Requirement: Absolute presence payload
The map:presence event SHALL retain { mapId, playersOnMap }, where playersOnMap is the full current count.

#### Scenario: Client receives population snapshot
- **WHEN** the client receives map:presence
- **THEN** it replaces the displayed count with playersOnMap rather than applying a delta

### Requirement: Redis is a runtime cache, not gameplay authority
Redis SHALL retain the existing timestamped map:players:{mapId} cache and SHALL be repaired from authoritative PostgreSQL state by periodic reconciliation.

#### Scenario: Redis member loss
- **WHEN** an active grinder is missing from Redis but remains eligible in PostgreSQL
- **THEN** reconciliation restores the Redis member and the correct population

#### Scenario: Disconnect while grinding
- **WHEN** a grinding character's Socket.IO connection disconnects
- **THEN** map presence is not removed and the character remains eligible for population

### Requirement: Deferred Town return remains a special battle rule
returnToTownAfterBattle SHALL remain a battle/Town-return control flag, not the general map-membership mechanism.

#### Scenario: Deferred Town request
- **WHEN** a character requests Town during an active battle
- **THEN** the flag remains authoritative for the battle lifecycle, but map presence is removed immediately because the character is no longer eligible for active map presence

### Requirement: Online presence is separate and reusable
Online/socket presence SHALL be owned by OnlinePresenceService. It SHALL remain independent from gameplay map presence and SHALL expose a reusable heartbeat touch hook for future friend/online-player features.

#### Scenario: Socket disconnect
- **WHEN** a client disconnects
- **THEN** online presence is updated without modifying gameplay map membership