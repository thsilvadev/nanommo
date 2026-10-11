# Hand Equipment, Mastery and Skills Specification

## ADDED Requirements

### Requirement: Hand equipment has one authoritative slot and handedness contract

The system SHALL define eight Mastery/equipment categories: Sword, Greatsword, Dagger, Bow, Staff, Rod, Shield and Rune. The catalogue SHALL be the sole authority for primary slot, secondary slot, and two-handed metadata, and the server SHALL reject incompatible loadouts.

#### Scenario: Valid one-handed combinations
- **GIVEN** a character has a one-handed primary weapon equipped
- **WHEN** the character equips a Dagger, Shield or Rune in the secondary hand
- **THEN** the loadout is accepted, except that a Sword cannot be equipped in the secondary hand
- **AND** Dagger + Dagger, Sword + Dagger, and Rod + Dagger are valid combinations

#### Scenario: Sword duplicate is rejected
- **GIVEN** a character has a Sword equipped as primary
- **WHEN** the character attempts to equip a second Sword in the secondary slot
- **THEN** the server rejects the combination without losing or duplicating either item

#### Scenario: Shield or Rune requires a primary weapon
- **GIVEN** the primary hand is empty or has a two-handed weapon
- **WHEN** a Shield, Rune or Dagger is requested in the secondary hand
- **THEN** the request does not leave a secondary item equipped without a compatible one-handed primary
- **AND** any existing item replacement/return-to-inventory behavior remains atomic

#### Scenario: Two-handed equipment occupies both hands
- **GIVEN** a character has a secondary item equipped
- **WHEN** a Greatsword, Bow or Staff is successfully equipped as primary
- **THEN** the conflicting secondary item is returned to inventory
- **AND** the final loadout has no secondary item

### Requirement: Primary-hand choice is persisted and controls UI presentation

Character creation SHALL allow the player to choose right-handed or left-handed. The saved dominant hand SHALL control the visual side/highlight of primary and secondary slots; semantic mainHand and offHand meanings SHALL not change in APIs or combat.

#### Scenario: Left-handed creation
- **GIVEN** a player selects left-handed during character creation
- **WHEN** the character is created and opens equipment
- **THEN** the primary slot is presented on the left and the secondary slot on the right
- **AND** the server stores mainHand as the semantic primary slot

#### Scenario: Existing character has no dominant-hand value
- **GIVEN** a character predates this migration
- **WHEN** migration completes
- **THEN** dominant hand is right-handed by default

#### Scenario: Primary then secondary drag workflow
- **GIVEN** a character is being equipped through drag and drop
- **WHEN** the player begins the first hand drag with no compatible primary equipped
- **THEN** the primary slot is highlighted as the valid target
- **AND** only after a compatible one-handed primary is equipped may the secondary slot be highlighted for a compatible item

### Requirement: Secondary weapon ATK is reduced without reducing its other properties

The primary weapon SHALL contribute 100% of its ATK and a secondary-hand weapon SHALL contribute 50% of its item ATK. Other secondary item stats, attributes, bonuses and effects SHALL remain at 100%.

#### Scenario: Secondary Dagger contributes half ATK
- **GIVEN** a Dagger with catalogue ATK 120 is equipped in the secondary hand
- **WHEN** derived character ATK is calculated
- **THEN** its ATK contribution is 60
- **AND** its other stats/bonuses/effects are applied normally

#### Scenario: Equipped off-hand tooltip shows effective ATK
- **GIVEN** a weapon is equipped in the secondary hand
- **WHEN** its tooltip is displayed
- **THEN** the original item ATK is struck through and the effective 50% value is displayed beside it
- **AND** the existing central item tooltip path is reused

### Requirement: Mastery progression starts at zero and has an explicit cap

Each character SHALL have eight independent Mastery categories. New and migrated Masteries SHALL start at level 0 with 0 XP and no learned skill ranks. This release SHALL cap Mastery at level 10 and grant one skill point per level gained. Mastery XP SHALL never be removed on character death.

