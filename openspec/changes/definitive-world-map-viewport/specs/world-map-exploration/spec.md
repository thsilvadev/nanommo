# Spec Delta

## Purpose

Defines NanoMMO's first coordinate-driven world map, including a movable fixed-scale viewport, persistent exploration, current-location pin, and navigation among Town and grind destinations. Map topology and encounter rosters remain server-authoritative catalogue data.

## ADDED Requirements

### Requirement: The world map SHALL use the approved canonical location catalogue

The canonical catalogue SHALL contain exactly the 41 locations documented in `design.md`, with unique IDs and unique integer coordinates inside a 15-column × 13-row world. Grid positions SHALL be one-based: `column = x + 8`, `row = 7 - y`; positive Y is north, negative X is west, and Sierra-Village at (0,0) occupies column 8, row 7. Unlisted coordinates SHALL remain non-clickable cells. Sierra-Village SHALL retain the stable ID `map_town`. All five Town locations SHALL have `type = "town"`; all other listed locations SHALL have `type = "grind"`. Every map record SHALL have numeric `unlockLevel = 0`; any `recommendedLevel` field is advisory metadata only and MUST NOT restrict entry. Every Town map SHALL reference the canonical Storage NPC, and Sierra-Village SHALL retain its existing NPCs. Every grind map SHALL have a valid weighted monster roster totaling 100%.

#### Scenario: The full map catalogue is valid

- **WHEN** the API or catalogue validator loads the canonical map data
- **THEN** it accepts 41 unique map records within the 15×13 grid with valid monster and NPC references
- **AND** rejects duplicate IDs, coordinate collisions, out-of-grid coordinates, missing monsters, Town maps without Storage, non-zero unlockLevel values, or grind rosters whose rates do not total 100%.

#### Scenario: Empty world cells remain non-clickable

- **WHEN** a coordinate in the 15×13 grid has no map record
- **THEN** that cell remains part of the world artwork but has no destination tile or map-entry action.

### Requirement: The world SHALL render as contiguous fixed-size cells in a movable viewport

The background SHALL use `project/map-background.png` at native dimensions of 2295×1989px, aligned with a 15-column × 13-row grid of exactly 153×153px cells. There SHALL be no gap, margin or spacing between cells. The viewport SHALL remain exactly 761×660px and SHALL support mouse drag and touch/pointer drag. Camera coordinates SHALL be clamped to the world bounds so empty space beyond the world is never exposed, and a drag SHALL not accidentally activate a tile. On first render, the camera SHALL center the character's current map as closely as world-edge constraints permit.

#### Scenario: The artwork and grid align pixel-perfectly

- **WHEN** the viewport is rendered
- **THEN** the world is 2295×1989px, the grid is 15×13 cells of 153×153px, and the viewport is 761×660px
- **AND** cells touch edge-to-edge with zero CSS grid gap and no world scaling.

#### Scenario: The player pans the world

- **WHEN** the player drags with a mouse or touch pointer
- **THEN** the world follows the pointer while the viewport size and cell dimensions remain fixed
- **AND** camera movement is clamped at every edge
- **AND** releasing after a drag does not activate a map.

### Requirement: The map SHALL expose clickable locations with a restrained tile overlay

Each revealed catalogued location with `isClickable = true` SHALL use a transparent 153×153px overlay with a 1px internal border in near-white light gray. The overlay SHALL use `box-sizing: border-box` or an equivalent inset treatment so its border does not change cell geometry. There SHALL be no gap between it and adjacent cells, no opaque tile fill, and no placeholder icon obscuring the artwork. Hover/focus SHALL highlight the border without changing dimensions, and actionable tiles SHALL show a pointer cursor. The frontend SHALL NOT display a level number/minimum-level legend on the tiles. All listed maps SHALL be enterable at any character level; `unlockLevel = 0` and any advisory recommended-level metadata SHALL never gate entry.

#### Scenario: A revealed grind location is selected

- **WHEN** the player activates a revealed, clickable grind map
- **THEN** the server validates ordinary character eligibility such as email verification and the existing Hungry/food gate, enters the selected map, and starts the ordinary grind queue regardless of character level
- **AND** the map tile shows no level legend.

#### Scenario: A Town location is selected

- **WHEN** the player activates a revealed Town map
- **THEN** the character transitions to that specific Town destination with `status = town` and no new battle queue
- **AND** Town destinations remain usable regardless of character level
- **AND** every Town-type location is recognized by Town NPC and Storage guards.

