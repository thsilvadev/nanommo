# Character Skill Casting

## ADDED Requirements

### Requirement: Character Cast Gambit is evaluated immediately for skills

The authoritative shared battle engine SHALL evaluate the character's Cast Gambit at T0 and on each subsequent tick without waiting for the player cast gauge to fire. Gambit line order, conditions, and canonical legality checks for unlock/equipped requirements, SP and cooldown SHALL remain authoritative. A selected higher-priority legal Cast action SHALL retain existing Gambit precedence; the implementation SHALL NOT reorder lines or introduce a parallel evaluator.

#### Scenario: Self-target skill starts at T0

- **GIVEN** the character has a legal self-target skill selected by its Cast Gambit at battle tick 0
- **AND** there is no other higher-priority legal Cast action selected
- **WHEN** the battle begins
- **THEN** the skill starts casting at T0 without waiting for a cast-gauge threshold
- **AND** no target-distance check is required

#### Scenario: War Cry begins at T0 and resolves at its cast-time boundary

- **GIVEN** War Cry is unlocked/equipped as required, has sufficient SP, is off cooldown, is the selected legal Cast Gambit action, and has `baseCastTicks = 2`
- **AND** the character has the starting DEX 5, giving 10 CTR
- **WHEN** the battle begins at T0
- **THEN** War Cry begins casting at T0 without a target-distance check
- **AND** its effect resolves at T2, not T7 or after a player cast-gauge wait

#### Scenario: Skill action is illegal

- **GIVEN** a Cast Gambit line selects a skill that is locked, missing its required equipment, on cooldown, or unaffordable
- **WHEN** the Cast Gambit is evaluated
- **THEN** the canonical evaluator treats that line as illegal and checks the next eligible line according to existing Gambit priority rules
- **AND** the illegal skill starts no cast and changes no SP or cooldown

### Requirement: Character Cast Time Reduction is derived from DEX

The character's authoritative derived stat SHALL be named `castTimeReduction` (display label **Cast Time Reduction**) and SHALL equal `floor(DEX × 2)`. It SHALL have no legacy +100 baseline. One hundred CTR SHALL equal one second, or one battle tick, of cast-time reduction. The starting DEX value of 5 therefore yields 10 CTR. The API and frontend SHALL use the same server-derived value; the UI SHALL not recalculate it independently.

#### Scenario: Starting character CTR

- **GIVEN** a character has DEX 5
- **WHEN** derived stats are calculated and serialized
- **THEN** Cast Time Reduction is 10

#### Scenario: Higher DEX increases CTR

- **GIVEN** the character's total derived DEX increases
- **WHEN** derived stats are recalculated
- **THEN** CTR equals `floor(DEX × 2)` without adding 100

### Requirement: Effective character skill cast time allows zero ticks

For a character skill, effective cast duration SHALL be calculated at cast start as `max(0, ceil(baseCastTicks - castTimeReduction / 100))`, with `baseCastTicks` defaulting to 2 when absent and normalized to a non-negative integer. The ceiling SHALL preserve whole-second simulation semantics: any positive fractional tick requires the next full tick. There SHALL be no minimum-one-tick clamp. A duration of zero SHALL resolve at the same tick that the legal in-range intention is accepted.

#### Scenario: Two-tick cast receives 100 CTR

- **GIVEN** a character skill has `baseCastTicks = 2` and the character has 100 CTR
- **WHEN** the skill begins casting
- **THEN** effective duration is one tick
- **AND** if casting starts at T0, its effects resolve at T1

#### Scenario: CTR reduces a cast to zero

- **GIVEN** a character skill has `baseCastTicks = 2` and the character has at least 200 CTR
- **WHEN** the legal skill intention is accepted at T0
- **THEN** the skill effects resolve during T0 after the legality and range checks
- **AND** the engine does not force the skill to wait until T1

#### Scenario: Skill definition has zero cast time

- **GIVEN** a legal skill definition has `baseCastTicks = 0`
- **WHEN** the intention is accepted and required range checks pass
- **THEN** the skill resolves in the same tick even if CTR is zero

### Requirement: Targeted skill moves before beginning its cast

The engine SHALL validate the selected skill's current target/range contract before starting a cast. If a legal targeted skill is out of range, it SHALL set the existing movement intent and SHALL NOT start a pending cast, spend SP, or start the skill cooldown. The engine SHALL re-evaluate the Cast Gambit and legality during approach. Once the currently selected legal skill is in range, casting begins on that tick. Self-target/no-target skills skip target-distance checks. Range checks SHALL use the established lane-position and catalogue-range semantics.

