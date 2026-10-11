# Design

## Context

See proposal.md for motivation and scope. The shared simulator in packages/shared/src/battle-engine/index.ts currently holds separate attack/cast gauges, simulates one character against one monster, and emits deterministic events with tick/HP state. Monster definitions in monsters.json already contain their own Gambit; monster skills are defined in skill_trees.json.

## Goals / Non-Goals

**Goals**
- Make positions, range checks, approach movement, and movement debuffs server-authoritative and deterministic.
- Keep movement state local to a single battle simulation and serialize enough information to explain all decisions in the log.
- Define stable IDs and semantics that a later 5x5 implementation can extend.

**Non-Goals**
- Battle-lane visualization, animations or frontend movement controls.
- Current multi-target attacks, allies, party AI, target switching, PvP or 5x5 runtime.
- Movement between lanes, flanking, line changes, terrain/obstacles, flee resolution, boots/wings bonuses now.
- Rewriting monster Gambits into a new AI engine.

## Decisions

### 1. Lane and distance representation

Every current duel uses a lane with eight positions indexed 0–7. Each combatant occupies one integer position, never two. Distance is the count of empty positions strictly between the two unit positions: max(0, abs(positionA - positionB) - 1). Adjacent positions therefore have distance 0; endpoints 0 and 7 have distance 6.

The character occupies the left side and monster the right side. For MELEE vs MELEE, initial positions are 3 and 4. If either side classifies as RANGED, initial positions are 0 and 7. Position snapshots and each subsequent movement are included in the log header/events; the frontend does not render the spaces in this change.

Future 5x5 battles may map each combatant to a lane plus position, with each lane having eight spaces. No cross-lane movement or multi-target semantics are defined by this change.

### 2. Combat-style classification

For the player, derive and freeze combatStyle when a battle snapshot is built. Classify as RANGED when at least one enabled Foe-target Gambit line contains an available ranged action:
- attack counts as ranged if the equipped main-hand weapon is a Bow.
- use_skill counts when the skill is learned, its required weapon/equipment is present, and its definition declares a ranged attack.
- use_item counts when the item is present in Inventory with positive quantity and the definition declares a ranged action.
- The action must target Foe, not Ally/self.
- Do not require the Gambit condition to be currently true, SP to be currently sufficient, or cooldown to be ready; those states fluctuate during battle. A disabled line or action missing its required equipment/item does not qualify.

This definition looks at any valid enabled Foe line; it does not choose only the first/highest-priority line. A character can therefore begin RANGED and still approach immediately if its next selected action is melee and out of range. This is deliberate and must be covered by a regression test.

For monsters, use the explicit catalog field combatStyle: "melee" | "ranged"; do not infer it from lore, stats or Gambit contents. Each row has basicAttackDamageType (melee physical, ranged physical, or magic), basicAttackRange (0 for adjacent-only, up to 6 for lane-range actions) and moveSpeedBase. These metadata fields have now been added to root monsters.json and apps/frontend/public/data/monsters.json; the current engine does not consume them until this change is implemented. All monster entries must carry the explicit style after migration.

Initial catalog assignment: mon_fieldbat and mon_duneraider are ranged physical; mon_wraith (display name Wailing Wraith) is classified RANGED because its valid Foe Gambit casts ranged magical Ice Bolt, while its fallback basic attack remains melee physical and only executes when adjacent; all other existing monsters are explicitly MELEE with physical basic attacks. Keep their existing custom Gambit priority lines unless explicitly changed for Ice Bolt.

### 3. Range contract and action evaluation

All actions declare targeting/range metadata in their data definition rather than relying on display names. For the current two-combatant single lane:
- Melee basic attacks and melee skills can execute only when their target is in the space directly in front, meaning adjacent with distance 0.
- Bow basic attack is ranged.
- An explicitly ranged skill or item can execute across the lane to distance 6 unless it declares a smaller maximum.
- Blinkstrike is declared RANGED for entry-classification purposes and can be selected at any distance; its actual reposition is defined in the dependent Mastery change.
- Shield Bash is a melee passive attack against the enemy in front; it can proc only when the enemy's successful incoming basic attack occurred at melee distance (0). It does not independently move the Shield user.
- Foe versus Ally/self targeting is retained in action metadata; Ally/self ranged support never classifies a character as RANGED.

