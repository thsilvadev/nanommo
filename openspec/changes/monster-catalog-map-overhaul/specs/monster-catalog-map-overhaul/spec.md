# Monster Catalog and Map-Owned Encounter Specification

## ADDED Requirements

### Requirement: Map records are canonical and own monster occurrence

The system SHALL load map metadata from a dedicated `maps.json`. A monster definition SHALL NOT declare a single owning map. Each grind map SHALL list canonical monster IDs and editable per-monster presence rates. API and frontend catalog mirrors SHALL be validated and kept consistent.

#### Scenario: Map roster resolves to canonical monsters
- **GIVEN** a map roster contains a monster ID
- **WHEN** the map catalogue is validated or the encounter generator selects a monster
- **THEN** that ID resolves to exactly one canonical monster definition
- **AND** the encounter uses that definition's stats/skills/drop table, not a copied map-specific monster record.

#### Scenario: Encounter samples the selected map
- **GIVEN** a character grinds on a selected map
- **WHEN** a new encounter is generated
- **THEN** the monster is selected only from that map's roster according to the roster's `presenceRate` weights
- **AND** the generator never falls back to all monsters in the catalog.

#### Scenario: Invalid roster fails validation
- **GIVEN** a map references a missing monster, has duplicate coordinates, invalid presence values, or presence rates that do not total 100
- **WHEN** canonical JSON data is loaded/validated
- **THEN** validation reports the invalid data and does not silently substitute unrelated monsters.

### Requirement: The current world grid contains Town and six level-named grind maps

The system SHALL define Town at coordinate (0,0) and six clickable grind maps at coordinates (0,1) through (0,6). Their display names SHALL be `lv. 1`, `lv. 6`, `lv. 11`, `lv. 16`, `lv. 21`, and `lv. 26`. Every map record SHALL use `description: null` and `isClickable: true`. `map_lv_1` is the only grind map marked `is_town_border: true`. Each grind map SHALL declare `monsters_quantity: 100`.

#### Scenario: Six map level bands are non-overlapping
- **GIVEN** the six current grind maps
- **WHEN** their rosters are built
- **THEN** map lv. 1 contains levels 1–5, lv. 6 contains 6–10, lv. 11 contains 11–15, lv. 16 contains 16–20, lv. 21 contains 21–25, and lv. 26 contains 26–30
- **AND** a monster from 1–30 belongs to exactly one current map roster based on its level
- **AND** monsters above level 30 are not yet assigned to one of those maps.

#### Scenario: Map layout metadata is canonical
- **GIVEN** a map is loaded by the backend or frontend
- **WHEN** its metadata is read
- **THEN** coordinates, name, type, clickability, town-border flag, description, population and monster rates come from the same `maps.json` structure
- **AND** no consumer derives monster presence from a legacy map field on the monster.

### Requirement: Map/catalog migration preserves immutable battle history

The system SHALL move existing character locations off removed map IDs and reconcile stale unstarted encounters without mutating active or resolved battles.

#### Scenario: Existing player location migrates
- **GIVEN** a character references an old map ID
- **WHEN** the map migration is applied
- **THEN** a character previously in Town remains in Town
- **AND** a character on an old grind map is assigned to the current level map matching its saved character level, clamped to lv. 26 for level 26+
- **AND** old map IDs are removed from authoritative current-location and presence state.

#### Scenario: Current battle remains immutable
- **GIVEN** a character has an active in-flight battle and stale future queue entries
- **WHEN** map records and rosters are replaced
- **THEN** the active battle/job and resolved history are not rewritten
- **AND** only eligible unstarted future entries are invalidated/rebuilt through the existing BattleService-owned queue boundary.

### Requirement: Monster combat stats are retuned to the target level and role

Every existing and newly created monster SHALL have a coherent level-appropriate stat budget and explicit combat role. Role exceptions SHALL be expressed in JSON rather than species-name branches in TypeScript.