#### Scenario: First point is earned at level one
- **GIVEN** a category has Mastery level 0
- **WHEN** its XP reaches the level-one threshold
- **THEN** the category becomes level 1 and grants one point
- **AND** skill node one becomes available for the player to allocate

#### Scenario: Mastery cap
- **GIVEN** a category is at level 10
- **WHEN** more eligible Mastery XP would be awarded
- **THEN** the category remains level 10 and unspent point accounting remains valid

#### Scenario: Death preserves Mastery
- **GIVEN** a character has earned Mastery level and XP
- **WHEN** the character dies and is routed to Town
- **THEN** the character's Mastery level, XP and allocations are preserved

### Requirement: Mastery XP is awarded from successful actions using immutable equipment snapshots

The server SHALL award Mastery XP exactly once for eligible successful player actions and eligible landed incoming actions. A basic attack miss SHALL award no offensive Mastery XP. XP SHALL be configured through API environment values and awarded transactionally with battle resolution using the equipment snapshot that actually fought.

#### Scenario: Two-handed successful action
- **GIVEN** a character attacks successfully with a two-handed weapon
- **WHEN** the action is included in the resolved battle
- **THEN** its weapon category receives 2 Mastery XP by default

#### Scenario: Two one-handed hands
- **GIVEN** a character uses a valid two-one-handed loadout
- **WHEN** an eligible action is successfully executed
- **THEN** each occupied hand's category receives 1 Mastery XP by default
- **AND** two Daggers therefore credit 2 XP to the Dagger category for the action

#### Scenario: Offensive miss grants no XP
- **GIVEN** a basic attack is resolved as a miss
- **WHEN** Mastery rewards are calculated
- **THEN** no offensive-action Mastery XP is granted for that action

#### Scenario: Shield and Rune earn defensive XP
- **GIVEN** Shield or Rune is equipped in the secondary hand
- **WHEN** an incoming action is confirmed as landed, including an action dealing zero damage
- **THEN** that category receives 1 defensive Mastery XP by default
- **AND** a physical miss grants no defensive XP

#### Scenario: Duplicate battle delivery is idempotent
- **GIVEN** the same BattleQueueEntry resolution is attempted more than once
- **WHEN** the resolver commits the battle payout
- **THEN** Mastery XP is persisted only once

### Requirement: Mastery XP curve matches the character progression milestones

The system SHALL use one shared/generated Mastery threshold table and a deterministic pacing test. Independent frontend and backend implementations of thresholds are prohibited.

#### Scenario: Two-handed build pacing
- **GIVEN** the canonical character and encounter XP assumptions
- **WHEN** the pacing harness runs the reference two-handed build
- **THEN** Mastery level 5 is reached around character level 23

#### Scenario: Dual one-handed pacing
- **GIVEN** the same pacing assumptions
- **WHEN** the pacing harness runs a build using two one-handed Mastery categories
- **THEN** both categories reach level 5 around character level 28
- **AND** around character level 50 the reference build reaches level 7 in each category

#### Scenario: Single-category upper pacing
- **GIVEN** the same pacing assumptions
- **WHEN** the pacing harness runs one single-category build
- **THEN** the category reaches Mastery level 10 around character level 50

### Requirement: Skill points unlock and rank two nodes per Mastery category

Each Mastery category SHALL define exactly two current skills. A category begins with no points spent and no learned skills. At Mastery 1 node one becomes allocatable; node one accepts five points; node two unlocks only after node one reaches five; points six through ten rank node two from one through five. The data contract SHALL support a skill-specific maximum rank from 1 through 10.

#### Scenario: Node one unlock
- **GIVEN** a category reaches Mastery 1
- **WHEN** the player allocates its first point to node one
- **THEN** the skill becomes learned at rank 1 and can be offered as an active Gambit action if active

