# Grind Corrections

## ADDED Requirements

### Requirement: Complete item tooltip
The frontend SHALL render a consistent tooltip for every displayed item, including inventory and equipped items, using all relevant fields actually available in the current item/catalog model. It SHALL NOT invent missing values.

#### Scenario: Inventory item hover
- **WHEN** the player hovers an inventory item
- **THEN** the tooltip shows the item's available name, type, description, stats, value, stack information, effects, and other relevant catalog fields that exist for that item.

#### Scenario: Equipped item hover
- **WHEN** the player hovers an equipped item
- **THEN** the same tooltip model identifies the actual equipped item and renders its available data rather than only a raw item ID.

### Requirement: Authoritative Town return
A Town request during Grind SHALL not cancel or resolve an active battle. If no battle is active, the character SHALL return to Town immediately. If a battle is active, the request SHALL be retained until that battle resolves, after which the character SHALL return to Town without another user click.

#### Scenario: Return during encounter search
- **WHEN** the character is grinding and the current queued encounter has not started
- **THEN** the return request is handled without cancelling an unrelated battle and the character returns to Town immediately.

#### Scenario: Return during battle
- **WHEN** the character is in an active battle and clicks Town
- **THEN** the battle continues, the UI shows pending-return feedback, and the character enters Town automatically after the current battle resolves.

### Requirement: Drops this session
The Grind UI SHALL maintain a transient session-only list of drops received during the current Grind session, separate from the full inventory.

#### Scenario: New Grind session
- **WHEN** a new Grind session begins
- **THEN** Drops this session starts empty.

#### Scenario: Drop received
- **WHEN** an authoritative battle resolution grants an item drop
- **THEN** the drop appears in Drops this session and compatible quantities are visually stacked.

### Requirement: Realtime authoritative inventory state
The frontend SHALL reflect authoritative item quantity changes without requiring Grind exit or page refresh.

#### Scenario: Potion consumed
- **WHEN** the server consumes one potion during battle
- **THEN** the Character/Inventory UI shows the decremented authoritative quantity as soon as the existing realtime synchronization fact is received.

#### Scenario: Drop received
- **WHEN** the server adds a battle drop to inventory
- **THEN** the inventory reflects the new authoritative quantity/item immediately after the existing resolution synchronization.

### Requirement: Realtime Character HP/MP
The Character panel SHALL reflect authoritative current HP and MP during Grind, including damage, healing, regeneration, item effects, and post-battle values, without refresh.

#### Scenario: Battle HP update
- **WHEN** authoritative battle resolution changes current HP or MP
- **THEN** the Character panel updates to the server value without a page refresh.

#### Scenario: Regen HP update
- **WHEN** an authoritative regen tick changes HP or MP
- **THEN** the Character panel reflects the new current value immediately after synchronization.

### Requirement: Regen logs
Whenever authoritative HP or MP regeneration occurs, the existing battle/event log SHALL contain a corresponding regen event with the amount regenerated.

#### Scenario: HP regeneration log
- **WHEN** the character regenerates HP
- **THEN** the existing event feed contains a regen event with the authoritative HP amount.

#### Scenario: MP regeneration log
- **WHEN** the character regenerates MP
- **THEN** the existing event feed contains a regen event with the authoritative MP amount.

### Requirement: Critical logs
When the existing combat engine produces a critical hit, the authoritative battle log SHALL preserve that fact and the Grind UI SHALL render it using the existing event-feed/log presentation.

#### Scenario: Critical attack
- **WHEN** an existing combat calculation marks an attack as critical
- **THEN** the persisted battle log retains the critical fact and the UI displays it in the existing log format.

### Requirement: Progression and rewards
Monster rewards SHALL follow the corrected Grind progression contract: XP rate/configuration is deliberately reduced, a single XP resolution can cross multiple level thresholds when enough XP is awarded, and monsters provide no gold reward.

#### Scenario: Large XP resolution
- **WHEN** one battle resolution grants enough XP to cross multiple thresholds
- **THEN** that resolution consumes every crossed level threshold in order, allowing multiple level gains and preserving any remaining XP according to the existing representation.

#### Scenario: Monster gold
- **WHEN** a monster battle resolves successfully
- **THEN** the monster contributes zero gold regardless of any legacy goldReward configuration.

### Requirement: Starter potions
A newly created character SHALL receive exactly 50 pot_hp_small starter potions through the authoritative character-creation flow.

#### Scenario: New character inventory
- **WHEN** a new character is created
- **THEN** its authoritative inventory contains exactly 50 pot_hp_small units before any consumption.

### Requirement: Continuous regeneration
Character regeneration SHALL use a continuous authoritative 10-tick timeline independent of individual Battle instances. Battle start/end and encounter-search transitions SHALL NOT reset the regen interval.

#### Scenario: Battle ends before regen boundary
- **WHEN** regen is due every 10 ticks and a battle ends at tick 15
- **THEN** the next regen remains due at tick 20 rather than tick 25.

#### Scenario: Search period
- **WHEN** a character is alive and searching for an encounter
- **THEN** the same continuous regen timeline continues to advance.

#### Scenario: Non-battle Grind
- **WHEN** a character is alive in Grind without an active battle
- **THEN** the same timeline continues to advance and applies due regeneration.

### Requirement: William Bread sale
food_bread SHALL be sellable through the existing William Vendor transaction path using its configured vendor sell price and normal ownership/quantity validation.

#### Scenario: Sell Bread
- **WHEN** the character owns Bread in Town and sells a valid quantity to William
- **THEN** the existing Vendor transaction removes that quantity and credits the configured sell value atomically.

### Requirement: Drop-rate interpretation
Monster drop rates SHALL be interpreted using the existing deterministic RNG semantics. Before changing values, the implementation SHALL verify that configured probabilities are not being multiplied, guaranteed, or otherwise misinterpreted. Final configured rates SHALL preserve relative rarity while matching the intended slower Grind economy.

#### Scenario: Probability interpretation
- **WHEN** a monster drop entry has a configured chance
- **THEN** one deterministic roll is evaluated using the existing chance semantics and the configured probability is not silently multiplied or converted to a guaranteed drop.

#### Scenario: Relative rarity
- **WHEN** final drop values are adjusted for Grind pacing
- **THEN** rarer configured drops remain rarer than common drops according to their relative configured chances.
