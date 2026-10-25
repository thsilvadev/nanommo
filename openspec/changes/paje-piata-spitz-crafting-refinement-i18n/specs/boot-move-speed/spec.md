## ADDED Requirements

### Requirement: Shoe tiers grant configured Move Speed and have aligned tier data
Equipment definitions and all authoritative derived-stat paths SHALL support boot Move Speed. A neutral T1 Traveler's Boots item SHALL have +1 DEF, +10 Move Speed and no elemental immunity. Boot Move Speed SHALL be T1 +10, T2 +15, T3 +30 and T4 +45.

#### Scenario: Neutral T1 boot
- **WHEN** a Character equips Traveler's Boots
- **THEN** the Character gains +1 DEF and +10 Move Speed
- **AND** no elemental immunity is added

#### Scenario: Existing elemental boots shift tiers
- **WHEN** the boot catalogue is updated
- **THEN** existing Earth/Water T1 boots become T2, Fire/Shadow T2 become T3, and Wind/Holy T3 become T4
- **AND** item IDs, level requirements, drop pools and all references are updated consistently
- **AND** no item-instance migration is required because no existing boot inventory instances are present in the database

#### Scenario: Speed contributes to authoritative calculations
- **WHEN** a Character equips any T1–T4 boots
- **THEN** the appropriate flat Move Speed bonus is present in Character derived stats, combat snapshots and world-travel speed calculations
