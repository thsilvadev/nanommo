# Spec Delta

## Purpose

Defines one reusable contract for applying combat statuses from skills, passives and consumable items. The capability keeps status identity and stacking policy separate from source-specific chance, duration, modifiers and damage payloads.

## ADDED Requirements

### Requirement: Status identity is independent from application parameters

The system MUST resolve status applications by a canonical status ID. Differences in duration, intensity, damage payload, chance, or trigger MUST be represented by application data and MUST NOT require a new status ID when the underlying status behavior is the same.

#### Scenario: A skill applies a stronger or shorter Slow

- **WHEN** a skill applies the canonical slow status with a custom duration and Move Speed multiplier
- **THEN** the target receives one slow instance with those per-application values and no duplicate skill-specific Slow identity is created

#### Scenario: The source omits optional application values

- **WHEN** an application omits a duration or modifier supported by the status definition's defaults
- **THEN** the resolved instance uses the canonical default for that omitted value

### Requirement: Application data overrides canonical defaults

Each skill, passive proc, monster ability, or consumable MUST be able to declare a status application containing its status ID and any applicable trigger, chance, rank-scaled chance, Save Butt Luck behavior, duration, rank-scaled duration, modifier overrides, and damage-over-time payload. Explicit application values MUST override defaults, including zero-valued modifiers and an explicit zero duration for an untimed status. The status catalogue MUST remain authoritative for identity, polarity, stackability, maximum stacks, and reapplication policy.

#### Scenario: A source overrides duration and movement intensity

- **WHEN** an application declares a duration of 12 ticks and a Move Speed multiplier of 0.2 for slow
- **THEN** the resulting instance lasts 12 ticks and uses the declared multiplier instead of applying the default flat penalty as well

#### Scenario: A rank-scaled duration is configured

- **WHEN** an application supplies a duration-by-rank array and the source has a valid rank
- **THEN** the duration for that rank is selected and used for that instance

#### Scenario: A source explicitly declares an untimed status

- **WHEN** an application declares duration zero for a status whose default duration is positive
- **THEN** the instance has no timed expiry and remains active until explicitly removed or the battle ends

### Requirement: All combat status applications share the same resolution semantics

Character skills and passive procs, monster skills and passive effects, and item use during combat MUST use the same status-application semantics. The resolver MUST enforce canonical stack caps and reapplication policy, apply chance only when the status can be accepted, preserve deterministic RNG behavior for guaranteed or impossible applications, and record the source actor and affected target separately.

#### Scenario: A stackable status reaches its cap

- **WHEN** a new application targets a stackable status that is already at its canonical maximum
- **THEN** no instance is added, no existing stack is refreshed, and no chance roll is consumed

#### Scenario: A refreshable non-stackable status is reapplied

- **WHEN** a new application targets an active non-stackable status whose canonical reapplication policy is refresh
- **THEN** the previous instance is replaced with a newly resolved instance and its expiry is restarted

#### Scenario: A monster applies a status to the character

- **WHEN** a monster ability successfully applies a status to the character
- **THEN** the event identifies the monster as source/actor and the character as target/owner

#### Scenario: A conditional application is not triggered

- **WHEN** a source requires a successful push but the target's lane position does not change
- **THEN** no status application is attempted and no status event is emitted

### Requirement: Damage-over-time payload belongs to the application source

A status application MUST be able to declare its damage amount or supported damage formula, damage interval, and damage type. The engine MUST resolve source-dependent formulas from the applying combatant at application time and snapshot the resolved per-tick damage on the resulting status instance. Each stackable instance MUST retain its own payload and timing.

#### Scenario: Burn snapshots the source MATK formula

- **WHEN** Fire Ball or Fire Blast successfully procs Burn
- **THEN** the Burn instance stores floor(source MATK / 5), deals that amount every ten ticks, and remains independent of later MATK changes

#### Scenario: Poison snapshots monster MATK

- **WHEN** Poison Sting successfully applies Poison
- **THEN** the Poison instance stores floor(monster MATK / 2), deals magic status damage every ten ticks, and uses the skill's declared duration

#### Scenario: Bleed stacks use the passive's rank-scaled payload

- **WHEN** Swordsmanship or Opening Spear applies Bleed
- **THEN** each accepted stack stores the damage and interval declared by that source, without reading damage amount, interval, or proc chance from the Bleed identity definition

### Requirement: Status applications persist consistently outside and across battles

A consumable used outside battle MUST resolve the same application defaults and overrides as its in-battle use. Persisted status instances MUST retain their resolved modifiers and damage-independent status state with an absolute wall-clock expiry when timed. Battle snapshots and checkpoint persistence MUST preserve the remaining duration and per-instance overrides without re-resolving them from changed source definitions.

#### Scenario: A tonic is used outside battle

- **WHEN** a tonic applies a status with source-defined duration and modifiers
- **THEN** Character status state stores those resolved values and an absolute expiry matching the declared duration

#### Scenario: A carried status enters a later battle

- **WHEN** a timed status survives a battle checkpoint or flee and is included in a later battle snapshot
- **THEN** its remaining duration and resolved per-instance modifiers are preserved without resetting to the status catalogue default