#### Scenario: Out-of-range skill begins movement only

- **GIVEN** a legal selected skill requires the monster as target and the monster is out of range
- **WHEN** its intention is evaluated
- **THEN** movement intent is set toward the required range
- **AND** no cast begins, no SP is spent and no cooldown starts

#### Scenario: Skill begins after approaching into range

- **GIVEN** the selected legal target skill is out of range
- **WHEN** movement commits at the end of a tick and puts the target within range
- **THEN** the skill begins casting at the next tick's action phase
- **AND** the movement step does not retroactively start or resolve the skill in the previous tick

#### Scenario: Self-target skill ignores monster distance

- **GIVEN** a legal self-target skill is selected while the character and monster are far apart
- **WHEN** the skill intention is evaluated
- **THEN** the skill can begin at that tick without moving toward the monster

### Requirement: Pending skill resolves at its effective resolution tick

A positive-duration character skill SHALL resolve at `castStartedAtTick + effectiveCastTicks`; a zero-duration skill SHALL resolve immediately at its start tick. The engine SHALL keep one canonical effect-resolution path and apply damage/healing/status effects and corresponding log events at the resolution tick. SP cost and skill cooldown SHALL be applied at resolution, and cooldown SHALL run after cast completion rather than concurrently with the cast. Once casting has begun, later Gambit condition changes SHALL NOT replace that pending skill. No new cast-interruption behavior is introduced by this requirement.

#### Scenario: Positive-duration skill resolves later

- **GIVEN** a skill with effective duration 2 starts at T0
- **WHEN** the battle advances
- **THEN** it has no resolved skill effect at T0 or T1
- **AND** its effects and resolution log occur at T2

#### Scenario: SP and cooldown belong to resolution

- **GIVEN** a legal positive-duration skill begins casting
- **WHEN** the skill reaches its resolution tick
- **THEN** its SP cost is paid and its configured cooldown begins
- **AND** its cooldown does not run during the cast duration

#### Scenario: In-progress cast is not replaced

- **GIVEN** a positive-duration skill is already casting
- **WHEN** its Gambit condition becomes false or another line would otherwise become preferred
- **THEN** the existing pending skill continues to its scheduled resolution without selecting a replacement skill

### Requirement: A character cannot take another action while a skill is casting

From the tick a positive-duration skill begins through its resolution tick, the character SHALL NOT resolve another skill, non-skill Cast action, or basic Attack. The basic Attack gauge SHALL be held/reset at zero while the skill is pending and during the resolution tick; Attack gauge refilling may resume on the following tick. The zero-duration skill SHALL also retain same-tick priority, preventing a basic Attack on its intention/resolution tick.

#### Scenario: Basic Attack is suppressed during a cast

- **GIVEN** the character's Attack gauge would otherwise fire while a positive-duration skill is pending
- **WHEN** that tick is processed
- **THEN** no basic Attack resolves
- **AND** the Attack gauge remains at zero

#### Scenario: No same-tick double action for instant skill

- **GIVEN** an instant/zero-duration skill is selected and legal at T0
- **WHEN** the skill resolves at T0
- **THEN** a basic Attack does not also resolve at T0

### Requirement: Non-skill Cast actions retain their current scheduling

Actions `use_item`, `defend`, and `wait` SHALL retain their current Cast-gauge schedule, legality, cooldown/consumption behavior, and Gambit order. The immediate skill-intent path SHALL NOT execute a non-skill Cast action twice. A selected higher-priority non-skill Cast action continues to retain Gambit precedence; a selected out-of-range skill does not make a lower-priority non-skill Cast action execute.

#### Scenario: Item timing is unchanged

- **GIVEN** a legal `use_item` action is selected without a pending skill cast
- **WHEN** its existing Cast-gauge threshold fires
- **THEN** item resolution retains its current timing, quantity consumption, and cooldown behavior

### Requirement: Monster casting is unaffected by character CTR

The character CTR/pending-cast path SHALL NOT alter the monster cast gauge, monster `baseCastTicks`, monster SP/cooldown rules, or monster action timings.

#### Scenario: Wailing Wraith retains Ice Bolt timing

- **GIVEN** the Wailing Wraith selects its two-tick Ice Bolt under the existing monster rules
- **WHEN** the character's DEX/CTR changes while all other snapshot inputs stay the same
- **THEN** monster Ice Bolt resolution ticks remain unchanged
