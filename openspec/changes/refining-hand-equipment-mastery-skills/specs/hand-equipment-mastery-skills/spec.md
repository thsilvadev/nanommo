# Hand Equipment and Mastery Skills — Refinement

## ADDED Requirements

### Requirement: Target-aware status effects and battle logs

Battle status state and presentation SHALL distinguish the combatant that caused an event from the combatant affected by it. Status-effect icons and log messages SHALL reflect the authoritative opening snapshot and battle events through the current displayed tick.

#### Scenario: Character inflicts Bleed on a monster

- **WHEN** a successful character attack procs Swordsmanship Bleed
- **THEN** the monster becomes the status target and the character does not gain Bleed from that proc
- **AND** the application event includes target=monster
- **AND** the live Grind feed and Battle History identify the monster as the affected target.

#### Scenario: Bleed deals periodic damage

- **WHEN** one Bleed stack is due to tick
- **THEN** the target loses 5 × Swordsmanship rank pure damage for that tick
- **AND** the event identifies status=bleed, target, and the exact damage amount
- **AND** Bleed damage per stack is 5 × Swordsmanship rank, while proc chance is 1 percentage point per rank
- **AND** a Bleed tick grants no additional Mastery action XP.

#### Scenario: Status lifecycle is shown in real time

- **WHEN** a status is applied, stacked, refreshed, loses a stack, expires, or is removed early during battle
- **THEN** the corresponding target's STATUS area reflects the event as the battle timeline crosses it
- **AND** stackable effects show their current stack count
- **AND** statuses disappear when no active stack remains or an early removal event is recorded.

#### Scenario: Status is only on the monster

- **WHEN** a status-application event targets the monster
- **THEN** it appears under the monster's STATUS area
- **AND** it does not appear in the Character summary STATUS area.

### Requirement: Status effect icon catalogue and visual mapping

The frontend SHALL display one consistent icon for every supported active status: Freeze, Bleed, Slow, Burn, Stun, Disarm, War Cry, and Magic Barrier.

#### Scenario: Status icons use the supplied visual reference

- **WHEN** the status row is rendered
- **THEN** it preserves the existing Freeze frame, color palette, footprint and placement while replacing only the “Fre” lettering with a centered snowflake
- **AND** Bleed maps to atlas coordinate [9,1], Slow to [13,9], Burn to [4,1], Stun to [9,4], Disarm to [12,9], War Cry to [11,9], and Magic Barrier to [11,7] in project/status_icons.png
- **AND** the coordinate mapping uses 1-based row and column indexes
- **AND** extracted art has a transparent background or a matching clean SVG fallback.

#### Scenario: Status tooltip and stack counter

- **WHEN** the user hovers or focuses a status icon
- **THEN** the tooltip shows its name, current stacks, remaining duration, and applicable catalogued effects
- **AND** all runtime values are derived from the active battle snapshot/event timeline rather than client-authoritative gameplay.

### Requirement: Mastery skill tree icon nodes

The Mastery workspace SHALL present learned and learnable skills as an extensible icon tree, rather than rectangular text cards.

#### Scenario: Two-skill category tree

- **WHEN** a user selects any of the eight Mastery categories
- **THEN** the selected category's first 64×64 skill icon appears above its second skill icon
- **AND** a visible connector expresses the prerequisite from node 1 to node 2
- **AND** no skill name or mechanics text is rendered inside a rectangular node card
- **AND** rank and state remain visible below each icon.

#### Scenario: Skill icon artwork

- **WHEN** the Mastery tree or monster skills row is rendered
- **THEN** each of the 16 player Mastery skills and four current monster-only skills has its own local, high-quality PNG icon
- **AND** the artwork is inspired by project/skill_icons.png and communicates the actual ability rather than arbitrarily reusing unrelated atlas sprites
- **AND** image assets are rendered at 64×64 in Mastery with sufficient native resolution for crisp display.

#### Scenario: Skill tooltip detail and rank preview

