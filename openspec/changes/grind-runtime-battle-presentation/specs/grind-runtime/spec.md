# Grind Runtime and Battle Presentation

## ADDED Requirements

### Requirement: Continuous grind
The server SHALL maintain a sequential one-monster-at-a-time grind queue while the character remains alive, fed, and supplied.

#### Scenario: Win continues the grind
- **GIVEN** the current queued battle resolves as win
- **WHEN** XP, gold, drops and HP/SP are applied
- **THEN** the server appends enough future battles to restore the unresolved queue to five when resources permit

#### Scenario: Exhausted resources stop the grind
- **GIVEN** no usable HP potion remains or the active food buff has expired
- **WHEN** the last currently queued battle resolves
- **THEN** the character is moved to town, currentMapId becomes null, and no new battle is queued

### Requirement: Rewards resolve once
A winning battle SHALL grant the queued XP, gold and drops exactly once when the authoritative resolve occurs.

#### Scenario: Resolved win
- **GIVEN** a queued battle has outcome win
- **WHEN** its delayed job resolves
- **THEN** XP, gold, drops, HP and SP are applied once and the entry becomes resolved

### Requirement: Death stops the chain
A loss SHALL route the character to town and discard every later unresolved battle in the chain.

#### Scenario: Losing battle
- **GIVEN** a queued battle resolves as loss
- **WHEN** death handling runs
- **THEN** status becomes town, currentMapId becomes null, hpCurrent becomes 1, later unresolved entries are deleted, and no replacement battles are queued

### Requirement: Deferred equipment replacement
Equipment replacement requested during an active battle SHALL be persisted as pending state and SHALL not affect the active battle's snapshot.

#### Scenario: Replace weapon during battle
- **GIVEN** a battle is currently between startAt and endAt
- **WHEN** the user equips another legal weapon
- **THEN** the requested item is staged, the active battle continues using its original snapshot, and the staged equipment is applied before the next battle is simulated

#### Scenario: Replace equipment between battles
- **GIVEN** no battle is currently in flight
- **WHEN** equipment is changed
- **THEN** the new equipment is authoritative immediately and pending state is cleared

### Requirement: Authoritative battle playback
The frontend SHALL render the current battle's HP changes from the server-provided log and timestamps without simulating combat outcomes.

#### Scenario: Damage event playback
- **GIVEN** the current queue entry contains log events with integer ticks and hpRemaining
- **WHEN** the current wall-clock time reaches each event tick
- **THEN** the displayed monster and character HP move to the corresponding authoritative values

#### Scenario: Battle end
- **GIVEN** the current battle reaches endAt
- **WHEN** battle:resolved is received
- **THEN** the UI shows the resolved result and transitions to the next queued battle or the town/idle state

### Requirement: Reconnect consistency
A reconnect SHALL replace local queue and character state with authoritative server state.

#### Scenario: Browser reconnect
- **GIVEN** the socket disconnects and reconnects
- **WHEN** the client resynchronizes
- **THEN** the rendered battle, character HP and grind state match the current REST/socket state