When a gauge fires, keep current Gambit semantics: scan enabled lines in priority order, checking conditions and ordinary legality. If the first selected action is legal except that its target is outside its declared range, do not execute it and do not fall through to a lower-priority line on that same gauge fire. Set/update the actor's movement intent toward that target. No SP is spent, no item is consumed and no cooldown is started until a later in-range execution succeeds. An action illegal for a different reason (unlearned, wrong weapon, no item quantity, cooldown or insufficient SP) remains skipped under existing Gambit rules.

A movement intent represents approach to the selected target for the out-of-range action. Re-evaluate/replace/clear it whenever a later attack/cast gauge selects a new actionable goal, when the intended action becomes executable, or when the target becomes adjacent. If a ranged action is selected and is in range, it clears stale approach intent so a character with a valid ranged fallback does not keep walking into melee unnecessarily.

### 4. Movement speed and gauge

The character's base Move Speed is 50 + level, so a level-1 character has 51. Add moveSpeedBase to monster catalog records; the effective monster speed is moveSpeedBase + (monster.level - 1). This makes the per-monster constant explicit, tunable and independent of attack speed. Initial level-1 defaults in monsters.json are: Slime 40, Field Bat 62, Thorn Sprout 45, Mud Crawler 40, Dire Wolf Alpha 60, Sand Scorpion 48, Dune Raider 58, Cinder Golem 35, Venom Viper 55, Mirage Stalker 60, Broken Sentinel 40, Wailing Wraith 56, Arcane Wisp 65, Bone Knight 44, and Ruins Guardian 35. These are provisional balancing values, each increased by level - 1, so they can be tuned directly in JSON.

Effective Move Speed for a tick is base/level speed plus active flat/percentage modifiers from equipment/statuses, clamped to a minimum of 0. Current passives do not affect Move Speed. Future boots/wings may supply bonuses through the same modifier path. The same effective Move Speed stat is reserved for a future FLEE system, but this change does not implement fleeing. A Slow effect contributes -50 Move Speed for 20 seconds; repeated Slow applications refresh the existing Slow duration rather than stacking independent -50 effects.

Use a separate integer movement gauge for each combatant. Once per one-second simulation tick, while movement intent exists and movement is not blocked, add effective Move Speed. When the gauge reaches 100, perform one step and subtract 100, preserving overflow; more than one step per tick is not allowed, even if gauge exceeds 200. If no movement intent exists, the gauge does not accrue; preserve accumulated remainder. If the next lane position is occupied, do not move and retain/retry the intent while the unit remains out of range. Clear movement intent on reaching action range or on target death.

Movement resolves in a deterministic post-action phase at the end of each tick. An action on tick N uses positions at the beginning of tick N; a movement step resolved at the end of tick N changes position for action checks on tick N+1. This avoids order-dependent mid-tick range changes. Character movement is processed before monster movement for tie-breaks; a unit cannot enter an occupied position, so two units cannot overlap. Movement itself has no attack/cast cooldown and does not grant weapon Mastery XP.

### 5. Logs and immutable snapshots

Battle snapshot header records each unit's starting position, combat style, base/effective Move Speed and starting movement gauge. Movement events include tick, actor, action: "move", fromPosition, toPosition, distanceBefore, distanceAfter, moveSpeed and reason (e.g. approach_out_of_range_action). Range-blocked action events record attempted action ID, target distance and required range without recording damage/resource costs.

Status events record Slow application and expiration; moveSpeed on the corresponding log snapshot reflects the currently effective value. Logs must be adequate to replay/display movement later, without introducing front-end timers or client-authoritative position state.

Positions, style, movement gauge, intent and status-effect timers are part of the immutable precomputed battle snapshot/log. Changes to current Character stats/Gambits/equipment during a battle do not mutate the battle already in progress. Use the existing BattleService-owned future-combat mutation boundary for rebuilding future queue entries after the active battle finishes.

### 6. Current monster catalog changes

Add combatStyle and moveSpeedBase to all existing monster rows. Initial ranged physical monsters are Field Bat (mon_fieldbat) and Dune Raider (mon_duneraider). Wailing Wraith (mon_wraith) is RANGED because its Foe Gambit uses magical Ice Bolt, and its basic attack also deals ranged magic damage. Every other current monster is MELEE with physical basic attacks. Use the existing Gambit model for their behavior.

