# Capability: battle-loop-websocket-gateway

## ADDED Requirements

### Requirement: authenticated game gateway

The backend SHALL expose Socket.IO namespace /game and SHALL reject a connection when the handshake does not contain a valid access token whose sessionId matches the user's current activeSessionId.

#### Scenario: valid authenticated connection
- GIVEN a valid access token with the current session
- WHEN the client connects to /game
- THEN the server accepts the connection and associates it with the authenticated character
- AND the socket joins char:<characterId>

#### Scenario: invalid or stale session
- GIVEN a missing, invalid, expired, or session-invalidated token
- WHEN the client connects to /game
- THEN the connection is rejected
- AND no character or map room is joined

### Requirement: socket map intents use authoritative services

The backend SHALL accept map:enter { mapId } and map:leave {} through /game, but SHALL delegate authoritative state changes to MapService.

#### Scenario: enter map
- GIVEN an authenticated character allowed to enter mapId
- WHEN the socket sends map:enter
- THEN MapService.enterMap() validates and persists the transition
- AND the existing BattleService queue path creates the queue
- AND the socket joins map:<mapId>
- AND battle:queueUpdated is emitted with the live unresolved queue

#### Scenario: invalid map entry
- GIVEN an authenticated character that cannot enter the requested map
- WHEN the socket sends map:enter
- THEN the request fails with a socket error
- AND the character remains in its previous authoritative state
- AND no new queue is created

#### Scenario: leave map
- GIVEN an authenticated character currently grinding
- WHEN the socket sends map:leave
- THEN MapService.leaveMap() persists town state
- AND pending queue work is cancelled according to the existing map-leave contract
- AND the socket leaves the map room

### Requirement: authoritative battle synchronization

The backend SHALL emit battle:queueUpdated whenever the live unresolved battle queue is established or changes because of authoritative battle-loop processing.

#### Scenario: queue established on map entry
- WHEN map entry successfully builds the queue
- THEN battle:queueUpdated contains the live unresolved BattleQueueEntry[] from the queue read path

#### Scenario: queue topped up
- WHEN a resolved battle leaves the character alive and on the map and the queue is topped up
- THEN battle:queueUpdated contains the resulting live queue

#### Scenario: level-up rebuild
- WHEN a resolve gains one or more levels and rebuilds the remaining chain
- THEN the queue update contains only the rebuilt unresolved entries

#### Scenario: death
- WHEN a loss resolves and the character is routed to town
- THEN no replacement queue is emitted

### Requirement: authoritative battle resolution event

The backend SHALL emit battle:resolved only after an entry is successfully claimed and its authoritative effects are applied.

The payload SHALL contain entryId, outcome, xpGain, goldGain, drops, and characterAfter using persisted post-resolution character values.

#### Scenario: normal resolution
- WHEN a winning entry resolves successfully
- THEN exactly one battle:resolved is emitted for that successful claim
- AND characterAfter reflects persisted state

#### Scenario: duplicate resolution
- GIVEN the same entry is handed to the resolver more than once
- WHEN the second invocation fails the resolved=false claim
- THEN it performs no gameplay mutation
- AND it emits no duplicate battle:resolved

### Requirement: level-up event

The backend SHALL emit character:leveledUp when an authoritative battle resolution crosses one or more level thresholds.

The payload SHALL contain final newLevel and unspentAttributePoints.

#### Scenario: level gained
- WHEN a battle resolution gains one or more levels
- THEN one character:leveledUp event is emitted
- AND the payload contains the final level and final unspent points

#### Scenario: no level gained
- WHEN a battle resolves without crossing a threshold
- THEN no character:leveledUp event is emitted

### Requirement: death event

The backend SHALL emit character:died after death state is persisted.

The payload SHALL contain the stored deathLog produced by the death handler.

#### Scenario: character dies
- WHEN a loss resolves
- THEN the character is persisted in town with the death log
- AND one character:died event is emitted
- AND the unresolved remainder of the queue is removed
- AND no new grind queue is created

### Requirement: non-blocking event publication

Event delivery SHALL never be a prerequisite for battle-loop correctness.

#### Scenario: publication failure
- GIVEN Redis or Socket.IO publication fails
- WHEN a battle is being resolved
- THEN authoritative DB mutations still complete
- AND level-up/death/queue-rebuild logic still runs
- AND the failure is logged

### Requirement: frontend resynchronization

The future frontend SHALL treat REST as the authoritative state source and WebSocket events as synchronization notifications/facts.

#### Scenario: reconnect
- GIVEN the client was disconnected while battles resolved
- WHEN it reconnects
- THEN it fetches authoritative character state and GET /battles/queue
- AND it does not infer missed outcomes from elapsed wall-clock time

### Requirement: server-controlled timing

The frontend SHALL render battle progress from server-provided startAt and endAt values and SHALL never decide outcome or resolution timing.

#### Scenario: battle progress
- GIVEN a queue entry with server startAt and endAt
- WHEN the UI renders progress
- THEN it derives display progress from those timestamps
- AND it never simulates the battle or schedules authoritative resolution
