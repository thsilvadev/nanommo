# Diet Auto Feed Capability — Unique Food Streak Window

## ADDED Requirements

### Requirement: Diet is a unique three-entry food streak window

The system SHALL persist the Diet as an ordered list of at most three unique food IDs, oldest first and most recently consumed last. A food ID SHALL NOT occur more than once in the retained Diet. Digestion expiry alone SHALL NOT evict an entry. Re-consuming a retained food SHALL increment its level by one up to 3 and move it to the rightmost position without duplication. If the Diet had fewer than three entries before consumption, no unrelated entry is evicted. If the Diet was full before consumption, the oldest entry SHALL be evicted on every successful food consumption, then any remaining occurrence of the selected food SHALL be removed and the selected food appended at the right. Compute the selected food's next level before eviction. A food absent from the retained Diet starts at level 0; eviction resets the evicted food's level, and level 3 remains capped at 3.

#### Scenario: Re-consuming a retained food moves it to the right without duplication

- **GIVEN** the Diet contains Bread ★★★ and Cheese ★ in that order, and Cheese is no longer digesting
- **WHEN** the character consumes Cheese
- **THEN** the Diet contains exactly Bread ★★★ and Cheese ★★
- **AND** Cheese occupies only the rightmost slot

#### Scenario: A new food fills an available slot

- **GIVEN** the Diet contains Bread ★★★ and Cheese ★
- **WHEN** the character consumes Meat
- **THEN** the Diet contains Bread ★★★, Cheese ★, Meat in that order
- **AND** Bread and Cheese keep their existing levels

#### Scenario: A full Diet evicts the oldest item even when the selected food was in the middle

- **GIVEN** the Diet contains Bread ★★★, Cheese ★, Meat in that order, and Cheese is no longer digesting
- **WHEN** the character consumes Cheese
- **THEN** Bread is evicted, Meat remains as the oldest retained item, and Cheese is appended as Cheese ★★
- **AND** the Diet contains exactly Meat and Cheese ★★

#### Scenario: A full Diet evicts its oldest item when the newest food is consumed again

- **GIVEN** the Diet contains Bread, Cheese, Meat in that order and Meat is no longer digesting
- **WHEN** the character consumes Meat
- **THEN** Bread is evicted
- **AND** the Diet contains Cheese and Meat in that order with no duplicate Meat entry

#### Scenario: An evicted food starts a new streak when reintroduced

- **GIVEN** Bread ★★★ is no longer retained in Diet and its digestion boundary has elapsed
- **WHEN** the character consumes Bread
- **THEN** Bread enters Diet at level 0

#### Scenario: Eating the oldest food at full capacity preserves its level

- **GIVEN** the Diet contains Bread ★★★, Cheese ★, Meat in that order and Bread is no longer digesting
- **WHEN** the character consumes Bread
- **THEN** Bread's next level is computed before its old slot is evicted and remains ★★★
- **AND** the Diet contains Cheese, Meat, Bread ★★★ in that order without a duplicate

### Requirement: Food digestion lockout outlives Diet retention

The system SHALL reject consumption of a food until its latest digestion boundary has elapsed, even if that food has been evicted from the visible Diet window. Eviction SHALL reset the food's streak level but SHALL NOT delete a still-future digestion boundary. Auto Feed SHALL treat a still-digesting candidate as an ordinary skipped candidate and may continue checking other eligible foods.

#### Scenario: An evicted but still-digesting food cannot be consumed

- **GIVEN** Bread was evicted from Diet but its latest `lastDigestUntil` is in the future
- **WHEN** the character or Auto Feed attempts to consume Bread
- **THEN** consumption is rejected/skipped without decrementing Inventory
- **AND** no new Diet entry or active food buff is created for Bread

#### Scenario: Digestion lockout no longer blocks after its boundary

- **GIVEN** Bread is absent from Diet and its latest `lastDigestUntil` has elapsed
- **WHEN** the character consumes Bread
- **THEN** consumption is allowed if Inventory and food validation otherwise pass
- **AND** Bread starts a new streak at level 0

### Requirement: Legacy duplicate Diet entries are normalized without food loss

The system SHALL normalize persisted Diet state containing repeated food IDs to one entry per ID without consuming Inventory. When duplicate retained entries disagree on level, normalization SHALL preserve the highest observed retained level for that food. Recency SHALL follow each food's newest retained occurrence, and digestion lockout SHALL use a safe latest boundary. Foods absent from the normalized Diet SHALL have level 0, while still-future digestion boundaries remain effective.

#### Scenario: Duplicate retained food entries merge without losing the highest stars

- **GIVEN** legacy Diet JSON contains two Bread entries at levels 1 and 3, with different consumption timestamps
- **WHEN** the authoritative normalization runs
- **THEN** exactly one Bread entry remains at level 3
- **AND** its recency comes from the newest Bread occurrence
- **AND** Inventory quantities do not change

#### Scenario: An older expired duplicate cannot bypass a newer digestion boundary

- **GIVEN** legacy Diet JSON has multiple entries for Bread and the newest Bread occurrence is still digesting
- **WHEN** normalization and Auto Feed eligibility run
- **THEN** Bread remains ineligible until the latest safe digestion boundary
- **AND** an eligible different food may still be consumed