#### Scenario: Node two prerequisite
- **GIVEN** node one is below rank 5
- **WHEN** the player tries to spend a point on node two
- **THEN** the server rejects the allocation without spending a point
- **AND** once node one is rank 5, point six may set node two to rank 1

#### Scenario: Allocation respects point and rank limits
- **GIVEN** a player has a limited number of points for this category
- **WHEN** a rank allocation is requested
- **THEN** the server verifies category ownership, integer rank increase, available points, prerequisite and maximum rank
- **AND** total spent points never exceed Mastery level

### Requirement: Active and passive skills follow their equipment and combat contracts

The shared deterministic simulator SHALL use learned rank and current eligible equipment to activate skills. Active skills SHALL use SP, SHALL not miss using Accuracy/Evasion and SHALL not crit. Passives SHALL only operate while the relevant equipment is currently equipped. Skill effects and status durations SHALL be deterministic and represented in the battle log.

#### Scenario: Passive requires equipped source
- **GIVEN** a character has learned a passive but no longer has its source equipment equipped
- **WHEN** a battle snapshot is built
- **THEN** that passive has no combat effect for that snapshot

#### Scenario: Active Gambit skill requires learned rank and equipment
- **GIVEN** a Gambit line references a learned active skill
- **AND** its required weapon is unequipped
- **WHEN** the combat snapshot and Gambit state are built
- **THEN** the line remains saved but is unavailable and is skipped at runtime

#### Scenario: Active skill does not use hit or critical rolls
- **GIVEN** an active ability passes rank, equipment, SP and cooldown checks
- **WHEN** the ability resolves
- **THEN** it does not roll Accuracy/Evasion or a critical hit
- **AND** future immunity/resistance behavior may still reduce final damage

### Requirement: All eight category skill definitions are data-driven and deterministic

The catalogue SHALL define these current active/passive effects and costs:

- Sword: Swordsmanship passive; Power Strike active, 30 SP, raw physical ATK + 50 × rank, 10-second cooldown.
- Greatsword: Brutality passive, +6 STR × rank while equipped and 1% disarm chance per successful damage event for 5 seconds; Heavy Swing active, 10/15/20/25/30 SP, physical ATK × rank, 15-second cooldown.
- Dagger: Double Strike passive, 5% chance × rank per equipped Dagger, at most one same-tick additional damage component; Blinkstrike active, guaranteed hit, physical ATK damage, no crit, no extra SP, 100/85/70/55/40 ticks cooldown; relocates the character to the space directly in front of the target before the same action hits.
- Shield: Shield Bash passive, 2% chance × rank when a landed incoming basic attack occurs at distance 0 (adjacent directly in front), stun 5 seconds; War Cry active, 50 SP, +20 DEF for 10 seconds, 30-second cooldown.
- Staff: Fire Ball active, 10 SP × rank, MATK + 30 × rank, cast 3 seconds, cooldown 1 second, 5% Burn chance; Fire Blast active, 100 SP × rank, MATK + 50 × rank, cast 6 seconds, cooldown 15 seconds, 50% Burn chance. Burn lasts 25 seconds, ticks MATK every 5 seconds, does not stack and refreshes on reapplication.
- Rod: Wisp Flow active, 5 SP × rank, MATK + remaining SP after cost, cast 2 seconds, cooldown 1 second; Light of Heaven active, 20 SP × rank, heals 50 × rank + floor(target max HP × floor(MATK / 20) / 100), cast 5 seconds, cooldown 9/8/7/6/5 seconds.
- Bow: Fearless Focus passive, per empty space of distance +1% × rank basic-attack damage and +1 Precision × rank; Violent Shot active, 20/40/60/80/100 SP, raw physical damage 50 × rank, 15-second cooldown and pushes the target away to distance six (maximum lane separation).
- Rune: Stored Essence passive, final SP cost = max(1, floor(base cost × (1 - 0.05 × rank))); Magic Barrier active, 50 SP × rank, self barrier 100 magic damage × rank for 300 seconds, 30-second cooldown.