### Requirement: Exploration SHALL reveal a discovered map and its four cardinal neighbors

Discovery SHALL be persisted separately for each character. A newly created character SHALL start with Sierra-Village discovered. A successful arrival SHALL persist discovery of the destination only after the authoritative transition commits. The unveiled terrain SHALL include the discovered location and its north, south, east and west neighboring cells. Diagonal neighbors SHALL not be unveiled unless revealed by another discovered location. All other cells SHALL be covered by a black veil. A revealed neighbor cell with a catalogued clickable location SHALL be actionable, but shall not become discovered until the character arrives successfully. Reveal state SHALL be derived from persisted discovered IDs and canonical coordinates rather than independently stored per-cell flags.

#### Scenario: A discovered map reveals the cardinal neighborhood

- **GIVEN** a character has discovered a location at (x,y)
- **WHEN** the viewport computes the visible terrain
- **THEN** the cell at (x,y) and the cells at (x−1,y), (x+1,y), (x,y−1), and (x,y+1) are unveiled
- **AND** diagonal and more distant cells remain veiled unless another discovery reveals them.

#### Scenario: Discovery persists privately per character

- **WHEN** a character successfully visits a map and later leaves or reloads the game
- **THEN** that map remains discovered for that character only
- **AND** a rejected or still-pending transition does not discover its destination prematurely.

#### Scenario: Hidden locations cannot be entered through the client

- **WHEN** a location has not been unveiled
- **THEN** its map art/label is veiled and no interactive tile is exposed
- **AND** forged client requests remain subject to server-side map ID, destination type and ordinary character-state validation.

### Requirement: The viewport SHALL show the character's authoritative location

The viewport SHALL render `project/pinpoint.png` centered over the tile identified by the character's authoritative `currentMapId`. The pin SHALL not intercept map pointer, touch or keyboard interaction. It SHALL move only when the authoritative transition is committed; pending or rejected destinations SHALL not move the pin.

#### Scenario: The current-location pin follows committed map state

- **WHEN** the character loads or a map transition succeeds
- **THEN** the pin is centered on the matching map tile
- **AND** a failed or deferred request does not move the pin early.

### Requirement: Town and grind transitions SHALL preserve authoritative battle state

Clicking a grind map SHALL select that location for grinding without altering a battle that is already in progress. If a battle is active, the active queue entry, worker job and precomputed snapshot SHALL remain immutable; only eligible future queue entries may be invalidated and rebuilt for the requested destination at the existing safe progression boundary. A Town request made during battle SHALL retain the exact requested Town destination and finalize it only after the active battle resolves. A plain return-to-Town action SHALL target Sierra-Village (`map_town`). Town destinations SHALL never queue battles. Presence and NPC/Storage authorization SHALL use the character's actual catalogued current map and whether its type is `town`, not a hard-coded single Town ID.

#### Scenario: A map change is requested during battle

- **WHEN** the character requests another grind map or a Town destination during an active battle
- **THEN** the in-progress battle's snapshot and resolution job remain unchanged
- **AND** the requested destination takes effect only at the established safe transition boundary, with stale future encounters reconciled.

#### Scenario: Leaving a grind map for a Town destination

- **WHEN** a Town transition is finalized
- **THEN** the character is present on the specific requested Town map with Town status and no queued encounters
- **AND** the canonical Storage NPC is available on every Town-type map while Town guards continue to reject warehouse access outside Town.

### Requirement: The world rollout SHALL preserve existing character and battle history

A forward-only migration SHALL map legacy placeholder grind-map IDs to valid new grind maps deterministically using the character's saved level and the new catalogue's advisory recommendations, while preserving `map_town` as Sierra-Village. Every existing character SHALL be bootstrapped with Sierra-Village and its post-migration current map as discovered. The migration SHALL NOT rewrite active or resolved battle snapshots, event logs or historical battle records. Deployment SHALL follow the repository's stopped-consumer, read-only migration-history audit and queue/presence reconciliation safeguards.

#### Scenario: Legacy character location and discovery are migrated

- **WHEN** the guarded forward-only migration runs against an audited existing schema
- **THEN** each character points to a valid new map and starts with Sierra-Village plus its current map discovered
- **AND** active/resolved battle data remains unchanged
- **AND** migration or reconciliation failure leaves queue processing fail-closed according to the existing operational safeguards.
