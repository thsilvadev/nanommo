# Capability: regional-gathering-materials

## ADDED Requirements

### Requirement: Gatherable materials have exact regional allow-lists

The server-authoritative gathering pools SHALL obey these exclusive material-to-map assignments:

- Wheat: Green Grounds 0 and 3.
- Sugar: Green Grounds 4 and 5.
- Cabbage and Carrot: Green Grounds 1 and 2.
- Milk: Green Grounds 0.
- Honeycomb: Green Grounds 1 and 4 only.
- Wild Blueberries: Menace Hills 1 and 3.
- Cooking Oil: Iporá Beach 0 and 1.
- Herbs: every Kwaiouá Forest, Forest Ruins and Caetê map.
- Meat: never in a gathering pool; retain its existing independent monster-drop behavior.

#### Scenario: Only assigned maps contain an item
- GIVEN the canonical maps.json and its frontend mirror
- WHEN regional gathering data is validated
- THEN each listed gatherable item appears only on the map IDs allowed above
- AND both mirrors match
- AND every configured gathering weight is non-negative and each non-empty pool totals 100%.

#### Scenario: Honeycomb is exclusive to Green Grounds
- GIVEN any map in the world
- WHEN its gatheringPool is inspected
- THEN mat_honeycomb appears only on Green Grounds 1 and Green Grounds 4
- AND gathering on any other map cannot award Honeycomb.

#### Scenario: Multiple assigned materials use defined weights
- GIVEN Green Grounds 0, Green Grounds 1, Green Grounds 2, Green Grounds 3, Green Grounds 4 or Green Grounds 5
- WHEN a gathering reward is selected
- THEN use these initial weights: Green Grounds 0 Wheat 50% / Milk 50%; Green Grounds 1 Cabbage 40% / Carrot 40% / Honeycomb 20%; Green Grounds 2 Cabbage 50% / Carrot 50%; Green Grounds 3 Wheat 100%; Green Grounds 4 Sugar 80% / Honeycomb 20%; Green Grounds 5 Sugar 100%.

### Requirement: Maps without assigned materials can complete Gathering without an award

A Grind map whose regional allow-list is empty SHALL omit its gatheringPool rather than receive a material that is restricted to another region. Completing a Gathering cycle on such a map SHALL reset/advance the authoritative cycle without granting an item, writing a success journal event or using Warehouse as overflow.

#### Scenario: Empty pool is a valid map state
- GIVEN a canonical Grind map with no regional material assignment
- WHEN catalogue validation runs
- THEN the map may omit gatheringPool
- AND Town maps still cannot define gatheringPool
- AND any configured pool must reference known gatherable materials and sum to 100%.

#### Scenario: Collection completes on a map with no item pool
- GIVEN a character finishes a Gathering cycle on a map without gatheringPool
- WHEN the authoritative cycle advances
- THEN the cycle finishes without awarding an item and can continue into its next cycle
- AND no “You have gathered …” Journal entry is emitted
- AND no inventory or Warehouse fallback is attempted.

### Requirement: Regional availability remains server-authoritative

The frontend SHALL display collection progress only as a projection and SHALL NOT select a material or infer an award from the map name. MapService/the current authoritative gathering award path SHALL select from the canonical map pool, commit the actual inventory award before publishing a success notification, and use the canonical item/map display names.

#### Scenario: Gathering grant is committed
- GIVEN a pool contains at least one material and the inventory can accept the selected quantity
- WHEN a gathering cycle awards an item
- THEN the authoritative inventory change is committed
- AND the Journal can announce the committed item and map.

#### Scenario: Gathering grant fails
- GIVEN the inventory cannot accept the selected item or the award transaction fails
- WHEN the cycle attempts to award it
- THEN it must not claim success or emit a gathered-item Journal message
- AND it must not spill the reward to Warehouse.