All positional effects SHALL consume the position/range contract from battle-distance-movement, which must be implemented before this change. Greatsword and Staff intentionally have two active skills instead of an invented passive. All current battle resolution remains single-target except self-target effects; future AoE/party targets require a separate group-combat change.

#### Scenario: Double Strike is one scheduled action
- **GIVEN** Double Strike triggers on a basic attack
- **WHEN** damage is calculated and logged
- **THEN** base and additional damage components resolve in the same tick as one total damage event
- **AND** Mastery action XP is awarded once for the action

#### Scenario: Burn reapplies without stacking
- **GIVEN** a target is burning and another Fire Ball/Fire Blast applies Burn
- **WHEN** the new Burn effect is accepted
- **THEN** no second independent Burn stack is created
- **AND** the existing Burn expiry is refreshed to 25 seconds from reapplication

### Requirement: Accuracy/Evasion use the new base, Bow modifiers and a calibrated hit formula

Every new character SHALL start with derived Precision 80 and Evasion 100 before equipment. Each full group of three total DEX points contributes 1 Precision and each full group of three total AGI points contributes 1 Evasion; use normalized formulas 79 + floor(total DEX / 3) and 99 + floor(total AGI / 3) before equipment/passive modifiers. Bow equipment SHALL apply a negative Precision modifier of -75 at T1, -74 at T2 and -73 at T3. Derived Precision SHALL be `79 + floor(total DEX / 3) + equipment/passive modifiers`; derived Evasion SHALL be `99 + floor(total AGI / 3) + equipment modifiers`. This produces starting Precision 80/Evasion 100 from the six starting attributes at 5. The approved hit formula is `clamp(100 + Precision - Evasion, 5, 95)`, so 80 Precision versus 100 Evasion yields 80% hit / 20% miss. Monster Accuracy/Evasion values MUST be recalibrated to this same scale before implementation; current low monster Evasion values SHALL NOT be reused unchanged.

#### Scenario: New character equips T1 Bow
- **GIVEN** a new character has no allocated DEX or AGI points and has derived Precision 80
- **WHEN** a T1 Bow with Precision modifier -75 is equipped
- **THEN** derived Precision becomes 5

#### Scenario: DEX improves Precision
- **GIVEN** the character has 225 total DEX (starting 5 plus 220 allocated)
- **WHEN** Precision is calculated with a T1 Bow
- **THEN** those points contribute 75 DEX-derived Precision; with the baseline-normalized formula this results in Precision 79 after the T1 Bow penalty. Total DEX 228 is needed to reach Precision 80 unless the normalization/penalty is deliberately adjusted.

### Requirement: Gambit choices contain only known items and learned active skills

The Gambit item picker SHALL show only known item IDs. A character's initial known-item set SHALL be seeded from William's canonical vendor stock. The first authoritative acquisition of an additional item SHALL mark it known idempotently. Item quantities remain an independent runtime execution check. The skill picker SHALL show learned active skills only; passives SHALL not be Gambit actions.

#### Scenario: William items are known from character creation
- **GIVEN** a character is newly created
- **WHEN** the Gambit item picker opens
- **THEN** all canonical items sold by William are selectable, whether or not they are currently in inventory

#### Scenario: Acquiring an unknown item
- **GIVEN** a character receives an item not yet in its known-item set
- **WHEN** any authoritative item-grant path commits the acquisition
- **THEN** that item becomes known exactly once and is selectable in Gambits

#### Scenario: Unknown item is not listed
- **GIVEN** an item is in the global catalogue but is not known by the character
- **WHEN** the Gambit item picker opens
- **THEN** that item is omitted from available actions

### Requirement: Gambit equipment warnings are visible and actionable

A Gambit line that references a learned active skill whose required weapon is not equipped SHALL show the warning icon and specified tooltip. Grind's active Gambit title SHALL show a generic warning only if at least one line on that page is unavailable due to missing required equipment, and clicking it SHALL open the relevant Gambit page.

