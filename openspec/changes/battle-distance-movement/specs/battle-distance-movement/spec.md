# Battle Distance and Movement Specification

## ADDED Requirements

### Requirement: Every unit occupies a position in an eight-space battle lane

The battle simulator SHALL represent every character and monster by an integer position in a single lane with eight spaces, indexed 0 through 7. One space can contain at most one unit. Distance SHALL mean the number of empty spaces strictly between two units, bounded from 0 to 6.

#### Scenario: Adjacent positions
- **GIVEN** two combatants occupy neighboring positions
- **WHEN** distance is calculated
- **THEN** the distance is 0 empty spaces

#### Scenario: Maximum separation
- **GIVEN** combatants occupy positions 0 and 7
- **WHEN** distance is calculated
- **THEN** the distance is 6 empty spaces

#### Scenario: Melee versus melee starts in the center
- **GIVEN** both combatants classify as MELEE
- **WHEN** a battle snapshot is initialized
- **THEN** the character starts at position 3 and the monster at position 4

#### Scenario: Any RANGED combatant starts at opposite ends
- **GIVEN** either combatant classifies as RANGED
- **WHEN** a battle snapshot is initialized
- **THEN** the character starts at position 0 and the monster at position 7

### Requirement: Player combat style is derived from available enabled Foe Gambit actions

A character SHALL classify as RANGED at battle start when its active/enabled Gambit contains at least one valid available ranged action targeting Foe. Bow basic attack SHALL count as ranged. Ally/self actions SHALL not count. Combat style SHALL be frozen in the battle snapshot.

#### Scenario: Bow attack alone is ranged
- **GIVEN** the character has a Bow equipped and a valid Foe Gambit basic Attack action
- **WHEN** battle style is derived
- **THEN** the character classifies as RANGED

#### Scenario: Ranged skill in an enabled lower-priority Foe line
- **GIVEN** a ranged skill is learned, its required equipment is equipped, and an enabled Foe line references it
- **AND** the line condition is currently false or a higher-priority melee line is currently eligible
- **WHEN** the initial battle style is derived
- **THEN** the character classifies as RANGED

#### Scenario: Ally support does not set ranged entry
- **GIVEN** the only ranged action is a learned heal/support action that targets Ally or self
- **WHEN** style is derived
- **THEN** that action does not make the character RANGED

#### Scenario: Invalid equipment/item line does not count
- **GIVEN** a ranged skill line lacks its required equipment or a ranged item line has no item in stock
- **WHEN** style is derived
- **THEN** the invalid line does not classify the character as RANGED

### Requirement: Every monster has explicit combatStyle, attack damage type and movement speed base

All monster Evasion values SHALL be reduced by 10% from the previously calibrated catalog values, rounded to the nearest integer, to adjust the monster hit profile to the approved hit formula.

All current monster definitions SHALL explicitly declare combatStyle as melee or ranged, an attack damage type, and a per-monster level-1 moveSpeedBase. The system SHALL not infer monster combat style from name/lore or attack speed.

#### Scenario: Ranged physical monsters
- **GIVEN** a monster is mon_fieldbat or mon_duneraider
- **WHEN** its battle snapshot is built
- **THEN** it is RANGED and its basic attack is physical ranged damage

#### Scenario: Wailing Wraith is ranged magical
- **GIVEN** the monster is mon_wraith (Wailing Wraith)
- **WHEN** its battle snapshot is built
- **THEN** it is RANGED because Ice Bolt is a valid ranged Foe skill
- **AND** Ice Bolt deals magic damage and may add a Freeze stack to the character
- **AND** its basic attack is melee with required distance 0
- **AND** the Wraith remains stationary while Ice Bolt is legal and in range
- **AND** its fallback attack Gambit line requires the `silence` status

#### Scenario: Silenced Wraith falls back to melee
- **GIVEN** Wailing Wraith has the `silence` status
- **WHEN** its monster Gambit is evaluated
- **THEN** Ice Bolt is illegal and the fallback basic attack is selected
- **AND** it approaches only if the character is not adjacent
- **AND** it attacks normally when the character is adjacent

#### Scenario: Remaining monsters use melee physical basics
- **GIVEN** any current monster except Field Bat, Dune Raider and Wailing Wraith
- **WHEN** its battle snapshot is built
- **THEN** it is MELEE and its basic attack is physical melee damage

### Requirement: Out-of-range actions cause movement rather than free attacks or priority fallthrough

Melee basic attacks and melee skills SHALL execute only on an adjacent target directly in front (distance 0). Ranged actions SHALL use their explicit range metadata. If the highest-priority action selected by a gauge is otherwise legal but out of range, the simulator SHALL skip execution and set a movement intent toward the target; it SHALL not try a lower-priority action on that same gauge activation. No SP, item quantity or cooldown is consumed by an out-of-range action.

#### Scenario: Melee character begins at range
- **GIVEN** a melee action is selected while the target is separated by one or more empty spaces
- **WHEN** that action's gauge fires
- **THEN** no attack/effect/resource cost/cooldown is applied
- **AND** the unit gains movement intent toward the target

