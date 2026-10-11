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

Initial catalog assignment: mon_fieldbat and mon_duneraider are ranged physical; mon_wraith (display name Wailing Wraith) is classified RANGED because its valid Foe Gambit casts ranged magical Ice Bolt, while its fallback basic attack is melee physical and only executes when adjacent. Wailing Wraith stays stationary while Ice Bolt is legal and in range. Its second Gambit line is `silence -> attack`; it is selected only while Ice Bolt is illegal because of Silence, then the monster approaches if the player is not adjacent. All other existing monsters are explicitly MELEE with physical basic attacks. Monster Evasion values in the catalog are 90% of the previously calibrated values, rounded to the nearest integer.

### 3. Range contract and action evaluation

All actions declare targeting/range metadata in their data definition rather than relying on display names. For the current two-combatant single lane:
- Melee basic attacks and melee skills can execute only when their target is in the space directly in front, meaning adjacent with distance 0.
- Bow basic attack is ranged.
- An explicitly ranged skill or item can execute across the lane to distance 6 unless it declares a smaller maximum.
- Blinkstrike is declared RANGED for entry-classification purposes and can be selected at any distance; its actual reposition is defined in the dependent Mastery change.
- Shield Bash is a melee passive attack against the enemy in front; it can proc only when the enemy's successful incoming basic attack occurred at melee distance (0). It does not independently move the Shield user.
- Foe versus Ally/self targeting is retained in action metadata; Ally/self ranged support never classifies a character as RANGED.

When a gauge fires, keep current Gambit semantics: scan enabled lines in priority order, checking conditions and ordinary legality. If the first selected action is legal except that its target is outside its declared range, do not execute it and do not fall through to a lower-priority line on that same gauge fire. Set/update the actor's movement intent toward that target. No SP is spent, no item is consumed and no cooldown is started until a later in-range execution succeeds. Do not emit a `range_blocked` battle-log event; the movement event is enough to explain that approach occurred. An action illegal for a different reason (unlearned, wrong weapon, no item quantity, cooldown, insufficient SP, or Silence) remains skipped under existing Gambit rules.

A movement intent represents approach to the selected target for the out-of-range action. Re-evaluate/replace/clear it whenever a later attack/cast gauge selects a new actionable goal, when the intended action becomes executable, or when the target becomes adjacent. If a ranged action is selected and is in range, it clears stale approach intent so a character with a valid ranged fallback does not keep walking into melee unnecessarily.

### 4. Movement speed and gauge

The character's base Move Speed is 50 + level, so a level-1 character has 51. Add moveSpeedBase to monster catalog records; the effective monster speed is moveSpeedBase + (monster.level - 1). This makes the per-monster constant explicit, tunable and independent of attack speed. Initial level-1 defaults in monsters.json are: Slime 40, Field Bat 62, Thorn Sprout 45, Mud Crawler 40, Dire Wolf Alpha 60, Sand Scorpion 48, Dune Raider 58, Cinder Golem 35, Venom Viper 55, Mirage Stalker 60, Broken Sentinel 40, Wailing Wraith 56, Arcane Wisp 65, Bone Knight 44, and Ruins Guardian 35. These are provisional balancing values, each increased by level - 1, so they can be tuned directly in JSON.

Effective Move Speed for a tick is base/level speed plus active flat/percentage modifiers from equipment/statuses, clamped to a minimum of 0. Current passives do not affect Move Speed. Future boots/wings may supply bonuses through the same modifier path. The same effective Move Speed stat is reserved for a future FLEE system, but this change does not implement fleeing. Slow remains a reusable canonical `statusEffects` type for other skills: it contributes -50 Move Speed for 20 seconds, and reapplication refreshes the same Slow status rather than stacking independent -50 effects. Freeze is a separate status type. Each successful Wailing Wraith Ice Bolt has a seeded 25% chance to add one Freeze stack to the character. Each stack independently expires 5 ticks (seconds) after application and reduces Move Speed by 15; at most five active Freeze stacks are allowed, for a total -75 modifier. Active Slow and Freeze modifiers are additive and effective Move Speed is clamped to zero.

Use a separate integer movement gauge for each combatant. Once per one-second simulation tick, while movement intent exists and movement is not blocked, add effective Move Speed. When the gauge reaches 100, perform one step and subtract 100, preserving overflow; more than one step per tick is not allowed, even if gauge exceeds 200. If no movement intent exists, the gauge does not accrue; preserve accumulated remainder. If the next lane position is occupied, do not move and retain/retry the intent while the unit remains out of range. Clear movement intent on reaching action range or on target death.

Movement resolves in a deterministic post-action phase at the end of each tick. An action on tick N uses positions at the beginning of tick N; a movement step resolved at the end of tick N changes position for action checks on tick N+1. This avoids order-dependent mid-tick range changes. Character movement is processed before monster movement for tie-breaks; a unit cannot enter an occupied position, so two units cannot overlap. Movement itself has no attack/cast cooldown and does not grant weapon Mastery XP.

### 5. Logs and immutable snapshots

Battle snapshot header records each unit's starting position, combat style, base/effective Move Speed and starting movement gauge. A completed movement event includes tick, actor, fromPosition, toPosition, `spacesMoved`, direction, distanceBefore, distanceAfter, moveSpeed and reason. Do not emit `range_blocked` events: the movement event is the only log line needed for approach. Freeze status application events use actor `character`, action `freeze_applied`, and stack count so the frontend can render `CharacterName is freezing (N)`. Slow remains a distinct reusable status event; expiry of Slow and each Freeze stack is logged as `status_expired` at its exact tick. The Character summary derives current Freeze stacks and remaining time from the active immutable log timeline and shows one icon/tooltip. No client-authored status or movement state is used.