#### Scenario: Unavailable skill line
- **GIVEN** a learned active skill is used in a Gambit but its required weapon is unequipped
- **WHEN** the Gambit editor renders the line
- **THEN** it shows ⚠️ with tooltip “Este gambit não será executado porque a arma necessária não está equipada.”

#### Scenario: Grind title warning opens Gambits
- **GIVEN** the active Gambit page contains a line unavailable due to missing weapon equipment
- **WHEN** Grind renders the active Gambit title
- **THEN** it shows ⚠️ with generic tooltip “Há gambits impossibilitados!”
- **AND** clicking the icon navigates to Gambits and selects the relevant active page

#### Scenario: No false warning
- **GIVEN** every active-page skill line has required equipment
- **WHEN** the active Gambit title renders
- **THEN** no unavailable-Gambit warning is shown

### Requirement: Existing data migrates without loss and legacy skill references reset

Migration SHALL set existing characters to right-handed, reset legacy Mastery XP/levels and allocations, reset every legacy Gambit line, seed known items from William's vendor stock, and rename persisted Wand IDs to Rod IDs. It SHALL preserve account/character identity, attributes, currency, inventory counts, equipment, map, quests, Diet and unrelated data. Three Rune tiers SHALL be included in catalogue and icon deliverables.

#### Scenario: Existing character is migrated
- **GIVEN** an existing character has legacy proficiency rows, Gambit lines and inventory/equipment
- **WHEN** the migration completes
- **THEN** Mastery begins at level 0 and 0 XP for the new categories
- **AND** the first page is active and contains the canonical `<30% HP → pot_hp_small; always → attack` starter preset
- **AND** unrelated character/economy state is unchanged

#### Scenario: Wand IDs become Rod IDs
- **GIVEN** one or more persisted rows reference a legacy Wand item or skill ID
- **WHEN** migration runs
- **THEN** all corresponding references use the canonical Rod ID
- **AND** item/market/mail counts and quantities are preserved without duplicate entries

### Requirement: The specifications document future 5x5 battles

The root game specification and architecture documentation SHALL state that future PvE and PvP battles may support up to five versus five combatants. This is roadmap context only; this change SHALL NOT implement groups, allied targeting or multi-target battles.

#### Scenario: Current simulator remains single-target
- **GIVEN** this change is implemented
- **WHEN** a battle is simulated
- **THEN** the current single-character-versus-one-monster structure remains unless a separate approved proposal changes it

### Requirement: Positional ability behavior consumes the battle-distance-movement contract

This change SHALL use the position/distance API and event contract established by battle-distance-movement. The two changes SHALL be applied in dependency order, with battle-distance-movement first. No duplicate or approximate range/movement system may be introduced in this change.

#### Scenario: Blinkstrike relocation
- **GIVEN** Blinkstrike is selected at any distance
- **WHEN** the action resolves
- **THEN** the character moves to the space directly in front of the target if not already there, then applies its physical hit in the same action
- **AND** there is no critical roll, extra SP cost or separate movement action

#### Scenario: Shield Bash front-target range
- **GIVEN** an incoming enemy basic attack lands at distance 0
- **WHEN** the Shield Bash passive chance triggers
- **THEN** the enemy is stunned for 5 seconds

#### Scenario: Fearless Focus distance
- **GIVEN** a Bow basic attack resolves
- **WHEN** distance-dependent bonuses are calculated
- **THEN** the attack's start-of-tick empty-space distance from the battle snapshot is used

#### Scenario: Violent Shot push
- **GIVEN** Violent Shot resolves
- **WHEN** the target is pushed after damage
- **THEN** the target is moved away until distance 6 when the lane allows
- **AND** no extra movement occurs if already at distance 6 or blocked by the lane boundary

#### Scenario: Current AoE remains single-target
- **GIVEN** Heavy Swing or Fire Blast resolves in the current simulator
- **WHEN** damage is applied
- **THEN** only the current monster target is affected; multi-target AoE remains future scope
