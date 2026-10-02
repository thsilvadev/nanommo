# Diet & Auto Feed

## ADDED Requirements

### Requirement: Character Diet state
Character gameplay state SHALL include an ordered Diet of zero to three food entries, a persistent per-food Diet level map capped at 3, and an authoritative Auto Feed boolean.

#### Scenario: Fresh character Diet
- WHEN a character has never consumed food through the Diet
- THEN Diet is empty
- AND every food Diet level is 0 when first encountered
- AND Auto Feed is false by default.

### Requirement: Three-slot Diet ordering
Diet SHALL display at most three food entries in consumption order, with the newest food in the final slot.

#### Scenario: First food
- WHEN the character consumes food x
- THEN Diet changes from [empty, empty, empty] to [empty, empty, x].

#### Scenario: Second and third foods
- WHEN the character consumes y after x
- THEN Diet becomes [empty, x, y]
- WHEN the character then consumes z
- THEN Diet becomes [x, y, z].

#### Scenario: Full Diet replacement
- GIVEN Diet is [x, y, z]
- WHEN the character consumes a new food a
- THEN Diet becomes [y, z, a].
### Requirement: Food digestion restriction
A food SHALL NOT be consumed again while its previous Diet entry is still digesting. The backend SHALL be authoritative for this validation.

#### Scenario: Same food still digesting
- GIVEN food x has a Diet entry whose digestion has not finished
- WHEN the character attempts to consume x
- THEN the request is rejected
- AND Inventory is unchanged
- AND Diet is unchanged.

#### Scenario: Same food finished digesting
- GIVEN the previous Diet entry for x has finished digesting
- WHEN the character consumes x
- THEN the request is accepted if x exists in Inventory
- AND x's Diet level increases by one, capped at 3.

### Requirement: Diet stars
Each food SHALL have a persistent Diet level from 0 through 3, rendered as zero through three stars. The first successful consumption does not itself award a star.

#### Scenario: Repeated food mastery
- GIVEN x has never been consumed
- WHEN x is consumed successfully
- THEN x remains at level 0
- WHEN a later x is consumed after the previous x finished digesting
- THEN x becomes level 1
- AND subsequent completed-digestion repeats increase it to levels 2 and 3
- AND no consumption increases it beyond level 3.

### Requirement: Authoritative food consumption
Manual and Auto Feed consumption SHALL use the same server-authoritative food rules and existing InventoryItem persistence.

#### Scenario: Manual food use
- GIVEN a food exists in Inventory and is legally consumable
- WHEN the player manually uses it outside battle
- THEN exactly one unit is removed
- AND Diet is updated
- AND activeFoodBuff is replaced with the new food effect and expiry.

#### Scenario: No inventory food
- GIVEN a food is configured in Diet history but its Inventory quantity is zero
- WHEN Auto Feed needs food
- THEN no food is consumed
- AND Inventory does not become negative.
### Requirement: Auto Feed toggle
Auto Feed SHALL be an authoritative Character setting exposed by the Character Panel next to Diet.

#### Scenario: Enable Auto Feed
- WHEN the player enables Auto Feed
- THEN the server persists autoFeed=true
- AND the frontend reflects the authoritative value.

#### Scenario: Disable Auto Feed
- WHEN the player disables Auto Feed
- THEN the server persists autoFeed=false
- AND future digestion boundaries do not trigger automatic consumption.

### Requirement: Auto Feed eligibility
Auto Feed SHALL only consume a food that is represented in the character's Diet configuration/history, is legal under digestion rules, and has positive Inventory quantity.

#### Scenario: Eligible food available
- GIVEN Auto Feed is enabled and an eligible Diet food x exists in Inventory
- WHEN the active food digestion reaches its authoritative boundary
- THEN the server consumes x before allowing grind continuity to fail because of Hungry.

#### Scenario: Eligible food unavailable
- GIVEN Auto Feed is enabled but every configured/identified Diet food has zero Inventory quantity
- WHEN the active food expires
- THEN no fake consumption occurs
- AND the normal Hungry/Town rule applies.

### Requirement: Grind continuity at digestion boundary
Auto Feed SHALL prevent a character from entering Hungry between grind battles when an eligible food exists. This rule SHALL be enforced by the server during battle resolution, queue advancement or crash recovery, not by frontend timers.

#### Scenario: Food expires near battle boundary
- GIVEN a character is grinding with Auto Feed enabled
- AND the active food would expire before the next battle can safely begin
- AND another eligible food exists in Inventory
- WHEN the current battle resolves or the queue advances
- THEN the server consumes the eligible food before ending the grind chain for Hungry
- AND the future queue is rebuilt from the new authoritative Character and Inventory state.
### Requirement: Manual food remains available
Food SHALL remain a generic consumable usable through the existing use_item action. Auto Feed SHALL NOT be implemented as a Gambit substitute.

#### Scenario: Food generic action
- GIVEN a food item exists in Inventory
- WHEN a valid generic use_item action targets that food in a legal battle context
- THEN the food remains available to the generic item-action path
- AND no self_hungry condition is required.

### Requirement: Remove self_hungry Gambit condition
The self_hungry condition SHALL be removed from the authoritative Gambit condition enum/catalog, backend validation, frontend catalog representation, starter presets and related tests/spec references.

#### Scenario: Catalog no longer exposes condition
- WHEN the Gambit catalog is loaded
- THEN self_hungry is absent
- AND food use_item remains present.

### Requirement: Diet realtime authority
Diet, Diet levels, Auto Feed and activeFoodBuff SHALL be part of the authoritative Character state used by realtime synchronization.

