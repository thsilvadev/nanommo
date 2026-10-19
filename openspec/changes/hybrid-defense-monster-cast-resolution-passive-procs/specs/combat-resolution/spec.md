# Combat Resolution

## ADDED Requirements

### Requirement: Physical DEF combines flat and relative mitigation

The shared battle engine SHALL calculate physical mitigation from non-negative raw damage `D` and non-negative DEF `A` using `max(D × 0.01, D - 0.225 × A - D × A / (A + 250))`. It SHALL retain at least 1% of raw physical damage. The same authoritative helper SHALL apply to player and monster physical hits. Magical mitigation SHALL remain unchanged.

#### Scenario: Starting DEF investment has visible value

- **GIVEN** a physical hit has 44 raw damage and DEF is 10
- **WHEN** physical mitigation is calculated
- **THEN** mitigated damage is 34.1 before direct-damage variance and integer rounding

#### Scenario: Extra DEF continues to reduce damage

- **GIVEN** the same 44 raw physical hit
- **WHEN** DEF increases from 54 to 64 (including a +10 DEF buff)
- **THEN** mitigated damage decreases from approximately 24.0 to approximately 21.8 before direct-damage variance and integer rounding

#### Scenario: Physical damage cannot be fully negated

- **GIVEN** raw physical damage is positive and DEF is extremely high
- **WHEN** physical mitigation is calculated
- **THEN** the result is never lower than 1% of raw physical damage

### Requirement: Monster skills resolve after a deterministic cast duration

The shared battle engine SHALL evaluate monster Cast Gambits each tick. When the first legal `use_skill` is selected and in range, the monster SHALL begin a pending cast. The duration SHALL be non-negative integer `baseCastTicks`, defaulting to six ticks when absent. A positive-duration cast selected at tick `T` SHALL resolve at `T + baseCastTicks`; zero duration SHALL resolve at `T`. During a pending cast the monster's basic Attack gauge SHALL remain at zero and no basic Attack SHALL resolve. SP payment and cooldown start at skill resolution. Monster skill timing SHALL not depend on player CTR, equipment or mastery.

#### Scenario: Dire Wolf's four-tick Enraged Strike

- **GIVEN** the Dire Wolf falls below its 30% HP Gambit threshold at tick `T`
- **AND** Enraged Strike is legal and in range with `baseCastTicks = 4`
- **WHEN** the monster begins the cast
- **THEN** Enraged Strike resolves at `T + 4`
- **AND** the Dire Wolf does not resolve basic Attacks during the cast

#### Scenario: Wailing Wraith keeps deterministic zero-cooldown cadence

- **GIVEN** Ice Bolt has `baseCastTicks = 2` and zero cooldown
- **WHEN** the Wraith remains able to cast in range
- **THEN** resolved casts occur at T2, T4, T6 and subsequent two-tick boundaries
- **AND** no two skill effects resolve on the same tick

### Requirement: Passive Shield Bash does not become a character action

When Shield Bash applies stun from a landed incoming basic attack, the status event SHALL identify `sourceSkillId = "shield_bash"` and `passiveProc = true`. This SHALL remain a passive effect/status event, not a character Gambit action or gauge consumer. Player-facing logs SHALL render it as `<target> is stunned by Shield Bash.` and SHALL omit internal `action_suppressed` events.

#### Scenario: Shield Bash stuns a monster

- **GIVEN** Shield Bash activates after an incoming monster attack
- **WHEN** the stun status event is logged
- **THEN** the event is attributed to the Shield Bash passive and its monster target
- **AND** the UI displays `<target> is stunned by Shield Bash.`
- **AND** no new character action is introduced

#### Scenario: Suppression is not a visible log line

- **GIVEN** a monster action is blocked by stun or disarm
- **WHEN** the battle is simulated or an old log is displayed
- **THEN** no `action_suppressed` event is emitted by new simulations and existing such events are filtered from Grind and Battle History
