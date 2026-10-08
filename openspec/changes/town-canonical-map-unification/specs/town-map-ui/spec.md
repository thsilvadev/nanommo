# Spec Delta

## ADDED Requirements

### Requirement: Grind Board has one canonical Town node

The Grind Board SHALL display exactly one Town node, and that node SHALL represent the canonical Town map `map_town`.

#### Scenario: Town is supplied by the map catalog

- **WHEN** the canonical map catalog contains the Town entry
- **THEN** the Board displays one Town node
- **AND** that node represents `map_town`.

#### Scenario: Town is excluded from the generic grind list

- **WHEN** the Board renders the generic map collection
- **THEN** all Town-marked maps (`isTown: true`) are excluded from the generic grind-map renderer
- **AND** `map_town` is not rendered a second time.

#### Scenario: Duplicate Town data

- **WHEN** invalid catalog data contains more than one Town-marked entry
- **THEN** the Board SHALL NOT intentionally render multiple Town nodes
- **AND** the verification suite SHALL report the catalog inconsistency.

### Requirement: Town node uses canonical Town transition semantics

The single Town node SHALL use the existing authoritative Town-return operation and SHALL NOT use the grind-map entry operation.

#### Scenario: Town requested from a grind map without an active battle

- **WHEN** the character is outside Town
- **AND** no battle is actively running
- **AND** the player selects Town
- **THEN** the client requests the existing Town-return operation
- **AND** the authoritative character state becomes `currentMapId = map_town`, `status = town`, `pendingMapTransition = null`.

#### Scenario: Town requested during an active battle

- **WHEN** the character is outside Town
- **AND** an active battle is running
- **AND** the player selects Town
- **THEN** the existing deferred Town transition is created
- **AND** the current battle is allowed to finish
- **AND** no second independent Town transition is created.

#### Scenario: Town clicked while already in Town

- **WHEN** `currentMapId = map_town`
- **THEN** the click has no gameplay side effect
- **AND** no grind-entry request is sent
- **AND** no new pending transition is created
- **AND** no grind queue is started or restarted.

### Requirement: Town remains a real gameplay map

Town SHALL continue to use `map_town` as its physical location and gameplay presence identity.

#### Scenario: Settled Town presence

- **WHEN** `currentMapId = map_town`
- **AND** `pendingMapTransition = null`
- **THEN** the character is a gameplay member of `map_town`
- **AND** the existing absolute `map:presence` contract reports the Town population.

#### Scenario: Town is not encounter-search population

- **WHEN** encounter-search population is calculated for a grind map
- **THEN** characters in `map_town` are excluded regardless of Town population.

### Requirement: Town-only functionality follows canonical location

Existing Town-only NPC functionality SHALL require the canonical Town location.

#### Scenario: NPC interaction in settled Town

- **WHEN** `currentMapId = map_town`
- **AND** `pendingMapTransition = null`
- **THEN** existing Town NPC behavior remains available subject to its existing rules.

#### Scenario: NPC interaction outside Town

- **WHEN** `currentMapId != map_town`
- **THEN** Town NPC interaction is rejected
- **EVEN IF** `status = town` is stale.

#### Scenario: NPC interaction during pending Town transition

- **WHEN** `pendingMapTransition` is not null
- **THEN** Town NPC interaction remains unavailable until the transition is finalized.

### Requirement: No legacy second Town representation

The frontend SHALL NOT maintain a second Town route/component/location representation alongside `map_town`.

#### Scenario: Dead legacy Town component

- **WHEN** repository-wide reference search proves `TownCenter` is unused
- **THEN** the obsolete `TownCenter` component and its unused template/style files are removed
- **AND** no replacement second Town component or route is created.

#### Scenario: Canonical routing

- **WHEN** the Play shell is used
- **THEN** Town remains represented by the existing map-first Grind Board
- **AND** no `/play/town` route is introduced.

### Requirement: Existing Town visual composition is preserved

The unification SHALL not redesign the existing Town node or Play shell.

#### Scenario: Visual preservation

- **WHEN** the unified Town node is rendered
- **THEN** its established placement, geometry, dimensions, icon, borders, colors, typography, scaling and surrounding composition remain unchanged.
