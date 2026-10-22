# Capability: monster-roster-aggression-presentation

## ADDED Requirements

### Requirement: Three new species have canonical data, sprites and drops

The canonical monster catalogue and its frontend mirror SHALL contain Mutant Bee (mon_mutantbee, level 5), Giant Mantis (mon_giantmantis, level 36) and Flaming Treant (mon_flamingtreant, level 38). Each SHALL define all required combat statistics, combat style, aggression, world Move Speed, XP reward, a valid Gambit, and resolvable common/rare part drops. Each SHALL have an individual transparent 167×199 sprite asset keyed by its stable ID.

#### Scenario: Catalogue loads all three species
- GIVEN the canonical and frontend monster catalogues
- WHEN catalogue validation runs
- THEN the three IDs exist exactly once in both copies and the copies match
- AND each monster's roster references resolve to that species
- AND each common/rare drop resolves to an item in the canonical and mirrored item catalogues
- AND XP follows the current standard curve and approved low-level rule.

#### Scenario: Sprite and item art resolve
- GIVEN any new species or one of its part items
- WHEN the Grind foe sprite or item UI requests its artwork
- THEN the species resolves at /assets/monsters/<monsterId>.svg on a transparent 167×199 canvas
- AND every common/rare part uses a distinct icon depicting its named object.

#### Scenario: Approved common part names are preserved
- GIVEN a drop from Giant Mantis or Flaming Treant
- WHEN the common part is resolved
- THEN the item display name is exactly “Fun Purple Paint” for Giant Mantis and “Forest Ancient's Teardrop” for Flaming Treant.

### Requirement: Mutant Bee's Sting applies the Tip of Pain self-buff

Mutant Bee SHALL be an aggressive melee monster with a self-target active skill named Sting. The skill SHALL cost 30 SP, have a 15-second (15-tick) cooldown and a two-tick cast. A successful cast SHALL apply the tip_of_pain status (display name Tip of Pain) to the Bee itself. The status SHALL modify only the Bee's next basic-attack attempt: double its raw physical ATK input, then use normal hit chance and physical mitigation. A successful hit SHALL apply Disarm to the foe for 10 seconds (10 ticks). The buff is not applied to the foe at cast time.

#### Scenario: Self-buff resolves without applying a foe debuff
- GIVEN Mutant Bee can legally cast Sting
- WHEN Sting resolves
- THEN the Bee gains tip_of_pain
- AND the foe does not gain Disarm until the empowered attack successfully hits.

#### Scenario: Next hit is doubled and mitigated normally
- GIVEN Mutant Bee has tip_of_pain and its next basic attack hits
- WHEN the attack resolves
- THEN the raw physical ATK contribution is doubled before ordinary hit-independent physical mitigation
- AND the final damage still uses the normal hit, DEF and physical-damage rules
- AND the foe receives Disarm for 10 ticks
- AND tip_of_pain is consumed so it cannot enhance a second attack.

#### Scenario: Empowered attack misses
- GIVEN Mutant Bee has tip_of_pain and its next basic attack misses
- WHEN that attack attempt resolves
- THEN no damage or Disarm is applied
- AND the one-use tip_of_pain enhancement is consumed by that attack attempt.

#### Scenario: Bee does not repeatedly refresh the buff
- GIVEN the Tip of Pain status is active and Mutant Bee's Gambit is evaluated again
- WHEN Sting remains on cooldown or the Tip of Pain self-status is active
- THEN the current Gambit legality/priority allows a basic attack instead of re-casting to refresh the buff before attacking.

### Requirement: Monster aggression and map presence match the approved contract

Mutant Bee SHALL be aggressive and melee; Giant Mantis SHALL be non-aggressive, melee and have exactly 150 Evasion; Flaming Treant SHALL be aggressive, melee and immune to fire. Mutant Bee SHALL appear at 60% in Green Grounds 1 and 35% in current Green Grounds 4 (the former Green Grounds 5). Giant Mantis SHALL appear at 15% in Caetê 0 and 50% in Kwaiouá Forest 5. Flaming Treant SHALL appear at 30% in Kwaiouá Forest 6 and 35% in Kwaiouá Forest 7. Existing entries in each affected map SHALL be scaled proportionally into the remaining share, leaving each map roster at 100%.

#### Scenario: New species map weights remain normalized
- GIVEN any one of the six affected map rosters
- WHEN the canonical map validator runs
- THEN all approved new-monster shares match the contract
- AND the existing monsters retain their proportional share of the remaining percentage
- AND total presenceRate equals 100%.

#### Scenario: Giant Mantis is a non-aggressive encounter
- GIVEN the current map selects Giant Mantis during Gathering or Traveling
- WHEN pre-combat encounter logic evaluates aggression
- THEN it is skipped without starting combat or an aggressive FLEE roll
- AND Hunting can still fight it normally.

#### Scenario: Flaming Treant has the approved elemental and stat identity
- GIVEN Flaming Treant combat data
- WHEN its elemental defenses, attacks-per-time and world Move Speed are validated
- THEN fire damage is fully resisted
- AND physical ATK is 1.40 times the chosen level-38 baseline
- AND attack rate and world Move Speed are each 0.80 times the level-38 baseline after documented integer rounding
- AND world Move Speed remains consistent with moveSpeedBase + level - 1.

### Requirement: Aggressive foes display an accessible sprite badge

The Grind foe UI SHALL render an aggression badge derived exclusively from the monster catalogue's isAggressive field. It SHALL use the supplied red-symbol reference, sit at the sprite container's upper-right corner without changing the 167×199 sprite canvas, and expose the tooltip text “Aggressive: this monster will try to interrupt your gathering or traveling” on hover and keyboard focus.

#### Scenario: Aggressive monster is marked
- GIVEN the displayed monster has isAggressive=true
- WHEN the Grind foe sprite renders
- THEN the small red aggression badge appears in the sprite's upper-right corner
- AND the accessible tooltip exposes the approved text.

#### Scenario: Non-aggressive monster is not marked
- GIVEN the displayed monster has isAggressive=false
- WHEN the Grind foe sprite renders
- THEN no aggression badge is displayed.

#### Scenario: Badge never changes game behavior or sprite layout
- GIVEN a monster sprite with or without the badge
- WHEN the foe panel renders or a user hovers the badge
- THEN combat state, sprite dimensions, foe bars and map interactions are unchanged.