#### Scenario: Out-of-range high-priority line
- **GIVEN** the highest-priority line is condition-true, otherwise legal, but out of range
- **AND** a lower-priority line has a ranged action
- **WHEN** the gauge fires
- **THEN** the high-priority action is range-blocked and no lower-priority action executes on that gauge firing
- **AND** no `range_blocked` event is added to the battle log

#### Scenario: Ranged fallback cancels stale approach
- **GIVEN** a unit has an approach intent from an earlier out-of-range melee action
- **WHEN** a later gauge selects an in-range ranged action
- **THEN** the ranged action can execute normally and stale approach intent is cleared

### Requirement: Move Speed drives a deterministic independent movement gauge

Characters SHALL have base Move Speed 50 + characterLevel, making a level-1 character's initial value 51. Each monster SHALL have a catalogued level-1 speed constant and effective speed moveSpeedBase + level - 1. A separate movement gauge SHALL accrue effective speed while there is movement intent, move one space per 100 accumulated points and preserve overflow. Speed is clamped to at least zero.

#### Scenario: Character level growth
- **GIVEN** a character moves from level 1 to level 2 with no speed modifiers
- **WHEN** base Move Speed is calculated
- **THEN** it increases from 51 to 52

#### Scenario: Movement gauge threshold
- **GIVEN** a unit with movement intent and effective speed 51
- **WHEN** two ticks pass with no obstruction or goal change
- **THEN** one movement step occurs by the time accumulated gauge reaches 100

#### Scenario: No movement intent
- **GIVEN** a unit has no movement intent
- **WHEN** simulation ticks advance
- **THEN** its movement gauge does not accrue new points

#### Scenario: Occupied next space
- **GIVEN** a unit intends to approach a target but its next space is occupied
- **WHEN** a movement step is attempted
- **THEN** it does not overlap the occupant and retains/retries its intent while still out of range

### Requirement: Movement resolution order is deterministic

Actions on a tick SHALL evaluate position from the beginning of that tick. Movement SHALL resolve in a post-action phase and only affect range checks beginning on the next tick. The character's movement is resolved before the monster's to break ties; no unit can overlap another.

#### Scenario: Movement reaches range
- **GIVEN** a unit moves adjacent at the end of a tick
- **WHEN** its next action gauge fires on a later tick
- **THEN** the range check uses the new position and the adjacent attack can execute

### Requirement: Slow remains a reusable timed status effect

`status_effects.json` SHALL be the canonical catalog for status duration, stackability, stack caps, movement modifiers and reapplication policy; `apps/frontend/public/data/status_effects.json` SHALL mirror it. Slow SHALL be defined there as non-stackable, with a flat -50 Move Speed modifier for 20 seconds. Reapplying Slow SHALL refresh the existing Slow status rather than stacking independent -50 penalties.

#### Scenario: Slow is refreshed
- **GIVEN** a unit is already Slowed
- **WHEN** another skill applies Slow
- **THEN** the existing Slow duration refreshes to 20 seconds after reapplication without stacking another -50 modifier

#### Scenario: Slow expires
- **GIVEN** a unit has Slow
- **WHEN** its 20-second duration ends
- **THEN** the -50 Move Speed modifier is removed

### Requirement: Ice Bolt applies independently stacked Freeze to the character

Ice Bolt SHALL cost 0 SP, use the catalogued two-tick cast time, and have no cooldown. Its `maxRange` in `skill_trees.json` includes the target's occupied space, so `maxRange: 7` reaches the maximum empty-space distance of 6 between positions 0 and 7. The skill SHALL specify `applyStatus: "freeze"` and a seeded `statusChance: 0.25`; duration, stackability, stack cap and per-stack Move Speed penalty SHALL come from the canonical `status_effects.json`, not duplicated skill metadata. Freeze SHALL remain distinct from Slow and MUST be included in the ordinary `statusEffects` list.

#### Scenario: Ice Bolt freezes the player
- **GIVEN** Wailing Wraith successfully casts Ice Bolt at the character
- **WHEN** the seeded 25% status roll succeeds and fewer than five Freeze stacks are active
- **THEN** one Freeze status stack is added to the character for 5 seconds
- **AND** effective Move Speed is reduced by 15 per active stack, clamped to zero
- **AND** the log records `CharacterName is freezing (N)` for the resulting stack count sourced from the status catalog

#### Scenario: Freeze is capped and stacks expire independently
- **GIVEN** the character already has five active Freeze stacks
- **WHEN** another Ice Bolt cast resolves
- **THEN** no sixth stack is added
- **AND** each existing stack expires 5 seconds after its own application

### Requirement: Status-effect stack loss and expiration are explicit in battle logs

The shared BattleEngine SHALL use `status_effects.json` for stackability and stack limits. When one stack of a stackable effect expires and at least one stack remains, it SHALL emit `status_stack_lessened` with the new remaining stack count. When the last stack expires, or any non-stackable status expires, it SHALL emit `status_ended` for that status ID and affected unit. New battle logs SHALL NOT emit generic `status_expired` events. Both live Grind and Battle History SHALL render `status_stack_lessened` as `CharacterName's freeze lessens (N)` and `status_ended` as `CharacterName's freeze ended`, substituting the actual unit name and status ID.

