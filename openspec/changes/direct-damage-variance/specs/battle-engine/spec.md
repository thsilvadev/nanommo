# Battle Engine

## ADDED Requirements

### Requirement: Direct damage has small seeded variance

The battle engine SHALL apply a uniform damage multiplier in the design range of -1% to +1% (0.99 to 1.01) to every successful direct attack or damaging skill from either a character or monster.

#### Scenario: Character basic attack varies final damage
- **WHEN** a character basic attack lands
- **THEN** the engine SHALL apply one seeded variance roll to the final damage after hit/crit, mitigation and damage multipliers and before integer rounding/minimum-damage handling.

#### Scenario: Character damaging skill varies final damage
- **WHEN** a character damaging skill lands
- **THEN** the engine SHALL apply the same direct-damage variance rule exactly once for that damage event.

#### Scenario: Monster direct damage varies final damage
- **WHEN** a monster basic attack or damaging skill lands
- **THEN** the engine SHALL apply the same direct-damage variance rule exactly once for that damage event.

#### Scenario: Misses do not create damage variance
- **WHEN** an attack or skill misses
- **THEN** its damage SHALL remain 0 and no direct-damage variance roll SHALL be applied.

#### Scenario: Variance is deterministic
- **WHEN** the same battle is simulated with the same seed and snapshots
- **THEN** all variance rolls and resulting damage values SHALL be identical.

### Requirement: DOT damage is stable after application

Damage-over-time effects SHALL NOT use the direct-damage variance roll on individual ticks.

#### Scenario: DOT application snapshots damage and interval
- **WHEN** a DOT effect is applied
- **THEN** its per-tick damage value N and tick interval M SHALL be determined once at application and retained by the effect.

#### Scenario: DOT ticks do not reroll
- **WHEN** a DOT effect produces later ticks
- **THEN** each tick SHALL use the stored N and M from application and SHALL NOT recalculate or reroll them.