- **WHEN** the user hovers or keyboard-focuses a skill icon
- **THEN** a tooltip shows kind, rank/max rank, prerequisites, SP cost, cast time, cooldown, damage/healing/stat/buff/status/position/range effects as applicable
- **AND** applicable numeric values use bold styling
- **AND** a pending rank shows its net increment in green (for example, Damage 64 (+15))
- **AND** after Apply succeeds the updated value is shown normally without the pending-delta styling
- **AND** the tooltip contains no rank allocation buttons.

### Requirement: Staged Mastery rank allocation

Mastery rank allocation SHALL remain a client-side draft until the user explicitly applies it. Committed ranks cannot be refunded by Reset.

#### Scenario: Stage a rank by clicking a skill icon

- **WHEN** the selected category has an available point and the clicked skill meets its rank cap and prerequisites
- **THEN** clicking the icon stages exactly one rank
- **AND** the displayed N/max rank increments in green
- **AND** no network mutation or battle queue invalidation occurs before Apply.

#### Scenario: Illegal rank cannot be staged

- **WHEN** a category has no available points, the skill is already at its cap, or its prerequisites are unmet
- **THEN** an icon click does not stage a rank
- **AND** the lock/availability state explains the missing prerequisite or point availability through the detail tooltip.

#### Scenario: Reset a pending draft

- **WHEN** the user clicks Reset before Apply
- **THEN** pending rank additions are discarded
- **AND** all displayed ranks and previews return to the persisted state
- **AND** no committed rank or spent point is refunded.

#### Scenario: Apply a valid pending draft atomically

- **WHEN** the user applies a valid staged allocation
- **THEN** the server validates the whole submitted plan and point totals atomically
- **AND** all requested rank updates commit or none commit
- **AND** the pending state clears only after server confirmation
- **AND** repeating the same request does not spend the same point twice.

### Requirement: Independent Mastery category progression and realtime refresh

Each Mastery category SHALL maintain independent XP, level, point budget, spent points, and learned ranks. The UI SHALL display authoritative changes without requiring the user to reopen the tab.

#### Scenario: Mastery XP stays within its category

- **WHEN** the character earns eligible Mastery XP with Bow
- **THEN** the Bow Mastery XP/level/points can increase
- **AND** Rod, Sword, Shield, Rune, and all other categories remain unchanged unless they independently earn their own reward.

#### Scenario: Mastery progress refreshes after battle

- **WHEN** the client receives an authoritative battle:resolved event
- **THEN** it refreshes or consumes committed server data for all Mastery categories
- **AND** XP, XP-to-next, level, available points, and ranks update without closing the Character screen
- **AND** the client does not calculate its own Mastery XP or level.

### Requirement: Authoritative monster mana

Every current monster SHALL use real deterministic SP state, costs, and regeneration in the battle simulator.

#### Scenario: Monster mana initialization

- **WHEN** an encounter snapshot is built for a catalogue monster
- **THEN** current SP begins at max SP
- **AND** max SP is 60 for every current monster except Venom Viper and Wailing Wraith, which have 80
- **AND** base regeneration is 2 SP per 10 battle ticks.

#### Scenario: Monster skill costs

- **WHEN** a monster skill resolves
- **THEN** Enraged Strike costs 30 SP, Regenerate costs 15 SP, Ice Bolt costs 10 SP, and Ground Slam costs 30 SP
- **AND** the cost is spent exactly once on resolution
- **AND** an action that does not resolve does not spend SP or start its cooldown.

#### Scenario: Monster cannot pay a skill cost

- **WHEN** the selected monster skill costs more SP than the monster currently has
- **THEN** the action is treated as illegal
- **AND** the Gambit evaluator may select the next legal line without spending SP
- **AND** the event timeline remains deterministic.

#### Scenario: Monster mana bar follows battle history

- **WHEN** the live Grind panel displays an active monster
- **THEN** its blue mana bar is below its HP bar and shows current/max SP
- **AND** current SP is reconstructed from the opening snapshot and spRemaining.monster event values
- **AND** it uses the same visual treatment as the HP bar.

### Requirement: Monster skill icon row

The Grind panel SHALL show the active monster's available catalogued skills as a compact icon row.

#### Scenario: Monster skills are derived from the monster Gambit

