# Skills, teleport and party polish

## ADDED Requirements

### Requirement: Skills targeting any side

A skill whose catalogue `target` is `any` SHALL be cast on the subject chosen by the gambit line's condition scope: the caster for a Self condition, the matching ally for an Ally condition, the matching foe for a Foe condition. Gambit validation SHALL accept such a skill under any condition scope.

#### Scenario: Light of Heaven on a Shadow foe
- WHEN a line `Foe: HP > 0% → Light of Heaven` resolves against a foe whose element is Shadow
- THEN the foe loses exactly the amount the skill would have healed, as pure damage
- AND a foe of any other element is healed by that amount.

#### Scenario: Range
- WHEN the foe stands 9 cells away and the caster cannot move
- THEN Light of Heaven is not cast; at 8 cells it is.

### Requirement: Skill range in tooltips

Skill tooltips SHALL show the skill's range as the engine reads it: `maxRange`, otherwise 7 for ranged and 1 for melee skills, `Self` for self-only skills and `Any` for Blinkstrike.

#### Scenario: Light of Heaven tooltip
- WHEN the player hovers Light of Heaven in the mastery tree
- THEN the tooltip shows `Range: 8`.

### Requirement: Teleport pose

While a saved-town teleport is under way and not paused, the teleporting characters SHALL kneel inside a translucent blue column of light in the battle arena, the arena ground SHALL stop scrolling, and the Character Summary portrait SHALL kneel.

#### Scenario: Party teleport
- WHEN the party leader starts a teleport
- THEN every walking member kneels in a light column until it completes.

### Requirement: Party leader transfer and invitations

The party leader SHALL be able to make another member the leader, except while a party trip or teleport is under way or the member is leaving. An invitation addressed to the player SHALL appear as a popup with Accept and Decline. A character SHALL NOT have two pending invitations from the same inviter.

#### Scenario: Second invitation
- WHEN a player invites a character that already has a pending invitation from them
- THEN the server refuses it with `INVITE_ALREADY_PENDING`.
