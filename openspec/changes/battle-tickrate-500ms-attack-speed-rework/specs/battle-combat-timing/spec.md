# Spec Delta

## Purpose

Defines the server-authoritative combat clock and the time semantics of attacks, skills, statuses, resources, movement, and other simulated battle mechanics at 500 ms resolution.

## ADDED Requirements

### Requirement: Battle simulation uses a half-second tick

The battle simulator SHALL use an integer tick representing exactly 500 milliseconds of combat time. The simulator SHALL remain deterministic and independent of wall-clock APIs. The server SHALL convert simulation tick counts into absolute timestamps using the tick duration recorded for that battle.

#### Scenario: A simulated battle's duration is converted to wall-clock time

- **WHEN** a battle simulation completes in N ticks
- **THEN** its scheduled duration is N × 500 milliseconds, subject only to a one-tick minimum where a non-empty scheduled battle requires one

#### Scenario: Battle time is not computed by the client

- **WHEN** the client receives a battle entry with start/end timestamps and tick-duration metadata
- **THEN** it renders the server-provided timeline and never derives an outcome or authoritative end timestamp independently

### Requirement: Basic Attack Speed controls preparation time from zero to sixteen half-second ticks

The effective Character Attack Speed SHALL be clamped to the inclusive range 0–800 after applying existing rating-point bonuses and penalties. Basic-attack preparation time SHALL vary linearly from 16 ticks (8 seconds) at effective Attack Speed 0 to zero preparation ticks at effective Attack Speed 800:

`preparationTicks = 16 × (800 - effectiveAttackSpeed) / 800`

The attack gauge SHALL preserve fractional progress and SHALL fire on the first eligible tick where its accumulated progress reaches or exceeds 1.0. The existing Attack Speed rating sources, status penalties, and temporary attack-speed multipliers SHALL retain their semantics, subject to the minimum two-tick resolving lock.

#### Scenario: Minimum effective Attack Speed

- **WHEN** a Character has effective Attack Speed 0
- **THEN** the basic-attack preparation requires 16 ticks (8 seconds), followed by the fixed 2-tick lock, for an 18-tick (9-second) minimum-speed interval

#### Scenario: Attack Speed 210 produces a perceptible improvement

- **WHEN** a Character has effective Attack Speed 210 and no other timing modifier
- **THEN** the mathematical preparation duration is 11.8 ticks (5.9 seconds), the discrete gauge fires after 12 eligible ticks, and the expected interval including the 2-tick lock is 14 ticks (7 seconds)

#### Scenario: Maximum effective Attack Speed

- **WHEN** a Character has effective Attack Speed 800 or greater before clamping
- **THEN** preparation time is zero and the Character can fire again as soon as the 2-tick resolving lock has elapsed, producing a 1-second minimum interval

#### Scenario: Attack Speed outside the supported range

- **WHEN** bonuses or penalties produce a raw effective Attack Speed below 0 or above 800
- **THEN** the simulator clamps the value to 0 or 800 respectively and never extrapolates the preparation curve

#### Scenario: Attack Speed changes during a battle

- **WHEN** an Attack Speed buff, penalty, stack, or expiry changes the effective rating during a battle
- **THEN** the next gauge increment uses the new rate while previously accumulated fractional gauge progress is preserved

### Requirement: Basic attacks retain a separate two-tick resolving lock

Every resolved basic attack SHALL impose a two-tick (1 second) resolving interval, measured from its event tick to the earliest next tick at which the attack gauge may fire again. If an attack resolves on tick N, the attack gauge SHALL remain ineligible on tick N+1 and MAY resume preparation/fire at tick N+2. The lock SHALL NOT be reduced by Attack Speed ratings, Attack Speed penalties, or temporary Attack Speed multipliers. This event-index contract avoids adding an unintended third tick at zero preparation.

#### Scenario: The resolving lock prevents sub-second attacks

- **WHEN** a Character reaches effective Attack Speed 800
- **THEN** the next basic attack cannot resolve before tick N+2 (1 second after the previous attack event), with tick N+1 ineligible and zero preparation allowed at N+2

#### Scenario: The resolving lock and preparation are additive

- **WHEN** a Character has effective Attack Speed 0
- **THEN** the 16-tick preparation plus the 2-tick event-to-event lock interval produce an 18-tick (9-second) interval between attacks

### Requirement: Non-basic combat durations preserve their existing elapsed seconds

All combat mechanics other than the intentionally redesigned Character basic-attack preparation curve and the explicitly reduced real-time efficiency of Cast Time Reduction SHALL preserve their existing wall-clock durations. Tick-native durations and intervals SHALL be scaled to the 500 ms clock. This includes, without limitation, player and monster base skill cast times, cooldowns, monster basic-attack cadence, status duration and expiry, periodic damage intervals, character and monster resource regeneration, food digestion/expiry within combat, and per-action or timed combat effects. Values authored in seconds SHALL remain in seconds and be converted to ticks at the simulation boundary. Cast Time Reduction SHALL retain its existing rating and tick-reduction coefficient/rounding rule against the doubled base cast ticks; therefore, each tick removed by CTR represents 500 ms and the same CTR value reduces elapsed cast time at half its previous real-time efficiency.