#### Scenario: A stack expires while another remains
- **GIVEN** a unit has two active stacks of the same stackable status
- **WHEN** one stack expires
- **THEN** a `status_stack_lessened` event records the new stack count of one

#### Scenario: The final stack or a non-stackable status ends
- **GIVEN** a unit has one remaining stack, or one active non-stackable status
- **WHEN** that effect expires
- **THEN** a `status_ended` event identifies the affected unit and status ID

### Requirement: Live and historical skill logs show resolved damage

Every damaging `use_skill` event SHALL include its resolved `damage` value, and both the live Grind event feed and Battle History SHALL display that value in the skill message.

#### Scenario: Ice Bolt damage in the live feed
- **GIVEN** Wailing Wraith's Ice Bolt resolves for 39 damage
- **WHEN** the event appears in the Grind panel
- **THEN** it displays `Wailing Wraith casts Ice Bolt for 39 damage`

### Requirement: Movement and range decisions are reproducible in logs

Battle logs SHALL record starting positions/style/speed and every completed movement with actor, from/to positions, spaces moved, direction, before/after distance and effective Move Speed. Movement logs SHALL use the actor's character/monster name for presentation; no `range_blocked` log event SHALL be generated. Position remains server-authoritative and is part of the immutable precomputed battle result.

#### Scenario: Reproducible movement
- **GIVEN** identical battle snapshot and seed
- **WHEN** the same battle is simulated twice
- **THEN** movement positions, movement events, combat actions and status durations are identical

#### Scenario: Movement log
- **GIVEN** a unit completes one movement step
- **WHEN** the event is written
- **THEN** it includes tick, actor, from/to positions, `spacesMoved`, direction, distance before/after, effective Move Speed and reason
- **AND** the UI presents the movement using the actor's name
- **AND** the arrow is derived from the actual lane positions: `-->` when `toPosition > fromPosition`, and `<--` when `toPosition < fromPosition`, for either actor
- **AND** the arrow remains correct if the character and target later pass each other and swap sides

### Requirement: Current single-target scope leaves 5x5 as future roadmap

The current simulator SHALL remain one character versus one monster in a single lane. Future PvE/PvP battles up to five versus five may use five independent eight-space lanes, but this change SHALL NOT implement groups, target switching, allied targeting, cross-lane movement, multi-target AoE or lane visualization.

#### Scenario: Current encounter remains one-versus-one
- **GIVEN** this change has been implemented
- **WHEN** a battle is generated
- **THEN** only the current character and one monster participate in the lane

### Requirement: Basic attacks use the approved Accuracy/Evasion formula

Basic attacks SHALL use `hitChance% = clamp(100 + Precision - Evasion, 5, 95)`, resolving the random roll deterministically through the battle seed. Before enabling the new stat scale, monster Precision/Evasion values SHALL be calibrated to it. Active abilities SHALL not roll Accuracy/Evasion or critical hits unless a future explicitly specified exception says otherwise.

#### Scenario: Baseline character against baseline evasion
- **GIVEN** an attacker has Precision 80 and the target has Evasion 100
- **WHEN** the basic-attack hit chance is calculated
- **THEN** the chance is 80% and the miss chance is 20%

#### Scenario: Hit chance is clamped
- **GIVEN** Precision and Evasion differ enough to produce a result outside 5–95%
- **WHEN** hit chance is calculated
- **THEN** the final chance remains within 5% and 95%

### Requirement: Positional ability contracts are shared with the Mastery proposal

Movement logic SHALL expose exact position/distance operations consumed by the equipment/Mastery change.

#### Scenario: Blinkstrike
- **GIVEN** Blinkstrike is selected at any distance
- **WHEN** its action resolves
- **THEN** the character moves to the space directly in front of the target if not already there, then applies its physical hit in the same action
- **AND** no critical roll, additional SP cost or separate movement action is added

#### Scenario: Shield Bash
- **GIVEN** an incoming enemy basic attack lands when the attacker is distance 0 from the Shield user's position
- **WHEN** Shield Bash's passive chance triggers
- **THEN** the enemy is stunned for its defined 5-second duration

#### Scenario: Fearless Focus
- **GIVEN** a Bow basic attack resolves
- **WHEN** damage/Precision bonuses are calculated
- **THEN** the authoritative empty-space distance at the beginning of the attack tick is used

#### Scenario: Violent Shot
- **GIVEN** Violent Shot resolves
- **WHEN** the target is pushed
- **THEN** it is moved away to distance 6 when the lane permits, with no extra movement if already at distance 6 or blocked by the lane boundary

#### Scenario: Current AoE skills remain single-target
- **GIVEN** Heavy Swing or Fire Blast resolves in the one-target simulator
- **WHEN** damage is applied
- **THEN** only the selected monster receives the current skill effect; area targets remain future scope
