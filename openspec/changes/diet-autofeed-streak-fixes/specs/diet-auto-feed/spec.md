# Diet & Auto Feed — Streak Fixes

## ADDED Requirements

### Requirement: Three-slot Diet ordering

Diet SHALL contain at most three ordered food entries. The newest food is always the final slot. An entry remains in its slot after digestion until a later food consumption shifts it out.

#### Scenario: Expired food remains marked

- GIVEN Diet is [bread] and bread digestion has finished
- WHEN the Character Panel renders
- THEN the bread entry remains in the first occupied slot
- AND it is rendered as expired/transparent
- AND it is not treated as an actively digesting food.

#### Scenario: Consumption shifts retained history

- GIVEN Diet is [bread, meat]
- AND bread has finished digesting
- WHEN the character consumes carrot
- THEN Diet becomes [bread, meat, carrot]
- AND bread remains marked until another consumption evicts it.

#### Scenario: Full Diet evicts oldest entry

- GIVEN Diet is [bread, meat, carrot]
- WHEN the character consumes fish
- THEN Diet becomes [meat, carrot, fish]
- AND bread is no longer represented by Diet.

### Requirement: Diet stars

Diet level SHALL be a streak attached to the retained Diet entry, capped at 3. It SHALL NOT be permanent history independent of the three slots.

#### Scenario: First consumption starts without stars

- GIVEN food bread is absent from the retained Diet window
- WHEN bread is consumed
- THEN bread's Diet level is 0.

#### Scenario: Repeated retained food gains a star

- GIVEN bread is retained in Diet at level 0
- AND bread has finished digesting
- WHEN bread is consumed again
- THEN the new bread entry has level 1.

#### Scenario: Streak can reach three stars

- GIVEN bread remains retained after each digestion boundary
- WHEN bread is consumed again after digestion three times
- THEN its level progresses 0 -> 1 -> 2 -> 3
- AND it never exceeds 3.

#### Scenario: Evicted food loses its streak

- GIVEN bread is retained in Diet with level 2
- AND bread is the oldest entry
- WHEN another food is consumed and bread is shifted out
- THEN bread has no Diet level record
- AND the next bread consumption starts at level 0.

### Requirement: Food digestion restriction

A food SHALL NOT be consumed while its retained Diet entry is still digesting.

#### Scenario: Same food still digesting

- GIVEN bread is retained and its digestUntil is in the future
- WHEN bread is consumed
- THEN the request is rejected
- AND Inventory and Diet remain unchanged.

#### Scenario: Same food finished digesting

- GIVEN bread is retained and its digestUntil has passed
- WHEN bread is consumed
- THEN the request is accepted if Inventory contains bread
- AND its retained streak level increases by one, capped at 3.

### Requirement: Auto Feed

Auto Feed SHALL consume food automatically at the authoritative digestion boundary when an eligible retained Diet food exists.

#### Scenario: Auto Feed replaces expired food

- GIVEN Auto Feed is enabled
- AND the active food expires before the next encounter can safely start
- AND another retained Diet food is available in Inventory and is not digesting
- WHEN the authoritative battle resolution reaches that boundary
- THEN exactly one unit of the eligible food is consumed
- AND its Diet entry becomes the newest slot
- AND the active food buff is replaced
- AND the future Grind queue is rebuilt.

#### Scenario: Auto Feed can reuse an expired retained food

- GIVEN Auto Feed is enabled
- AND a retained food has finished digesting
- AND Inventory contains that food
- WHEN the active food reaches its boundary
- THEN that food is eligible for Auto Feed
- AND its streak is incremented rather than reset.

#### Scenario: No eligible food

- GIVEN Auto Feed is enabled
- AND every retained food is either still digesting or absent from Inventory
- WHEN the active food expires
- THEN no inventory quantity changes
- AND the normal Hungry/Town rule applies.

### Requirement: Diet level persistence

dietLevels SHALL mirror only foods still represented in the three Diet slots.

#### Scenario: Evicted level disappears

- GIVEN dietLevels.bread.level = 2
- AND bread is the oldest retained Diet entry
- WHEN another food evicts bread
- THEN dietLevels.bread is absent.

#### Scenario: Reconnect preserves retained streaks

- GIVEN bread level 2 remains in the Diet slots
- WHEN the client reconnects
- THEN the authoritative Character state still reports bread level 2.

### Requirement: Character Panel expired-slot presentation

The Character Panel SHALL render all retained Diet entries, including expired entries, and SHALL visually distinguish expired entries from actively digesting entries.

#### Scenario: Expired slot is transparent

- GIVEN a Diet entry has digestUntil <= now
- WHEN the Character Panel renders
- THEN the food icon remains visible
- AND the icon is visually transparent/marked
- AND its stars remain visible.

### Requirement: No client gameplay authority

The frontend SHALL NOT decide streak resets, Diet eviction, food legality, Auto Feed eligibility or Grind continuity.

#### Scenario: Local expiry does not mutate state

- WHEN a displayed digest timer reaches zero
- THEN the frontend does not remove the Diet entry or alter its stars
- AND an authoritative server snapshot remains the source of truth.

## Acceptance

- Auto Feed consumes without manual input when the server reaches the food boundary.
- Expired foods remain marked until a subsequent food consumption shifts them out.
- A food pushed out of the three-slot window loses its streak.
- Re-consuming a retained expired food increments its retained streak.
- Re-consuming an evicted food starts at zero stars.