#### Scenario: Low-level training monsters preserve their identity
- **GIVEN** Slime 1, Field Bat 2, Thornsprout 5, Mudcrawler 7 and Dire Wolf 9
- **WHEN** their combat data is loaded
- **THEN** Slime is weak but damaging, Field Bat is fragile and evasive, Thornsprout cannot move and has high physical attack/fire vulnerability, Mudcrawler has high MDEF%, and Dire Wolf is fast and has a high-damage skill
- **AND** Thornsprout receives twice fire elemental damage and its XP reward is below the normal level-5 curve.

#### Scenario: Physical and magic defenses support distinct counters
- **GIVEN** monsters with explicit weapon-category and elemental weaknesses
- **WHEN** a character's attack resolves
- **THEN** the corresponding JSON multipliers are applied in the canonical damage calculation before the existing DEF/MDEF mitigation
- **AND** missing multiplier keys behave as 1.0.

### Requirement: Monster XP follows the original level curve with the approved reductions

The system SHALL keep the character XP requirement curve and global Grind XP multiplier unchanged. Standard monsters SHALL award 75% of the original level-based `xpReward`, based on their final level. Thornsprout SHALL award 30% of the original normal level-5 reward.

#### Scenario: Standard monster reward uses the target level
- **GIVEN** a monster whose target level is L
- **WHEN** its catalog XP reward is generated/validated
- **THEN** it equals `round(round(18 * L^1.15) * 0.75)`
- **AND** the original character XP curve/global Grind multiplier are not modified by this change.

#### Scenario: Thornsprout XP exception
- **GIVEN** Thornsprout at level 5
- **WHEN** its `xpReward` is validated
- **THEN** it equals `round(round(18 * 5^1.15) * 0.30)`
- **AND** the 0.75 standard factor is not applied a second time.

### Requirement: Attribute luck is canonical as LUK

The active game attribute SHALL be `LUK`/`luk`, replacing `SOR`/`sor` across backend, shared types, frontend, catalogs and persisted stat data. The migration SHALL preserve numeric attribute/equipment totals exactly.

#### Scenario: Legacy luck value migrates
- **GIVEN** a saved character or equipment record with a SOR value
- **WHEN** the migration is applied
- **THEN** the same numeric value exists under LUK
- **AND** no stat point, rolled bonus or total attribute is lost or duplicated.

### Requirement: Skill elemental and weapon-category multipliers are data-driven

The simulator SHALL combine the generic attack channel, optional weapon-category damage-taken multiplier, optional elemental damage-taken multiplier, and existing physical/magic mitigation through one deterministic resolver. JSON catalogues SHALL identify the attack's weapon category and element. Fire Ball and Fire Blast are fire; Light Wisp and Light of Heaven are light.

#### Scenario: Category and element combine
- **GIVEN** an attack has a weapon category and an element and the monster defines both multipliers
- **WHEN** damage is resolved
- **THEN** all applicable multipliers are applied once in the documented order and then DEF/MDEF mitigation is applied
- **AND** the battle event reports deterministic raw/final amounts
- **AND** healing/utility skills do not damage a target just because they have an element tag.

### Requirement: Save Butt Luck is a reusable hidden skill modifier

A skill with `saveButtLuck: true` SHALL reduce each supported chance value by up to 10 percentage points according to the target's total LUK. This flag SHALL not be surfaced in player-facing skill descriptions.

#### Scenario: Poison Sting chance is reduced by LUK
- **GIVEN** Venom Viper's Poison Sting has a base 50% Poison chance and `saveButtLuck: true`
- **WHEN** the target has 10 or more total LUK
- **THEN** the effective Poison application chance is 40%
- **AND** the saved catalogue chance remains 50%.

#### Scenario: Save Butt Luck is reusable
- **GIVEN** a future skill definition declares `saveButtLuck: true`
- **WHEN** its probability-bearing effect is resolved against a target
- **THEN** the same LUK-based helper is applied without adding a skill-specific code branch.

### Requirement: Pickpocket steals one full eligible stack permanently

Bandit SHALL be level 25, have 80 max SP, and use Pickpocket while the target's HP is below 20%. Pickpocket costs 60 SP, has a 20-tick cooldown and a base 10% chance. Each target total LUK point reduces its chance by one percentage point, capped at the base 10%. On a successful roll, one full eligible non-food consumable stack is removed permanently.

