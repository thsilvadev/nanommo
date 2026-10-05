# Equipment Hand Swaps Specification

## ADDED Requirements

### Requirement: Equipping off-hand replaces an active two-handed main-hand
The server SHALL allow an off-hand equipment request when the current main-hand weapon is two-handed.

#### Scenario: Shield equipped over greatsword
- **GIVEN** a character has a Greatsword equipped in mainHand
- **AND** a Shield is available in inventory
- **WHEN** the character equips the Shield in offHand
- **THEN** the Greatsword is returned to inventory
- **AND** mainHand becomes empty
- **AND** the Shield is equipped in offHand

### Requirement: Equipping a two-handed weapon replaces off-hand equipment
The server SHALL allow a two-handed weapon equip request when an off-hand item is equipped.

#### Scenario: Greatsword equipped over shield
- **GIVEN** a character has a Shield equipped in offHand
- **AND** a Greatsword is available in inventory
- **WHEN** the character equips the Greatsword in mainHand
- **THEN** the Shield is returned to inventory
- **AND** the Greatsword is equipped in mainHand
- **AND** offHand becomes empty

### Requirement: Hand replacement works with staged Grind equipment changes
The server SHALL preserve the same resulting hand-slot state when equipment changes are staged because the character has a scheduled battle.

#### Scenario: Off-hand request stages removal of two-handed main-hand
- **GIVEN** a character is grinding with a scheduled battle
- **AND** a two-handed weapon is active in mainHand
- **WHEN** an off-hand item is equipped
- **THEN** the off-hand item is staged
- **AND** mainHand removal is staged
- **AND** when pending changes are applied, the two-handed weapon returns to inventory and mainHand is empty