- **WHEN** the current monster has one or more use_skill actions in its Gambit
- **THEN** the skills row displays one icon for each distinct referenced skill ID
- **AND** the row appears below the event logs and immediately above DROPS THIS SESSION
- **AND** icon labels are not rendered as text beside the icons
- **AND** hover/focus tooltips show skill name, SP cost, cast time, cooldown, and effect.

#### Scenario: Monster has no special skills

- **WHEN** the current monster Gambit has no use_skill action
- **THEN** no fake or placeholder skill icon is displayed.

### Requirement: Preserve the BattleService future-combat mutation boundary

Applying Mastery changes SHALL use the existing authoritative future-combat mutation boundary and never modify an in-flight battle.

#### Scenario: Rank points applied during an active battle

- **WHEN** the user applies a valid Mastery allocation while a battle is in progress
- **THEN** persisted character/Mastery state changes immediately
- **AND** the active BattleQueueEntry snapshot and its BullMQ job remain unchanged
- **AND** only eligible stale future queue entries are invalidated and rebuilt from the newly persisted Mastery state after the active battle resolves.

#### Scenario: Reset or pending allocation does not mutate combat

- **WHEN** the user adds or resets pending points without applying
- **THEN** no API mutation occurs
- **AND** no active or future battle snapshot changes.


### Requirement: Rank-scaled Mastery skill formulas
Mastery skill definitions and tooltips SHALL expose rank-dependent values from canonical catalogue/resolver data.

#### Scenario: War Cry rank scaling
- **WHEN** War Cry resolves at rank N
- **THEN** it grants N × 10 DEF for 15 ticks/seconds
- **AND** the tooltip shows the rank-specific defense bonus and duration.

#### Scenario: Light Wisp damage formula
- **WHEN** Light Wisp resolves at rank N
- **THEN** its base raw damage formula includes MATK + N × 25 plus `floor(current SP before paying Light Wisp's own cost / 5)`
- **AND** current SP is sampled before paying Light Wisp's own cost and before any Arcane Dynamo refund from that action
- **AND** the formula shown in the tooltip does not estimate final damage after target defense or variance.

### Requirement: Arcane Dynamo passive
Arcane Dynamo SHALL be the visible Rune node-1 passive; Stored Essence SHALL remain as deprecated/hidden legacy data and SHALL NOT be available for new allocation.

#### Scenario: Successful player action refunds SP
- **WHEN** Rune is equipped and a basic attack hits or an active skill successfully resolves with Arcane Dynamo rank N
- **THEN** the character regains 2 × N SP, capped at max SP
- **AND** the event records the actual SP restored.

#### Scenario: Unsuccessful action does not trigger refund
- **WHEN** a basic attack misses, an action is illegal/out of range/cannot be paid for, or a status tick deals damage
- **THEN** Arcane Dynamo does not grant SP for that event.

### Requirement: Gambit has no implicit action or movement
The simulator SHALL only act or approach when a legal selected Gambit action requires it.

#### Scenario: No legal line is available
- **WHEN** every line relevant to the current gauge is false, illegal, on cooldown, or lacks SP
- **THEN** the gauge fire produces no action
- **AND** the combatant remains stationary unless an independently selected legal out-of-range action has active approach intent
- **AND** the movement gauge continues accumulating effective Move Speed regardless of that intent.

#### Scenario: Disarmed player has no legal basic attack
- **WHEN** the player is disarmed and their only eligible Gambit action is basic attack
- **THEN** the attack line is illegal
- **AND** it neither attacks nor starts/continues movement solely to approach the target
- **AND** only the player's Disarm behavior is changed; existing monster-specific Disarm movement behavior remains intact.

### Requirement: Monster cooldown and cast-time regression
Monster skill cooldowns SHALL block activation during the next `cooldownTicks` ticks after action resolution; cooldown time SHALL NOT overlap a new cast's cast time.

#### Scenario: Ice Bolt repeated casts
- **WHEN** Wailing Wraith uses Ice Bolt at cast time 2 and cooldown 1
- **THEN** the initial Ice Bolt resolves at T2
- **AND** the next activation is blocked at T3
- **AND** the next cast starts at T4, continues at T5, and resolves at T6
- **AND** following resolutions occur at T10, T14, and subsequent four-tick intervals
- **AND** cast progress does not advance during the blocked T3/T7 cooldown ticks
- **AND** the persisted battle log, API payload and frontend do not display duplicate Ice Bolt damage entries for one simulator event/tick.

