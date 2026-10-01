# Grind follow-up requirements

## MODIFIED Requirements

### Requirement: Instant item hintboxes
Item displays in Inventory and equipped Character slots SHALL use an immediate custom hintbox on pointer enter and hide it on pointer leave. The hintbox SHALL show the item name and catalog fields before tier; it SHALL omit tier and every field after it. Tier 2, 3, 4, and 5 names SHALL render green, blue, purple, and gold respectively.

#### Scenario: Inventory tooltip
- **WHEN** the pointer enters an inventory item
- **THEN** the custom hintbox is visible immediately and disappears when the pointer leaves

#### Scenario: Tiered item name
- **WHEN** an item has tier 2, 3, 4, or 5
- **THEN** its displayed name uses green, blue, purple, or gold respectively

### Requirement: Town return ordering
When Town is requested during an active battle, the active battle SHALL finish normally. Future queued battles SHALL be cancelled before the request can result in another encounter. After the active battle resolves, no new battle SHALL be queued because the character is already authoritative in Town.

#### Scenario: Town during active battle
- **WHEN** the player requests Town during an active battle
- **THEN** the active battle continues, future queued battles are cancelled, and no next encounter starts

### Requirement: Realtime inventory and session drops
After each authoritative battle resolution, inventory SHALL be refreshed without waiting for the Grind session to end. Session drops SHALL accumulate from authoritative battle:resolved rewards for the current Grind session.

#### Scenario: Battle resolution updates inventory
- **WHEN** a battle resolves and grants an item drop
- **THEN** the item is visible in the inventory immediately after that battle resolves

#### Scenario: Session drops accumulate
- **WHEN** battles in the current Grind session grant drops
- **THEN** the Drops This Session view stacks those authoritative drops by item id
### Requirement: XP resolution
A single authoritative XP resolution MAY cross multiple level thresholds. Each crossed threshold SHALL be consumed in order and excess XP SHALL remain stored toward the next level. The existing reduced Grind XP rate remains the pacing mechanism.

#### Scenario: Large XP resolution
- **WHEN** one battle resolution grants enough XP to cross multiple thresholds
- **THEN** all crossed thresholds are consumed in order and the character gains all corresponding levels
### Requirement: Synchronized realtime state
Character, Inventory, and Battle HTTP loads SHALL be ordered so an older response cannot overwrite a newer authoritative realtime update.

#### Scenario: Overlapping inventory refreshes
- **WHEN** multiple inventory refreshes overlap during battle resolution
- **THEN** only the newest refresh may update the visible inventory state

#### Scenario: Battle-to-search HP state
- **WHEN** a battle resolves and the next encounter is still in search
- **THEN** the Character panel shows the resolved authoritative HP/SP rather than a stale pre-battle value