#### Scenario: LUK prevents Pickpocket
- **GIVEN** target total LUK is 5 or 10
- **WHEN** Bandit rolls Pickpocket
- **THEN** the respective chance is 5% or 0%.

#### Scenario: Full stack is stolen
- **GIVEN** the target has one eligible consumable stack with quantity N and Pickpocket succeeds
- **WHEN** the battle resolution is committed
- **THEN** the entire remaining N-unit stack is removed
- **AND** the stolen stack is not refunded on victory, defeat, death or return to Town.

#### Scenario: Theft respects eligibility and transaction order
- **GIVEN** the target has food, equipment, materials, empty stacks and non-food consumables
- **WHEN** Pickpocket selects an eligible stack
- **THEN** only a non-food consumable stack with remaining quantity can be selected
- **AND** a stack already consumed/depleted earlier in the simulated battle cannot be stolen or recreated
- **AND** retried resolution cannot remove unrelated stacks or apply the theft twice.

### Requirement: Poison Sting applies mitigated damage over time

Venom Viper SHALL use Poison Sting below 80% of its own HP. The skill has a base 50% chance (before Save Butt Luck) to apply Poison for 25 ticks, dealing MATK-scaled magic damage every 5 ticks.

#### Scenario: Poison respects Luck and MDEF
- **GIVEN** Venom Viper resolves Poison Sting against a target
- **WHEN** the status roll and periodic ticks resolve
- **THEN** one seeded application roll uses the adjusted chance
- **AND** Poison deals `floor(source MATK × 0.5)` raw damage every 5 ticks for 25 ticks, then normal MDEF% mitigation applies
- **AND** ticks do not reapply Poison or award Mastery action XP.

### Requirement: Prowess rewards player active skills with monster growth

Ruins Guardian SHALL gain one Prowess stack when the player character resolves an active skill against it. Each stack gives the monster +10 ATK and +10 DEF for 20 ticks; stacks expire independently and cap at five.

#### Scenario: Player skill builds Prowess
- **GIVEN** Ruins Guardian is in battle and the character resolves an active skill
- **WHEN** the skill action resolves
- **THEN** Guardian gains one stack, up to five, with +10 ATK/+10 DEF
- **AND** a monster's own skill does not trigger Prowess
- **AND** reaching the cap does not refresh existing stacks.

### Requirement: Conditional reflection is finite, typed and non-recursive

Broken Sentinel SHALL activate physical reflection for 15 ticks when newly Disarmed. Arcane Wisp SHALL activate magic reflection for 15 ticks when its top-priority Arcane Surge action becomes illegal specifically because of insufficient SP. Wailing Wraith Ice Bolt remains zero-cost and has no cooldown. Each active reaction reflects 30% of qualifying final damage received, then applies the original attacker's ordinary DEF/MDEF mitigation. Reflection cannot recursively trigger more reflection.

#### Scenario: Physical reflection follows Disarm
- **GIVEN** Broken Sentinel receives a newly applied Disarm
- **WHEN** the status application resolves
- **THEN** physical reflection activates for 15 ticks and logs its start/expiry.

#### Scenario: Magic reflection follows insufficient SP
- **GIVEN** Wailing Wraith cannot execute its top Ice Bolt Gambit line specifically because SP is insufficient
- **WHEN** that state transition is detected
- **THEN** magic reflection activates for 15 ticks
- **AND** an action blocked by cooldown, Silence or range does not trigger this reflection.

#### Scenario: Reflection damage is mitigated once
- **GIVEN** an active reflection receives a qualifying nonzero hit
- **WHEN** reflected damage is resolved
- **THEN** raw reflected damage equals 30% of the damage the reflector actually received
- **AND** normal target DEF/MDEF mitigation applies
- **AND** the reflected event cannot recursively reflect.

### Requirement: Rage is a data-driven fallback after an illegal basic attack

Rootbound Brute SHALL use the Gambit order `always -> attack`, followed by `always -> Rage`. Rage costs 0 SP, has a 15-tick cooldown, removes negative statuses, grants +20 ATK and doubles only basic-attack speed for 15 ticks.