#### Scenario: Resolution snapshot
- WHEN a battle resolves and food/Diet/Inventory state changes
- THEN battle:resolved carries a complete Character + Inventory snapshot including Diet and Auto Feed
- AND the state revision corresponds to that complete state.

#### Scenario: Queue update arrives first
- GIVEN battle:queueUpdated and battle:resolved can arrive in either order
- WHEN queueUpdated carries the authoritative post-resolution snapshot
- THEN Character, Diet, Auto Feed and Inventory converge to that snapshot
- AND a later older resolved snapshot cannot overwrite it.
### Requirement: Reconnect consistency
A reconnect or authoritative reload SHALL restore Diet, Diet levels, Auto Feed, activeFoodBuff, Character resources and Inventory from server state without relying on client timers or cached Diet mutations.

#### Scenario: Reload after food consumption
- GIVEN food was consumed and persisted before disconnect
- WHEN the client reconnects
- THEN the server state contains the same Diet and Inventory state
- AND the frontend renders that state.

### Requirement: Persistence migration
Existing characters SHALL remain valid after the Diet schema is introduced. Null/missing Diet fields SHALL normalize to empty Diet, empty Diet levels and Auto Feed disabled unless authoritative legacy food state can be reconciled.

#### Scenario: Existing active food buff
- GIVEN a legacy character has activeFoodBuff but no Diet fields
- WHEN authoritative character state is loaded or migrated
- THEN the active food remains valid
- AND the Diet state is reconciled without inventing an Inventory item.

### Requirement: Character Panel Diet UI
The Character Panel SHALL render Diet below Equipment with exactly three food slots. Empty slots SHALL show the food placeholder/icon background. The newest food occupies the final slot.

#### Scenario: Diet presentation
- WHEN the Character Panel renders
- THEN Equipment is followed by Diet
- AND exactly three Diet slots are visible
- AND each occupied slot shows its food item and authoritative stars
- AND empty slots use the existing food placeholder visual.

### Requirement: Existing tooltip system
Diet item hover SHALL reuse the existing item tooltip implementation and SHALL NOT create a parallel tooltip system.

#### Scenario: Food tooltip
- WHEN the player hovers an occupied Diet slot
- THEN the existing item tooltip displays the food information and Diet level/stars where applicable.
### Requirement: Auto Feed UI
The Auto Feed label and switch SHALL appear next to the Diet slots and SHALL reflect the authoritative server value.

#### Scenario: Server state wins
- GIVEN the local switch differs from the server value
- WHEN an authoritative Character snapshot is accepted
- THEN the switch displays the server value.

### Requirement: No client gameplay authority
The frontend SHALL NOT decide when digestion ends, whether a food is legal, whether Auto Feed can consume an item, or whether grind should continue.

#### Scenario: No timer authority
- WHEN the browser's local clock crosses a displayed food expiry
- THEN the client does not mutate Diet, Inventory, activeFoodBuff or Character status by itself
- AND only authoritative server state changes those values.

### Requirement: Inventory consistency
Every successful food consumption SHALL decrement exactly one Inventory unit and SHALL never produce a negative quantity. Character and Inventory state used by the grind loop SHALL correspond to the same authoritative mutation.

#### Scenario: Quantity consistency
- GIVEN one unit of food x exists
- WHEN x is consumed
- THEN Inventory quantity becomes zero
- AND no later stale snapshot restores the consumed unit.

### Requirement: Battle projection remains presentation-only
Active battle log projection SHALL remain UI presentation. Diet, activeFoodBuff and Inventory authority SHALL come from persisted/realtime server state.

#### Scenario: Searching after resolution
- WHEN a battle has resolved and the next encounter is searching
- THEN the Character Panel renders the latest authoritative Diet/food/Inventory state
- AND it does not derive a newer Diet state from a stale battle log.

### Requirement: No unrelated progression
This change SHALL NOT add weapon XP/progression or unrelated game systems.

#### Scenario: Scope boundary
- WHEN the change is reviewed
- THEN weapon XP/progression remains outside its implementation and acceptance.

### Requirement: Uniform digestion duration
Every food SHALL share one digestion duration. Because a food consumed later always receives a later digestion boundary under a uniform duration, the most recent entry SHALL always carry the latest boundary, and no state may be observable in which the character is Hungry while an earlier entry is still digesting.

#### Scenario: One duration for every food
- WHEN two different foods are consumed at different times
- THEN the later consumption carries the later digestion boundary.

#### Scenario: Hunger implies no digestion remains
- WHEN the active food buff has expired
- THEN every Diet entry has also finished digesting
- AND the character is not shown as both Hungry and still digesting a food.

### Requirement: Food state mirrors the Diet slots
The grind panel food state SHALL be derived from the count of currently digesting Diet entries, so it always matches what the Character Panel slots render: zero entries SHALL read HUNGRY, one FED, two SATISFIED and three FULL. Diet entries past their digestion boundary SHALL be treated as unoccupied everywhere the client renders them, including the slots.

#### Scenario: State matches slot count
- GIVEN the character has two foods still digesting
- WHEN the grind panel renders
- THEN the food state reads SATISFIED
- AND exactly two Diet slots are occupied.

#### Scenario: Expired entries read as empty
- GIVEN the character's only remaining Diet entry has finished digesting
- WHEN the grind panel renders
- THEN the food state reads HUNGRY
- AND every Diet slot shows the empty-slot placeholder.

#### Scenario: Boundary refresh is server-derived
- WHEN a digestion boundary the server reported passes
- THEN the client re-reads authoritative state rather than deciding locally that the entry expired
- AND no local state is mutated by that boundary passing.
