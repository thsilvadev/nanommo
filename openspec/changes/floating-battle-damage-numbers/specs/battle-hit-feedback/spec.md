# Spec Delta

## Purpose

Defines clear, synchronized visual feedback for incoming and outgoing damage during live battles, including critical hits and damage-over-time effects, while keeping all combat results server-authoritative.

## ADDED Requirements

### Requirement: Damage events produce floating numbers at the affected combatant
The frontend MUST render one floating damage number for each current-timeline battle event that deals a positive amount of HP damage. The number MUST originate near the affected combatant's portrait or sprite, be readable over the battle scene, rise in a parabolic arc, move outward from the scene, and fade away. Character-targeted damage moves up and left; monster-targeted damage moves up and right. Multiple events, including multiple events on the same tick, MUST remain individually visible rather than collapsing into one number.

#### Scenario: Character receives direct damage
- **WHEN** a current battle event records positive damage with `target` equal to `character`
- **THEN** a red damage number appears at the character portrait and floats up-left before fading

#### Scenario: Monster receives ordinary damage
- **WHEN** a current battle event records positive damage with `target` equal to `monster` and is not a critical hit or typed DoT
- **THEN** a white damage number appears at the monster sprite and floats up-right before fading

#### Scenario: Several damage events occur together
- **WHEN** two or more eligible damage events occur on the same tick or within one animation lifetime
- **THEN** each event produces its own number with sufficient offset or trajectory variation to avoid complete overlap

#### Scenario: Battle presentation mounts after a hit
- **WHEN** the player opens or remounts the battle view after a battle has already begun
- **THEN** damage events earlier than the current presentation timeline are not replayed as new floating numbers

### Requirement: Critical damage is visually emphasized
Positive critical damage received by the monster MUST use yellow text, a black outline thicker than ordinary damage, and a font size 60% larger than ordinary damage. This critical styling MUST NOT be applied to non-critical hits or to damage received by the character unless the event is explicitly a critical hit.

#### Scenario: Character critically hits the monster
- **WHEN** a current damage event targets the monster and has `crit` equal to true
- **THEN** its floating number is yellow, has a stronger black outline, and is 60% larger than the ordinary number

### Requirement: Damage-over-time types have distinct colors
Damage-over-time events MUST be distinguished by the status that caused the damage: burn/general DoT is orange, poison is dark green, and bleed is a brighter red distinct from the character-damage red. Styling MUST use the event's target and status identity, not merely its source actor.

#### Scenario: Burn damage ticks
- **WHEN** a positive `status_damage` event identifies burn or another general fire/DoT status
- **THEN** its floating number is orange and appears at the combatant named by `target`

#### Scenario: Poison damage ticks
- **WHEN** a positive `status_damage` event identifies poison
- **THEN** its floating number is dark green and appears at the combatant named by `target`

#### Scenario: Bleed damage ticks
- **WHEN** a positive `status_damage` event identifies bleed
- **THEN** its floating number is a distinct brighter red and appears at the combatant named by `target`

### Requirement: Damage causes a brief target-specific hit flash
When a current battle event causes positive HP damage, the character portrait MUST flash red briefly if the character is the target. The monster sprite MUST flash white briefly if the monster is the target. Monster flashing MUST preserve the transparent silhouette of the sprite and MUST NOT fill the entire rectangular image canvas.

#### Scenario: Character takes damage
- **WHEN** a current battle event records positive damage to the character
- **THEN** the character portrait briefly flashes red at the event's timeline moment

#### Scenario: Monster takes damage
- **WHEN** a current battle event records positive damage to the monster
- **THEN** the visible non-transparent pixels of the monster sprite briefly flash white while transparent pixels remain transparent

#### Scenario: Damage is fully absorbed
- **WHEN** a battle event records no positive HP damage because the hit was fully absorbed or missed
- **THEN** no damage number or damage hit flash is shown for that event

### Requirement: Battle feedback is presentation-only and timeline-synchronized
Damage numbers and hit flashes MUST be driven by immutable queued battle-log events and their authoritative event ticks. The frontend MUST NOT infer damage from HP differences, generate damage values, or alter battle state. Each event MUST trigger visual feedback at most once per battle presentation session, and the effects MUST clean up after their animation completes or the battle view is destroyed.

#### Scenario: Event tick becomes current
- **WHEN** a queued battle event's tick becomes current while the battle view is active
- **THEN** its eligible number and flash begin in synchronization with that tick

#### Scenario: Battle resolves or the view is destroyed
- **WHEN** the battle ends or the battle view is destroyed
- **THEN** pending animation resources are cleaned up and no stale effect leaks into a later battle