#### Scenario: Player skill cast time is unchanged in seconds

- **WHEN** a player skill previously had a 4-second base cast time
- **THEN** its new base duration is 8 ticks and it still resolves after 4 seconds before applying the existing Cast Time Reduction semantics

#### Scenario: Cast Time Reduction has half its previous elapsed-time efficiency

- **WHEN** a Character has a CTR value that previously removed one 1-second tick from a skill cast
- **THEN** with the base cast ticks doubled, the same CTR value removes one 500 ms tick, so the real-time reduction is half as large while the unmodified base cast duration remains unchanged

#### Scenario: Skill cooldown is unchanged in seconds

- **WHEN** a skill previously had a 15-second cooldown expressed as 15 ticks
- **THEN** its new cooldown is 30 ticks and still blocks reuse for 15 seconds after the existing cooldown start boundary

#### Scenario: Monster attack cadence is unchanged in seconds

- **WHEN** a monster has a catalogued basic-attack interval expressed in ticks
- **THEN** the tick value and any tick-derived attack-speed penalty are scaled so that its real-time cadence remains unchanged

#### Scenario: Periodic status damage retains its elapsed interval

- **WHEN** Bleed, Burn, Poison, or another periodic status previously applied a periodic effect every 5 seconds
- **THEN** the same effect occurs every 10 half-second ticks, with the same damage amount and total duration in seconds

#### Scenario: Battle HP/SP regeneration retains a ten-second period

- **WHEN** a living Character or monster is eligible for a regeneration boundary
- **THEN** battle regeneration occurs every 20 ticks (10 seconds), with the existing amount and eligibility rules unchanged

#### Scenario: Food and consumable durations authored in seconds are converted correctly

- **WHEN** a food, potion, or tonic defines a duration or cooldown in seconds
- **THEN** the simulator converts that value to the corresponding number of 500 ms ticks and preserves the original elapsed seconds

#### Scenario: Off-battle regeneration retains its wall-clock schedule

- **WHEN** a Character regenerates outside an unresolved battle interval
- **THEN** the existing globally aligned 10-second regeneration schedule remains unchanged and is not doubled or accelerated by the combat tick change

### Requirement: Battle-lane movement preserves real-time Move Speed

The battle movement gauge SHALL use a threshold of 200 instead of 100 at a 500 ms tick rate. It SHALL continue accumulating the current effective Move Speed value on each half-second tick, but movement resolution SHALL occur only at one-second boundaries (every two combat ticks), with at most one space moved per boundary. This preserves the existing 100-point-per-second gauge progression and one-space-per-second cap in the same units scaled by two. Existing Move Speed values, equipment/status modifiers, movement-intent selection, occupied-position checks, and world travel/flee calculations SHALL remain unchanged.

#### Scenario: Ordinary movement speed is preserved

- **WHEN** a combatant has an effective Move Speed within the existing supported range and an active movement intent
- **THEN** Move Speed accumulates on both half-second ticks, but the doubled 200-point gauge is consumed only at one-second movement boundaries, producing the same movement step timing and one-step-per-second cap

#### Scenario: Movement without intent continues to bank gauge

- **WHEN** a combatant has no active movement intent
- **THEN** the existing movement-gauge accumulation and banked-progress semantics remain intact and no movement occurs

#### Scenario: World travel is unaffected

- **WHEN** a Character travels between world maps or attempts to flee outside the battle-lane simulation
- **THEN** the existing world Move Speed calculation and travel/flee duration behavior remain unchanged

### Requirement: Gambit conditions do not schedule actions by elapsed tick count

The Gambit condition catalogue SHALL NOT expose or evaluate `every_n_ticks` or another condition whose sole purpose is firing an action on an elapsed tick schedule. Action frequency SHALL be controlled by the relevant gauge, cast/cooldown state, and ordinary condition/action legality. State predicates such as HP/SP thresholds, status presence, and `skill_ready` SHALL remain supported.

#### Scenario: Ruins Guardian's stun action is cooldown-driven

- **WHEN** Ruins Guardian evaluates its stun skill line
- **THEN** the line uses an unconditional state condition and the skill's own cooldown and action legality determine when it can execute

#### Scenario: Temporal condition is rejected or absent from runtime catalogues

- **WHEN** a Gambit definition contains the removed `every_n_ticks` condition
- **THEN** it is not treated as a supported condition and no action is scheduled from that condition

#### Scenario: Non-temporal state conditions remain available

- **WHEN** a Gambit evaluates HP/SP bands, status predicates, or `skill_ready`
- **THEN** those conditions continue to evaluate against the current authoritative combat state
