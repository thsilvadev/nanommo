# Heavy Swing Area Specification

## ADDED Requirements

### Requirement: Heavy Swing hits every foe around the caster
When Heavy Swing resolves against its target, the simulator SHALL also deal the same full damage to every other living foe within Chebyshev distance 1 of the caster's cell, and SHALL NOT damage allies.

#### Scenario: Two monsters next to the greatsword user
- **GIVEN** a character with Heavy Swing is adjacent to monsters A (its target) and B, and monster C stands two cells away
- **WHEN** Heavy Swing resolves on A
- **THEN** A and B each take Heavy Swing damage computed against their own defense
- **AND** C takes no damage
- **AND** an ally standing next to the character takes no damage

### Requirement: Disarm only on the main target
Heavy Swing SHALL apply its Disarm only to the target it was cast on.

#### Scenario: Splash target keeps its weapon
- **GIVEN** Heavy Swing hits its target A and splashes B
- **THEN** A may be disarmed by the skill's status roll
- **AND** B never receives Disarm from that Heavy Swing

### Requirement: Splash hits are their own events
Each extra hit SHALL be recorded as a `splash` event (not `use_skill`), so it starts no cooldown, spends no SP and does not count as another executed skill for mastery experience.

#### Scenario: Mastery counts the swing once
- **GIVEN** Heavy Swing hits three foes
- **THEN** the log has one `use_skill` and two `splash` events for that swing
