# Character Stats, Consumables and Grind

## ADDED Requirements

### Requirement: Authoritative derived stats
The engine SHALL calculate character derived stats from the six attributes and authoritative equipment contributions using the NanoMMO formulas defined in SPEC.md.

#### Scenario: Fresh character derived stats
- **GIVEN** a level 1 character with STR/AGI/VIT/INT/DEX/SOR all equal to 5
- **AND** the starter sword contributes 8 ATK
- **WHEN** derived stats are calculated
- **THEN** ATK is 18, Max HP is 140, Max SP is 60, Attack Speed is 110, Cast Speed is 110, Evasion is 7, Accuracy is 60, HP regen is 3 per 10 ticks, SP regen is 3 per 10 ticks, and Critical is 2.5%

### Requirement: Initial current resources
A newly created character SHALL start with current HP and SP equal to their authoritative derived maxima.

#### Scenario: Fresh character resource state
- **GIVEN** the character is created successfully
- **WHEN** creation finishes
- **THEN** hpCurrent equals maxHp and spCurrent equals maxSp

### Requirement: Starter consumables
A newly created character SHALL receive exactly 10 Small HP Potions and 5 Bread once as the starter pack.

#### Scenario: Starter inventory
- **GIVEN** a new character is created
- **WHEN** the starter loadout is persisted
- **THEN** inventory contains 10 pot_hp_small and 5 food_bread

### Requirement: Food buff and hunger
Food SHALL grant its configured regeneration bonus for one real-world hour, replace any previous food buff, and an expired or missing food buff SHALL make the character hungry.

#### Scenario: Bread activation
- **GIVEN** a character uses food_bread outside battle
- **WHEN** the use succeeds
- **THEN** activeFoodBuff stores the Bread regeneration values and an expiresAt exactly one hour in the future

#### Scenario: Food replacement
- **GIVEN** a character already has an active food buff
- **WHEN** another food is used
- **THEN** the previous food buff is replaced rather than stacked

### Requirement: Grind entry requirements
A character SHALL only enter a grind map when level-eligible, armed, carrying at least one HP potion, and not hungry.

#### Scenario: Missing potion
- **GIVEN** the character has no HP potion
- **WHEN** entering a grind map is requested
- **THEN** the server rejects the request

#### Scenario: Hungry character
- **GIVEN** the character has no active non-expired food buff
- **WHEN** entering a grind map is requested
- **THEN** the server rejects the request

### Requirement: Equipment movement
Equipment SHALL move between inventory and equipment slots through authoritative server operations; main-hand unequip SHALL only be allowed in town.

#### Scenario: Unequip in town
- **GIVEN** an equipped item and a character in town
- **WHEN** the item is dragged to an inventory slot
- **THEN** the server moves the item to inventory and clears the equipment slot

#### Scenario: Unequip weapon while grinding
- **GIVEN** a character is grinding
- **WHEN** the required main-hand weapon is unequipped
- **THEN** the server rejects the operation
