# Cooking Progression

## ADDED Requirements

### Requirement: Server-authoritative recipe catalogue and progression
The system SHALL define Cooking recipes in a canonical validated catalogue. Each recipe SHALL declare a stable recipe ID, output food item ID, Cooking level requirement, positive ingredient quantities, and XP reward. Character Cooking XP and level SHALL persist on the server; the client SHALL display server-provided progress and SHALL NOT calculate or award XP.

#### Scenario: Recipe availability and requirements
- **WHEN** a Character opens Uncle Phillip's Cooking modal
- **THEN** the API returns authoritative recipe definitions, current Cooking level/XP progress, ingredient counts, unlock state, and any active session
- **AND** the modal displays Cooking level and XP progress as current-level XP / XP required for the next level
- **AND** recipes are ordered by required level with deterministic order for recipes at the same level

### Requirement: Initial recipes and XP curve
The initial recipe catalogue SHALL contain: Bread (level 1; 5 Wheat; 5 XP), Blueberry Jelly (level 1; 5 Wild Blueberries; 5 XP), Cheese (level 2; 10 Milk; 18 XP; outputs Aged Cheese), Herbtea (level 2; 10 Herbs; 18 XP; outputs Herbal Tea), Honey (level 5; 15 Honeycomb; 20 XP), Hunter's Stew (level 6; 8 Herbs, 6 Carrots, 4 Meat; 25 XP), and Roasted Barbecue (level 7; 10 Meat, 10 Carrots; 30 XP; preserves `food_roast` ID/effect).

The initial cumulative XP thresholds SHALL be level 1: 0, level 2: 100, level 3: 220, level 4: 390, level 5: 640, level 6: 1640, level 7: 4140, and level 8: 7890. For subsequent levels, the next level's incremental requirement SHALL be `floor(previous incremental requirement × 1.5)`. XP remains cumulative and carries over across multiple thresholds. Level-up SHALL immediately re-evaluate recipe unlocks.

#### Scenario: Targeted progression pacing
- **WHEN** the Character completes 20 level-1 recipes (5 XP each) and 30 level-2 recipes (18 XP each)
- **THEN** total XP reaches 640 and Cooking level reaches 5
- **WHEN** the Character then completes 50 Honey recipes
- **THEN** Cooking level reaches 6
- **WHEN** the Character then completes 100 Hunter's Stew recipes
- **THEN** Cooking level reaches 7

### Requirement: Atomic successful cooking
A cooking session SHALL last exactly 10 seconds according to server timestamps. At the deadline, one idempotent server transaction SHALL validate the session and reservation, remove required ingredients, grant exactly one output food, award recipe XP, update level, clear the session, and reserve/release inventory capacity consistently. A failed validation SHALL NOT partially consume ingredients, grant output, or award XP.

#### Scenario: Successful completion
- **WHEN** an active valid session reaches its server deadline
- **THEN** ingredients, food output, Cooking XP/level, active session, and corresponding authoritative inventory/Character state commit atomically exactly once

#### Scenario: Duplicate or stale completion
- **WHEN** a completion job is retried, duplicated, or belongs to an older session generation
- **THEN** it SHALL NOT grant extra food/XP or consume ingredients again

### Requirement: Persistent session, ingredient reservations, and cancellation
Starting Cooking SHALL reserve the recipe's required ingredient quantities and output capacity without consuming the ingredients yet. Reserved quantities/capacity SHALL remain unavailable to conflicting inventory transactions until completion or cancellation. Exactly one session may be active per Character. Only an explicit `Cancel` action SHALL interrupt an accepted session; closing the modal, navigating away from it, or refreshing the page SHALL NOT cancel it. Cancellation before completion SHALL clear the session and release reservations without consuming ingredients or awarding food/XP. The session SHALL be recovered after process restart through persisted deadline plus idempotent delayed-job/reconciliation logic.

#### Scenario: Modal closes or page reloads
- **WHEN** the modal closes or the browser reloads during Cooking
- **THEN** the server session continues and reopening the modal shows its actual remaining time and Cancel action

#### Scenario: Cancel before deadline
- **WHEN** the Character cancels before the server deadline
- **THEN** the session is cancelled and all reservations are released with no ingredients consumed, food granted, or XP awarded

#### Scenario: Cancel/completion race
- **WHEN** Cancel and completion race at the deadline
- **THEN** the server serializes them so exactly one terminal result wins and no partial/double transaction occurs

### Requirement: Inventory capacity and future battle queue consistency
Cooking SHALL guarantee output capacity when a session starts and protect that reservation from conflicting inventory grants until completion/cancellation. Inventory operations that would spend/move reserved ingredients or occupy reserved capacity SHALL reject or account for the reservation. Successful completion SHALL use the existing future-combat mutation boundary so unstarted battle snapshots reflect the new food while any already-started battle remains immutable.

#### Scenario: Insufficient inventory capacity
- **WHEN** no output stack/slot can be reserved for the recipe's food
- **THEN** the server rejects starting Cooking without reserving ingredients or starting the timer

#### Scenario: Food added while a future battle queue exists
- **WHEN** Cooking completes while future battles are queued
- **THEN** the next eligible queue is rebuilt using the new authoritative inventory, without rewriting a battle already in progress