#### Scenario: Illegal attack falls through to Rage
- **GIVEN** Rootbound Brute's basic-attack action is illegal at action evaluation
- **WHEN** its Gambit lines are evaluated
- **THEN** the attack line is skipped and Rage may execute if itself legal
- **AND** a legal out-of-range attack still starts approach rather than causing Rage to fire.

#### Scenario: Rage expires and cleanses debuffs
- **GIVEN** Rootbound Brute has negative statuses and Rage resolves
- **WHEN** the effect is applied
- **THEN** negative statuses are removed, ATK increases by 20 and the basic-attack interval is halved for 15 ticks
- **AND** skill/cast timing remains unchanged.

### Requirement: Sacred Forest Guardian has one opening spear

Sacred Forest Guardian SHALL resolve one high-damage physical spear at battle opening, with a 50% chance of one Bleed stack, then approach the character and fight in melee.

#### Scenario: Spear is opening-only
- **GIVEN** a new battle with Sacred Forest Guardian
- **WHEN** its opening action resolves and the battle continues
- **THEN** one spear event dealing 2.0× its basic ATK as raw physical damage and one seeded Bleed roll are emitted
- **AND** the Guardian approaches and uses melee afterward instead of throwing the spear again.

### Requirement: Future FLEE intent remains inert until FLEE exists

Kwaiouá Ranger SHALL declare the intended below-10%-HP escape behavior only as disabled future metadata and documentation. The current battle engine SHALL NOT execute FLEE, end the battle early, or treat the metadata as an action.

#### Scenario: Ranger reaches critical HP before FLEE implementation
- **GIVEN** Kwaiouá Ranger falls below 10% HP in the current game
- **WHEN** the Gambit engine evaluates its actions
- **THEN** only currently executable actions are considered
- **AND** the disabled future FLEE metadata has no combat outcome.


### Requirement: The approved monster roster and additions are complete

The canonical monster catalogue SHALL include the retuned existing roster, all four separately named new creatures, and the eight additional species at their approved target levels. Every new species SHALL have unique common/rare material entries and valid drop references.

#### Scenario: New and retuned monsters have stable level identities
- **GIVEN** the approved monster catalogues are loaded
- **WHEN** monster data is validated
- **THEN** the current named roster uses the target levels in the change design and the eight additional species exist at levels 11, 18, 18, 21, 27, 29, 41 and 55
- **AND** Bandit (25), Mudflat Crocodile (12), Kwaiouá Ranger (33) and Sacred Forest Guardian (50) are present
- **AND** a changed level does not retain stats or XP calculated for the previous level.

#### Scenario: New monster materials resolve
- **GIVEN** any of the 12 newly added species resolves its common or rare drop
- **WHEN** the drop result is committed
- **THEN** the corresponding item ID exists in both canonical and frontend item catalogues
- **AND** no new monster drop references a missing item
- **AND** the generic existing deterministic drop resolver owns the roll.

### Requirement: Thornsprout remains a safe ranged skill-training target

Thornsprout SHALL be stationary, have a melee basic attack with range 0, and receive twice normal fire-element damage. It SHALL retain high physical attack relative to level and a specially reduced XP reward.

#### Scenario: Ranged character trains against stationary Thornsprout
- **GIVEN** a ranged-style character enters battle with Thornsprout
- **WHEN** the battle's authoritative lane positions and actions resolve
- **THEN** Thornsprout never moves or uses a ranged action
- **AND** the character remains outside Thornsprout's melee attack range and receives no basic-attack damage from Thornsprout
- **AND** fire damage dealt to Thornsprout receives the ×2 elemental multiplier.

### Requirement: New monster parts are canonical catalog items

Each newly added species SHALL have one common and one rare monster-part item with unique IDs, editable values, and root/frontend catalog parity. New drop rows SHALL point to these IDs.

#### Scenario: Materials remain editable and resolvable
- **GIVEN** a new monster drops its common or rare part
- **WHEN** the item is loaded or the drop is resolved
- **THEN** the common/rare part uses the existing monster-part schema, has its own name and sell/base values, and exists in both item catalogues
- **AND** no crafting or progression recipe is implied by adding the material.
