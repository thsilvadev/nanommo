# Spec Delta

## MODIFIED Requirements

### Requirement: Diet stars
Each food SHALL have a persistent Diet level from 0 through 3, rendered as zero through three stars. The first successful consumption does not itself award a star. A food's Diet level SHALL also increase the regeneration that the food grants, so that a mastered food grants strictly more than the same food at level 0.

#### Scenario: Repeated food mastery
- GIVEN x has never been consumed
- WHEN x is consumed successfully
- THEN x remains at level 0
- WHEN a later x is consumed after the previous x finished digesting
- THEN x becomes level 1
- AND subsequent completed-digestion repeats increase it to levels 2 and 3
- AND no consumption increases it beyond level 3.

#### Scenario: Stars are mastery, not just decoration
- GIVEN x is at level 3
- WHEN x is consumed
- THEN the food buff for x grants strictly more regeneration than the same food would grant at level 0
- AND the rendered slot shows three stars.

### Requirement: Existing tooltip system
Diet item hover SHALL reuse the existing item tooltip implementation and SHALL NOT create a parallel tooltip system. Hovering an occupied Diet slot SHALL reveal that tooltip. The tooltip SHALL report the food's name and the effective regeneration the food currently grants, inclusive of its Diet level bonus, rather than the food's unmodified catalog values.

#### Scenario: Food tooltip
- WHEN the player hovers an occupied Diet slot
- THEN the existing item tooltip appears for that slot
- AND it displays the food's name
- AND it displays the food's Diet level as stars.

#### Scenario: Tooltip reports the level-scaled bonus
- GIVEN food x is at level 2 and grants 8 HP regeneration and 1 SP regeneration per 10 ticks
- WHEN the player hovers x in the Diet
- THEN the tooltip reports 10 HP regeneration per 10 ticks
- AND the tooltip reports 3 SP regeneration per 10 ticks.

#### Scenario: Unmastered food reports catalog values
- GIVEN food x is at level 0
- WHEN the player hovers x in the Diet
- THEN the tooltip reports x's catalog regeneration values unchanged.

## ADDED Requirements

### Requirement: Diet level stat bonus
A food's Diet level SHALL add a flat +1 to every regeneration statistic that the food grants, per level. A food at level 0 SHALL grant exactly its catalog values. A food at level 3 SHALL grant its catalog values plus 3 for each granted statistic. The bonus SHALL apply to each regeneration statistic a food grants independently, and a food granting both HP and SP regeneration SHALL receive the bonus on both.

#### Scenario: Flat bonus per level
- GIVEN food x grants 4 HP regeneration and 1 SP regeneration per 10 ticks
- WHEN x is consumed at Diet level 0
- THEN the food buff grants 4 HP regeneration and 1 SP regeneration per 10 ticks.

#### Scenario: One star adds one per granted stat
- GIVEN food x grants 4 HP regeneration and 1 SP regeneration per 10 ticks
- WHEN x is consumed at Diet level 1
- THEN the food buff grants 5 HP regeneration and 2 SP regeneration per 10 ticks.

#### Scenario: Three stars add three per granted stat
- GIVEN food x grants 4 HP regeneration and 1 SP regeneration per 10 ticks
- WHEN x is consumed at Diet level 3
- THEN the food buff grants 7 HP regeneration and 4 SP regeneration per 10 ticks.

#### Scenario: Bonus is capped by the star cap
- GIVEN food x is at level 3
- WHEN x is consumed again after its previous digestion finished
- THEN x remains at level 3
- AND the food buff still grants catalog values plus 3 per granted stat.

#### Scenario: Bonus is derived from the level the consumption awards
- GIVEN x has never been consumed
- WHEN x is consumed successfully for the first time
- THEN the food buff uses level 0
- AND the Diet entry for x records level 0.

### Requirement: Effective food value is consistent everywhere
The effective regeneration for a food SHALL be computed identically wherever a food buff is resolved, so that a food consumed manually, consumed by Auto Feed, consumed by the battle simulation, and reconstructed at battle resolution all grant the same value for the same Diet level. The simulation the server runs before a battle SHALL NOT assume a different effective food value than the one applied when that battle resolves.

#### Scenario: Manual use and Auto Feed agree
- GIVEN food x is at level 2
- WHEN x is consumed manually and, on a separate occasion, x is consumed by Auto Feed
- THEN both food buffs grant the same effective regeneration.

#### Scenario: Simulation and resolution agree
- GIVEN food x is at level 2 and is used during a battle
- WHEN the battle is simulated and then resolved
- THEN the regeneration applied during simulation equals the regeneration recorded as active after resolution.

#### Scenario: Resolution does not drift from consumption
- GIVEN food x was consumed at Diet level 1
- WHEN a later battle resolves and reconstructs x's active buff
- THEN the reconstructed buff grants the value x was consumed with.

### Requirement: Bonus is server-authoritative
The effective food value SHALL be determined by server state alone. The client SHALL NOT compute, adjust or persist a Diet level bonus.

#### Scenario: No client-side bonus
- WHEN the frontend renders a Diet slot
- THEN the regeneration shown comes from authoritative item and Diet state
- AND the client does not apply its own bonus to that value.