# Spec Delta

## Purpose

Define passive collection while stationary, authoritative Gathering-cycle timing and map-specific weighted materials without adding crafting/cooking/alchemy execution.

## ADDED Requirements

### Requirement: Gathering gauge runs in stationary Hunting and Gathering

A stationary character on a grind map MUST accrue the orange Gathering gauge in both Hunting and Gathering. It MUST pause during battle and Traveling. The growing search/progress bar MUST be removed, but the text-only “Searching for Monsters...” state MUST remain during future encounter search; encounter search continues server-side in parallel with collection between battles.

#### Scenario: Hunting collects during search
- **WHEN** a Hunting character is stationary on a grind map and not fighting
- **THEN** the Gathering gauge accrues during encounter-search time
- **AND** it pauses only for battle or Traveling

### Requirement: Gathering duration uses map length, population, level and cycle variance

Unvaried base duration in seconds MUST be max(30, 12 × mapLength + 30 × (playersOnMap − 1) − (gatheringLevel − 1)). Each cycle MUST add one deterministic inclusive random integer from 0 through 5 seconds, sampled once. gatheringLevel defaults to 1 and has no progression system in this change. Population changes recalculate the gauge rate while preserving progress and the current cycle variance.

#### Scenario: Baseline map
- **WHEN** mapLength is 25, playersOnMap is 1 and gatheringLevel is 1
- **THEN** base duration is 300 seconds plus 0–5 seconds variance

#### Scenario: Longer map
- **WHEN** mapLength is 50, playersOnMap is 1 and gatheringLevel is 1
- **THEN** base duration is 600 seconds plus 0–5 seconds variance

#### Scenario: Population changes during a cycle
- **WHEN** a persisted resident enters or leaves the map
- **THEN** the remaining gauge rate uses the new population
- **AND** progress and cycle variance are preserved

### Requirement: Gathering rewards use map-owned weighted material pools

Every current grind map MUST define a non-empty gathering pool whose probabilities total exactly 100%. Town maps MUST have no pool. The initial world distribution MUST include all nine gatherable material IDs across the 36 grind maps; Meat is excluded from all gathering pools and remains a monster drop. At completion, the server MUST make a deterministic weighted pick and grant through normal InventoryService capacity rules.

#### Scenario: Inventory has room
- **WHEN** a collection cycle completes and a material is selected
- **THEN** the item is granted and the next cycle begins

#### Scenario: Inventory is full
- **WHEN** the selected material cannot fit in Inventory
- **THEN** it is not granted and the cycle restarts
- **AND** it is not redirected to Warehouse, mail or hidden overflow

#### Scenario: Journey is cancelled before departure
- **WHEN** travel is cancelled before leaving the source map
- **THEN** that map’s partial Gathering progress is retained
- **AND** a committed arrival on a different map starts fresh progress for its own pool

### Requirement: Cooking ingredients are data only

New ingredients MUST use type material with stable IDs, catalogue entries, icons and frontend/category support. food_blueberry retains ID/effect but is displayed as Blueberry Jelly; create separate Wild Blueberries material. food_honey retains ID/effect but is displayed as Honey. Ingredients MUST support future Bread (Wheat + Cooking Oil), Cheese (Milk), Blueberry Jelly (Wild Blueberries + Sugar), Hunter’s Stew (Carrot + Cabbage + Meat), Herbal Tea (Herbs) and Honey (Honeycomb) concepts. No recipes or crafting/cooking/alchemy execution is added. Meat is a material drop only from Dire Wolf and Needleback Stalker and MUST never appear in a gathering pool.

#### Scenario: Validate materials and pools
- **WHEN** the catalog validator checks material data
- **THEN** every referenced item has type material and a shipped icon
- **AND** root/frontend mirrors agree and each pool totals 100
- **AND** Meat appears only in the two approved monster drop tables, never in gathering pools
