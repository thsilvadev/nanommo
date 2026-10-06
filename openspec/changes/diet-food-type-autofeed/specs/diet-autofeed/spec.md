## ADDED Requirements

### Requirement: Food has a dedicated item type

Every item whose `effect.type` is `food_buff` SHALL have `type: food`. Food SHALL NOT be classified as `consumable`.

#### Scenario: Catalog food type
- GIVEN Bread or another Diet food has `effect.type = food_buff`
- WHEN its item definition is loaded
- THEN its type is `food`

### Requirement: Food has only manual and Auto Feed consumption paths

Food SHALL be consumable manually outside battle through the existing authoritative inventory action, or automatically by Auto Feed during authoritative Grind battle resolution. Food SHALL NOT be consumable by a battle Gambit.

#### Scenario: Manual food use
- GIVEN a `food` item exists in Inventory and is not still digesting
- WHEN the player uses it outside battle
- THEN exactly one unit is consumed through the existing transactional food path
- AND Diet, Diet level, digestion and active food state are updated exactly as before

#### Scenario: Food is rejected by Gambit
- GIVEN a Gambit line uses `use_item` with a `food` item
- WHEN the shared BattleEngine evaluates that line
- THEN the line is illegal and skipped
- AND the food is not consumed during the battle

#### Scenario: Consumable remains valid for Gambit
- GIVEN a normal `consumable` item exists in Inventory and is otherwise legal
- WHEN a Gambit line uses `use_item` with that item
- THEN the line remains eligible under the existing Gambit rules

### Requirement: Auto Feed is the Grind continuity mechanism

When Auto Feed is enabled and the character is continuing Grind, battle resolution SHALL evaluate Auto Feed before routing the character to Hungry/Town because the current food cannot cover the next encounter boundary.

#### Scenario: Eligible food at battle end
- GIVEN Auto Feed is enabled
- AND the character is grinding
- AND the active food expires at or before the next encounter boundary
- AND one or more configured Diet foods are available in Inventory and are not still digesting
- WHEN the battle resolves
- THEN the server consumes every currently eligible Diet food, up to the three Diet slots, through the authoritative `consumeFood()` path
- AND the same food is not consumed again while its newly-created digestion is active
- AND the unresolved future queue is discarded and rebuilt once from the new authoritative state
- AND the character remains in Grind

#### Scenario: No eligible food
- GIVEN Auto Feed is enabled
- AND the active food cannot cover the next encounter boundary
- AND no configured Diet food is eligible and available
- WHEN the battle resolves
- THEN no food is consumed
- AND the existing Hungry/Town fallback remains authoritative

#### Scenario: Grind entry does not trigger Auto Feed
- GIVEN Auto Feed is enabled
- WHEN the character enters Grind
- THEN no separate Auto Feed consumption is performed merely because Grind was entered
- AND the normal battle-resolution continuity boundary remains the trigger