Positions, style, movement gauge, intent and status-effect timers are part of the immutable precomputed battle snapshot/log. Changes to current Character stats/Gambits/equipment during a battle do not mutate the battle already in progress. Use the existing BattleService-owned future-combat mutation boundary for rebuilding future queue entries after the active battle finishes.

### 6. Current monster catalog changes

Add combatStyle and moveSpeedBase to all existing monster rows. Field Bat (mon_fieldbat) and Dune Raider (mon_duneraider) have ranged physical basics. Wailing Wraith (mon_wraith) is RANGED because its Foe Gambit uses magical Ice Bolt, but its basic attack is melee physical and only works at distance 0. Every other current monster is MELEE with physical basic attacks. Monster Evasion values are reduced by 10% from the previously calibrated catalog values, rounded to the nearest integer. Use the existing Gambit model for monster behaviour.

Configure monster_skill_ice_bolt in skill_trees.json as magical and ranged, with `maxRange: 7` inclusive of the target's occupied space. Runtime range converts it to empty-space distance 6, the maximum distance from position 0 to 7. Damage uses Wailing Wraith's MATK with a 1.0 multiplier. Ice Bolt costs 0 SP, has `baseCastTicks: 2` and `cooldownTicks: 0`; the monster does not spend SP. Each successful cast has a seeded 25% chance to add one `freeze` status stack to the character, not the monster. Each stack applies -15 Move Speed for 5 ticks (seconds), expires independently, and stacks to at most five active entries (-75 total). Freeze is distinct from the reusable Slow status, which remains -50 for 20 seconds and refreshes instead of stacking. Wailing Wraith's Gambit keeps Ice Bolt as its first enabled `Foe` action and a `self_has_status(silence) -> attack` fallback. While Ice Bolt is legal and in range, the Wraith stays stationary. If Silenced, Ice Bolt is illegal and the fallback approaches if the player is not adjacent, then uses its melee basic attack. Ice Bolt is the only monster that receives this skill in this change.

### 7. Integration points for hand/Mastery abilities

This change owns the position/movement API used by the first change:
- Blinkstrike (renamed from Backstab): active ranged-classified skill, usable at any distance; if not already immediately in front of the target, move the character to the position directly in front of the target and apply the physical hit in that action; if already in that position, attack without moving. No critical roll, additional SP cost or separate movement action is added. If the front position is occupied in future group battles, the first change must define a safe failure/alternate-position policy before implementation of groups.
- Shield Bash: passive melee response only when the incoming attack was landed at distance 0.
- Fearless Focus: per-space damage/Precision scaling reads the authoritative distance at the moment the basic attack resolves.
- Violent Shot: after damage resolution, push the target away until the distance reaches 6 (maximum separation for eight positions); if already at distance 6 or no legal step exists toward the lane boundary, no additional movement occurs.
- Heavy Swing and Fire Blast remain single-target in the current simulator. Their future AoE behavior is explicitly out of scope until a group-combat change defines target sets and damage ordering.

### 8. Approved Accuracy/Evasion formula

The hit formula is approved as `hitChance% = clamp(100 + Precision - Evasion, 5, 95)`. It gives 80% hit / 20% miss at Precision 80 vs Evasion 100. Preserve deterministic seeded rolling. Monster Accuracy/Evasion values were calibrated to this scale, then the Evasion column was reduced a further 10% from the previously calibrated values (nearest-integer rounding) per the latest balance adjustment. Representative hit-rate balance testing remains required before release. The dependent Mastery change defines the approved total-attribute Precision/Evasion formulas and records the remaining one-point arithmetic discrepancy between DEX 225 and the requested hit target.

## Risks / Trade-offs

- [Out-of-range Gambit actions do not produce their own log line] → Keep priority blocking and movement intent; log the actual movement only, without a noisy `range_blocked` event.
- [Two units could overlap at the same position] → Use one-step movement, fixed deterministic move resolution order and occupied-space checks.
- [Monster hit rates shift after tuning] → Monster Evasion has been recalibrated to the approved scale and then reduced by 10%; review representative hit rates during balance testing.
- [Status effects overlap] → Keep Slow as one refreshable canonical status and each Freeze stack as its own independently expiring entry; cap active Freeze at five stacks.
- [Future group model diverges] → Keep lane+position semantics and explicit out-of-scope line/target selection rather than pretending one-on-one simulation is already 5x5.

## Migration Plan

1. Add required monster combatStyle and moveSpeedBase to all current definitions; validate all rows have both and recalibrate Evasion by -10% from the prior calibrated catalog.
2. Configure Ice Bolt's range/timing/Freeze effect and Wailing Wraith Gambit fallback, preserving other monster behavior.
3. Extend pure simulator snapshots/events with position, style, movement gauge/intent, range and status-speed modifiers. Log completed movement and status application, not `range_blocked` decisions.
4. Add deterministic regression tests for entry formations, approach steps, Freeze chance/stacks/expiry/speed penalty, Wraith's stationary casts and Silenced fallback, Slow retention, and log determinism.
5. Update current first-change contracts to use the shared distance interface; only then allow hand-equipment-mastery-skills to proceed.
6. Roll back by reverting catalog/schema code changes together; no persistent character/map data migration is required for the current runtime-local battle positions.

## Open Questions

- The initial monster Move Speed constants remain balance knobs. Ice Bolt timing and Freeze semantics are now fixed: 1 tick cast, zero cooldown and SP cost, `maxRange: 7` inclusive of the target's space, a seeded 25% chance per successful cast, and independently expiring 5-second Freeze stacks (-15 Move Speed each, capped at five).
- The Accuracy/Evasion formula is approved and monster Evasion was recalibrated and reduced by 10%; representative character-versus-monster hit-rate balance testing remains a release check.
