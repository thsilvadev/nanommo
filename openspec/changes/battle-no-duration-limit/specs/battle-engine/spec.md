# Battle Engine

## ADDED Requirements

### Requirement: Battles have no duration-based termination

The battle engine SHALL continue deterministic tick simulation until one combatant reaches 0 HP. It MUST NOT stop because of a maximum tick count, elapsed-time threshold, timeout, or safety cap, and MUST NOT classify a character as defeated solely because a battle has lasted too long.

#### Scenario: Battle continues beyond the former safety cap
- **WHEN** both combatants remain alive after 200 ticks
- **THEN** simulation SHALL continue until one combatant reaches 0 HP
- **AND** the result SHALL reflect the actual combat outcome, not a timeout loss.

#### Scenario: Queue duration reflects the actual battle
- **WHEN** the engine simulates a battle that lasts N ticks
- **THEN** `durationTicks` SHALL equal the actual number of simulated ticks
- **AND** BattleService SHALL continue to derive `endAt` from that duration.

#### Scenario: Future flee support
- **WHEN** the future FLEE mechanism is implemented
- **THEN** it may provide an explicit additional termination condition
- **AND** until then, no flee termination behavior SHALL be invented.
