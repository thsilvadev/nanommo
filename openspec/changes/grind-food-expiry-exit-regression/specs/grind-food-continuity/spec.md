# Grind Food Continuity

## Purpose

Define the authoritative food-expiry boundary that controls whether a living character may start the next Grind encounter, and prevent premature Town transitions caused by future queue projections.

## ADDED Requirements

### Requirement: Food expiry must not end Grind early

The server SHALL keep a living character on the current grind map while the authoritative active food buff has positive remaining duration. A projected food expiry in a future queued battle SHALL NOT, by itself, change the Character's actual map or status to Town.

#### Scenario: Food has approximately two minutes remaining during an encounter gap

- **GIVEN** a living character is grinding on a map
- **AND** the active food buff expires approximately two minutes in the future
- **AND** no battle is active at the exact time queue generation runs
- **AND** a future queued battle ends after the food's expiry timestamp
- **WHEN** queue generation / top-up runs
- **THEN** the character remains on the current grind map while the active food is still valid at the current time
- **AND** the character is not routed to Town solely because the projected food buff was cleared while traversing future queue entries
- **AND** the test records the before/after status, map, food expiry, queue entries and presence calls.

### Requirement: The next encounter must be food-valid at its start

The server SHALL NOT allow a new encounter/battle to start at or after the active food expiry unless an eligible food has first been authoritatively consumed and the queue has been rebuilt using the new food state.

#### Scenario: Food expires during a battle that legally started while fed

- **GIVEN** the active food is valid at the next battle's start
- **AND** its expiry occurs during that battle
- **WHEN** that battle starts and later resolves
- **THEN** the battle resolves normally and is not retroactively cancelled or rewritten
- **AND** the character is evaluated for the next encounter only after that resolution
- **AND** no subsequent battle starts without valid food.

#### Scenario: Food expires before the next encounter can start

- **GIVEN** the current battle has resolved normally
- **AND** the active food expires at or before the next encounter start, including encounter-search delay
- **AND** no eligible Auto Feed food can replace it
- **WHEN** the server evaluates whether to queue/start the next encounter
- **THEN** no new battle is queued to start without valid food
- **AND** the character is routed to Town through the authoritative food-exhaustion path
- **AND** unresolved future battles are discarded and map presence is synchronized exactly once.

### Requirement: The final food boundary must allow Auto Feed to sustain Grind

When Auto Feed is enabled and an eligible configured Diet food is available at the next encounter boundary, the server SHALL consume it through the existing authoritative food-consumption path before applying the Hungry/Town fallback.

#### Scenario: Auto Feed replaces the final food before the next battle

- **GIVEN** the active food cannot cover the next safe encounter start
- **AND** Auto Feed is enabled
- **AND** a configured Diet food has completed digestion and has positive Inventory quantity
- **WHEN** the food-exhaustion boundary is processed
- **THEN** exactly one eligible food unit is consumed
- **AND** Diet progression, digestion, active buff and Inventory are updated using existing rules
- **AND** the future queue is rebuilt from the committed Character + Inventory state
- **AND** the character remains on the grind map without an intermediate Town transition.

### Requirement: No arbitrary expiry grace period

The server SHALL use the authoritative food expiry timestamp and encounter schedule; it SHALL NOT treat food as expired early because it is near expiry or apply a fixed safety margin such as two minutes.

#### Scenario: Positive remaining duration

- **GIVEN** active food expiry is strictly later than the current evaluation time
- **WHEN** the server evaluates Grind continuity
- **THEN** it does not route the character to Town solely because the remaining duration is small
- **AND** any decision about the next battle is based on whether food is valid at that battle's start, not on a generic early-exit threshold.

### Requirement: Food exhaustion is separate from death and explicit map transitions

Food expiry logic SHALL remain distinct from death handling and explicit player-requested map transitions. It SHALL NOT alter an already-running battle, suppress death routing, or use socket connectivity as a proxy for Grind eligibility.

#### Scenario: Character dies while food remains active

- **GIVEN** a battle resolves as a loss with character HP reaching zero
- **WHEN** death handling executes
- **THEN** the existing death-to-Town contract remains authoritative
- **AND** food-continuity logic does not override or duplicate death effects.

#### Scenario: Explicit Town request

- **GIVEN** a player explicitly requests leaving the grind map
- **WHEN** the map transition is processed
- **THEN** the existing explicit transition contract remains unchanged and does not depend on food expiry.

## Acceptance

- The reported premature exit is reproduced by a deterministic test or the leading hypothesis is rejected and the actual cause is demonstrated by an alternative failing regression.
- The fix prevents all premature Town transitions while food remains valid at the current time.
- No battle starts when the last food is expired at the next encounter boundary and no eligible replacement exists.
- Auto Feed gets one authoritative chance to replace food before Hungry/Town when eligible.
- No double consumption, duplicate transition, stale queue, presence inconsistency, or current-battle mutation is introduced.
- Focused regression tests and required builds pass; relevant project status/spec documentation is updated.
