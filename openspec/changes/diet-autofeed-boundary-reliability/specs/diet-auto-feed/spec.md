# Diet Auto Feed — Boundary Reliability

## ADDED Requirements

### Requirement: Auto Feed boundary continuity

Auto Feed SHALL consume an eligible retained Diet food before the next encounter boundary whenever the active food cannot remain valid through that boundary, including when no unresolved future battle is currently queued.

#### Scenario: Active food expires before the next encounter when a future battle exists

- **GIVEN** Auto Feed is enabled
- **AND** the active food expires at or before the start of the next safely scheduled encounter
- **AND** a retained Diet food is finished digesting and has positive Inventory quantity
- **WHEN** the current battle resolves
- **THEN** exactly one unit of that eligible food is consumed
- **AND** its Diet streak/slot state is updated through the authoritative food-consumption rules
- **AND** the future Grind queue is rebuilt from the resulting authoritative Character and Inventory state.

#### Scenario: No future queue entry but the next encounter would start after food expiry

- **GIVEN** Auto Feed is enabled
- **AND** the current battle is resolving successfully
- **AND** the active food expires after the current resolution time but before the next encounter could safely start, including its encounter-search delay
- **AND** no unresolved future battle remains because queue generation stopped at the food boundary
- **AND** a retained Diet food is finished digesting and has positive Inventory quantity
- **WHEN** the current battle resolves
- **THEN** Auto Feed consumes exactly one unit of the eligible food before the character is left without a viable next encounter
- **AND** the unresolved queue is rebuilt from the new food state
- **AND** the character remains eligible to continue Grind instead of entering Hungry/Town solely because the queue had no future row.

#### Scenario: Food remains valid through the next encounter

- **GIVEN** Auto Feed is enabled
- **AND** the active food remains valid beyond the next safe encounter start
- **WHEN** the current battle resolves
- **THEN** Auto Feed does not consume another food prematurely
- **AND** the existing future queue remains authoritative.

#### Scenario: No eligible configured food

- **GIVEN** Auto Feed is enabled
- **AND** every retained Diet food is either still digesting or absent from Inventory
- **WHEN** the active food cannot sustain the next encounter boundary
- **THEN** no food is consumed
- **AND** the existing Hungry/Town invariant remains authoritative.

#### Scenario: Auto Feed disabled

- **GIVEN** Auto Feed is disabled
- **AND** the active food cannot sustain the next encounter boundary
- **WHEN** the current battle resolves
- **THEN** no automatic food consumption occurs
- **AND** the existing Hungry/Town behavior remains unchanged.

### Requirement: Authoritative queue rebuild after Auto Feed

A successful automatic food consumption SHALL invalidate unresolved future battles and rebuild them from the authoritative post-consumption Character and Inventory state.

#### Scenario: Rebuild after empty-queue boundary consumption

- **GIVEN** Auto Feed consumes a food because the current battle had no viable future encounter
- **WHEN** the food transaction succeeds
- **THEN** unresolved precomputed battles are discarded
- **AND** a new queue is simulated using the new active food buff, Diet state and Inventory quantities
- **AND** the resolved battle is not rewritten or replayed.

### Requirement: Realtime convergence after automatic consumption

An Auto Feed mutation SHALL converge the realtime Character and Inventory state to the same authoritative post-resolution state used to rebuild the Grind queue.

#### Scenario: Client receives post-Auto-Feed state

- **GIVEN** Auto Feed consumes a food during battle resolution
- **WHEN** the server publishes the resulting battle/queue state
- **THEN** Character Diet, active food buff, Auto Feed state and Inventory quantity reflect the same authoritative revision
- **AND** the frontend does not need a client-side timer or polling loop to perform the consumption.

## Acceptance

- The reported case is covered: Auto Feed ON + all configured foods available + active food ending at a queue boundary results in automatic consumption instead of Hungry/Town.
- A future queue is rebuilt after automatic consumption.
- No duplicate food consumption occurs.
- Existing manual food consumption and Hungry/Town fallback semantics remain unchanged.
