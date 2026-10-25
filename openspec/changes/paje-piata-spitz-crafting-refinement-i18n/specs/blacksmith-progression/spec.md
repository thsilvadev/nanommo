## ADDED Requirements

### Requirement: Blacksmith recipes unlock by profession level
Blacksmith SHALL have persisted level and cumulative XP, a server-owned crafting session and data-driven recipes in blacksmith_recipes.json. Recipe unlocks SHALL be: Level 1 Bronze Ingot (10 Bronze Ore → 1 ingot); Level 2 physical and magic T2 headgear (2 Bronze Ingots per item); Level 3 physical and magic T2 capes (3 ingots); Level 4 physical and magic T2 body armor (4 ingots); Level 5 neutral T1 Traveler's Boots (5 ingots); Level 7 every catalogue T2 weapon, shield and rune (7 ingots). Initial recipe XP values are editable placeholders of 5 XP per craft.

#### Scenario: Bronze Ore gathering and smelting
- **WHEN** a Character gathers Bronze Ore in Wastelands 1, Wastelands 0 or Menace Hills 2 and starts the Level 1 recipe with 10 ore
- **THEN** the session reserves the ingredients/output capacity and completes one Bronze Ingot through the standard crafting transaction

#### Scenario: Profession level unlocks recipe group
- **WHEN** authoritative Blacksmith level reaches an approved unlock level
- **THEN** the corresponding recipes become craftable and future recipes remain visibly locked according to existing profession UI patterns

#### Scenario: Crafted equipment receives its configured random attribute
- **WHEN** a Blacksmith recipe produces equipment whose definition has enabled randomRollOnCraft
- **THEN** the server chooses one attribute from attributesPool and rolls an inclusive value from min through max
- **AND** stores the result on the new item instance and applies it through authoritative equipment/Character derived stats
- **AND** drop-only stat rolls are not also applied to the crafted item

#### Scenario: Craft session is cancelled or recovered
- **WHEN** a session is cancelled before its authoritative deadline, or the client reloads while a session is active
- **THEN** cancellation releases reservations without consuming ingredients/XP/output
- **AND** reload recovery follows the same idempotent contract as Cooking

### Requirement: Equipment drop rolls support configured stat pools
Equipment drop resolution SHALL support randomRollOnDrop.statsPool and per-stat rolls as authored in items.json, alongside the existing attributesPool roll format. A dropped item SHALL persist the selected stat and rolled value on its own item instance. The selected stat SHALL contribute to authoritative Character/equipment stats, battle snapshots and UI consistently and SHALL be eligible for the corresponding high-refinement increments.

#### Scenario: Drop receives a random stat
- **WHEN** an equipment drop's randomRollOnDrop contains enabled statsPool and configured values for candidate stats
- **THEN** one configured stat is selected and its value is rolled within that stat's inclusive range
- **AND** the result is stored on that drop instance without mutating the shared catalogue definition

#### Scenario: Item has both drop and craft roll definitions
- **WHEN** the same catalogue item is obtainable from drops and craft
- **THEN** a drop uses only randomRollOnDrop and a craft uses only randomRollOnCraft
- **AND** a roll is not duplicated after equipping, unequipping, reloading or refreshing derived stats
