## ADDED Requirements

### Requirement: Gathering awards cumulative XP on successful material grant

The server MUST award exactly 30 cumulative Gathering XP for each resource actually inserted into a Character's Inventory by a completed Gathering cycle. Item grant, XP increment, and derived Gathering Level MUST commit atomically. Cycles without an assigned pool, a selected material, or available Inventory capacity MUST NOT award Gathering XP.

Gathering Level MUST be `floor(max(0, gatheringXp) / 100) + 1`, starting at Level 1 with 0 XP. Level 2 therefore requires 100 total XP. The existing Gathering duration formula MUST continue to use the authoritative Gathering Level, reducing its base duration by one second per level above 1.

#### Scenario: Material is successfully granted

- **WHEN** a completed Gathering cycle selects a material and the material is inserted into Inventory
- **THEN** the same transaction adds exactly 30 Gathering XP and derives the level from cumulative XP

#### Scenario: XP crosses the level threshold

- **WHEN** cumulative Gathering XP reaches 100
- **THEN** Gathering Level becomes 2 and the existing duration formula uses Level 2 for the next cycle

#### Scenario: Material cannot be granted

- **WHEN** a cycle has no material pool/selection or Inventory cannot fit the selected material
- **THEN** the cycle follows its existing no-award behavior and grants no XP