### Requirement: Wailing Wraith preserves the approved conditional Gambit
The canonical Wailing Wraith Gambit SHALL retain `silence → attack` as its conditional attack line and Ice Bolt as the otherwise/default cast-gauge line. The frontend catalogue SHALL mirror that Wraith row/order without changing unrelated monster catalogue data.

#### Scenario: Wailing Wraith is silenced

- **WHEN** Wailing Wraith is silenced and its attack gauge evaluates the Gambit
- **THEN** the conditional `silence → attack` line is eligible and may execute if its action is otherwise legal.

#### Scenario: Wailing Wraith is not silenced

- **WHEN** Wailing Wraith is not silenced and its cast gauge evaluates the Gambit
- **THEN** Ice Bolt is the intended action and normal range, SP and sequential cooldown validation determines whether it is legal
- **AND** if Ice Bolt is illegal and no other cast-gauge line is legal, the Wraith performs no action rather than bypassing the Silence condition to make a basic attack.

### Requirement: Movement gauge charges independently from movement intent
The battle movement gauge SHALL start charging from battle start and accumulate effective Move Speed on every tick, independent of `movementIntent`. Actual movement SHALL remain gated by an active legal out-of-range approach intent.

#### Scenario: Move Speed 98 approaches from battle start

- **WHEN** a unit begins with Move Speed 98 and a legal selected action requires approaching an out-of-range target
- **THEN** its movement gauge reaches 98 at T1 and at least 100 at T2
- **AND** it completes its first movement at T2, moving no more than one space that tick and retaining the remaining gauge.

#### Scenario: Fast unit can move at T1

- **WHEN** a unit has effective Move Speed of at least 100 at battle start and a legal approach intent is active for T1's movement phase
- **THEN** it may complete one movement at T1.

#### Scenario: Gauge accumulates without a legal approach intent

- **WHEN** there is no active legal out-of-range approach intent
- **THEN** the gauge still accumulates each tick
- **AND** no movement occurs until an eligible intent exists
- **AND** accumulated gauge/overflow is retained rather than reset solely because intent is absent.

### Requirement: Existing Mastery allocations are reset without losing progression
The refinement SHALL clear every existing character's allocated skill ranks across all Mastery categories while preserving category XP and levels, so earned points are available for redistribution.

#### Scenario: One-time global rank reset

- **WHEN** the one-time data reset is applied to existing proficiency rows
- **THEN** every row retains its character/category identity, XP and Mastery level
- **AND** every row's `skillRanks` becomes empty and `spentSkillPoints` becomes zero
- **AND** category points earned from the preserved level become available for redistribution
- **AND** no category's XP or level is reset, and the reset is not automatically rerun at application startup.

#### Scenario: Reset one character with the cheat

- **WHEN** an authorized operator calls `POST /reset-skilltree/:characterName` with an exact, unambiguous character name
- **THEN** every category's allocated ranks for that character are cleared and all its spent skill points are refunded for redistribution
- **AND** every category's XP and level remain unchanged
- **AND** the operation is transactional and idempotent
- **AND** a missing/ambiguous name or unauthorized request is rejected without changing any character.

### Requirement: Monster mana and icon displays
Every current monster SHALL use its approved SP capacity, cost and regeneration, and its HUD SHALL reflect the event timeline rather than a client-side estimate.

#### Scenario: Monster resources
- **WHEN** an encounter begins
- **THEN** monsters start at 60 max SP, except Venom Viper/Wailing Wraith at 80, and regenerate 2 SP per 10 ticks
- **AND** skill costs are Enraged Strike 30, Regenerate 15, Ice Bolt 10, and Ground Slam 30 SP.

#### Scenario: Monster skill row
- **WHEN** a monster has skill actions in its Gambit
- **THEN** distinct skills are shown as icons below the log and above DROPS THIS SESSION, with hover/focus details and no adjacent text labels.
