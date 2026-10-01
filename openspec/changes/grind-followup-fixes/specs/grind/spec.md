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


### Requirement: No map limbo state
A character with a current map and `grinding` status SHALL have an authoritative battle queue or an active transition that moves the character out of the map. A transient empty queue SHALL be self-healed by the queue read path.

#### Scenario: Empty queue while grinding
- **WHEN** the character is `grinding`, has a current map, and the authoritative queue is empty
- **THEN** the server rebuilds the normal encounter queue instead of leaving the character in an idle grind state

### Requirement: Idempotent Town request
A valid Town request SHALL NOT fail because future battle cleanup races with the active battle. When an active battle exists, the server SHALL persist the Town-after-battle request before attempting queue cleanup; cleanup failure SHALL NOT reject the Town request.

#### Scenario: Town request during cleanup race
- **WHEN** the player requests Town during an active battle and future queue cleanup encounters a transient failure
- **THEN** the request remains persisted, the active battle finishes, and the resolving battle transitions the character to Town


### Requirement: Town response state convergence
The map-leave response SHALL include the authoritative character status and map state. The client SHALL apply that state immediately; deferred Town requests SHALL continue checking authoritative character state until Town is reached instead of relying only on a socket event.

#### Scenario: Immediate Town response
- **WHEN** the server completes the map leave immediately
- **THEN** the client immediately renders Town from the response state and refreshes the battle queue

#### Scenario: Deferred Town response without socket delivery
- **WHEN** a Town request is deferred because a battle is active and the resolution websocket event is delayed or missed
- **THEN** the client observes authoritative Character state until `town` and then renders the Town panel


### Requirement: Food exhaustion exits Grind
When the character's active food buff expires or is absent at the end of a resolved Grind battle, the server SHALL transition the character to Town and SHALL discard unresolved Grind battles before publishing the next queue state.

#### Scenario: Food expires during battle
- **WHEN** the active battle resolves after the food buff has expired
- **THEN** the character is moved to Town, unresolved Grind encounters are discarded, and no limbo queue state is published

#### Scenario: Food already expired while queue is being rebuilt
- **WHEN** queue creation finds no active battle and no valid food buff
- **THEN** the character is moved to Town and the queue is empty