Add monster_skill_ice_bolt to skill_trees.json monsterSkills, declared magical and ranged with maximum range 6. Its damage uses Wailing Wraith's MATK with a 1.0 multiplier and applies Slow (-50 Move Speed, 20 seconds) on a successful spell resolution. Active abilities do not roll Accuracy/Evasion or critical hits except future explicitly defined immunity/resistance cases. The current monster engine does not spend monster SP. Add Ice Bolt as the first enabled Foe action in Wailing Wraith's existing Gambit; retain its existing attack fallback so the normal attack/cast gauges still use the one shared monster Gambit. Proposed Ice Bolt cooldown is 20 ticks (the same as Slow duration), configurable in JSON; it uses the current monster cast-gauge timing unless a future monster-casting change defines per-skill cast times. Do not give Ice Bolt to other monsters in this change.

### 7. Integration points for hand/Mastery abilities

This change owns the position/movement API used by the first change:
- Blinkstrike (renamed from Backstab): active ranged-classified skill, usable at any distance; if not already immediately in front of the target, move the character to the position directly in front of the target and apply the physical hit in that action; if already in that position, attack without moving. No critical roll, additional SP cost or separate movement action is added. If the front position is occupied in future group battles, the first change must define a safe failure/alternate-position policy before implementation of groups.
- Shield Bash: passive melee response only when the incoming attack was landed at distance 0.
- Fearless Focus: per-space damage/Precision scaling reads the authoritative distance at the moment the basic attack resolves.
- Violent Shot: after damage resolution, push the target away until the distance reaches 6 (maximum separation for eight positions); if already at distance 6 or no legal step exists toward the lane boundary, no additional movement occurs.
- Heavy Swing and Fire Blast remain single-target in the current simulator. Their future AoE behavior is explicitly out of scope until a group-combat change defines target sets and damage ordering.

### 8. Approved Accuracy/Evasion formula

The hit formula is approved as `hitChance% = clamp(100 + Precision - Evasion, 5, 95)`. It gives 80% hit / 20% miss at Precision 80 vs Evasion 100. Preserve deterministic seeded rolling. Monster Accuracy/Evasion values must be calibrated to this same scale before implementation; reusing the current low monster Evasion values would cause most player attacks to clamp at 95% hit and make Bow penalties poorly balanced. The dependent Mastery change defines the approved total-attribute Precision/Evasion formulas and records the remaining one-point arithmetic discrepancy between DEX 225 and the requested hit target.

## Risks / Trade-offs

- [Out-of-range Gambit actions block lower priorities] → This preserves priority intent; cover the behavior with an explicit regression test and logs explaining the blocked range.
- [Two units could overlap at the same position] → Use one-step movement, fixed deterministic move resolution order and occupied-space checks.
- [Monster stats stay on old scale] → Add a balance/calibration test for hit rates and use explicit monster stat rebalancing if the new hit formula is adopted.
- [Slow stacks unintentionally] → Store one canonical Slow status and refresh its expiry on reapplication.
- [Future group model diverges] → Keep lane+position semantics and explicit out-of-scope line/target selection rather than pretending one-on-one simulation is already 5x5.

## Migration Plan

1. Add required monster combatStyle and moveSpeedBase to all current definitions; validate all rows have both.
2. Add Ice Bolt data and Wailing Wraith Gambit configuration while preserving all other monster Gambit behavior.
3. Extend pure simulator snapshots/events with position, style, movement gauge/intent, range and status-speed modifiers.
4. Add deterministic regression tests for entry formations, range blocking, approach steps, opposing movement, Slow, push-to-six and Blinkstrike positioning.
5. Update current first-change contracts to use the shared distance interface; only then allow hand-equipment-mastery-skills to proceed.
6. Roll back by reverting catalog/schema code changes together; no persistent character/map data migration is required for the current runtime-local battle positions.

## Open Questions

- The initial monster Move Speed constants and Ice Bolt's cast/cooldown ticks are balance knobs. Proposed starting values are a per-archetype 50-ish level-1 Move Speed constant and a spell timing close to the existing monster cast gauge; adjust the JSON defaults during review if specific numbers are desired. No new targeting/group rules depend on those values.
- The Accuracy/Evasion formula is approved; implementation must recalibrate monster stats to the new scale and test character-versus-monster hit rates before release.
