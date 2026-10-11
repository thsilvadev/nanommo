# Proposal

## Why

The current Mastery tab is a placeholder, weapon proficiency is still modeled as legacy levels 1–50 with automatically unlocked skills, and hand compatibility/ATK behavior is split between item metadata and hard-coded rules. This change establishes one authoritative contract for hand equipment, Mastery progression, learnable abilities, Gambit eligibility and combat rewards before expanding the character build system.

## What Changes

- **BREAKING:** Replace the seven legacy proficiency categories and automatic level-based skill unlocks with eight Mastery categories, levels 0–10, per-category XP and spendable skill points.
- Add a right-handed/left-handed choice during character creation; keep semantic primary/secondary slots stable while mirroring their presentation.
- Make Sword, Dagger and Rod one-handed primary weapons; Greatsword, Bow and Staff two-handed weapons; allow Dagger as the only secondary-hand weapon; make Shield and Rune off-hand equipment. Disallow Sword + Sword and any off-hand item without a compatible one-handed primary.
- Count secondary weapon ATK at 50% while retaining its attributes, bonuses and effects in full; expose the reduced effective ATK in the equipped item tooltip.
- Add action-based Mastery XP, defensive Shield/Rune XP, configurable event values and a curve calibrated against the current character progression.
- Implement two skill nodes per Mastery category, passive and active effects, point allocation, combat snapshots, and Gambit learned-skill/equipment eligibility.
- Add three Rune tiers and three SVG icon proposals; rename Wand to Rod across the player-facing and persisted domain, catalogues, identifiers and documentation.
- Rebuild Mastery and Gambit UI around learned skills and known items; show the requested unavailable-Gambit warnings and navigation behavior.
- Reset every character's legacy Mastery progress and Gambit lines in an explicit migration while preserving unrelated character and economy data.
- Replace the old hit/avoidance formula with the agreed Accuracy/Evasion baselines and attribute scaling; add tier-dependent Accuracy penalties to bows.
- Update the root SPEC.md, openspec/specs/SPEC.md mirror, ARCHITECTURE.md and STATUS.md when this change is applied. Preserve the explicit roadmap for future PvE and PvP battles up to 5 vs 5.

## Dependency: battle-distance-movement

The user's in-battle distance/movement model has now been captured in the companion OpenSpec change `battle-distance-movement`. That change is a hard prerequisite and must be implemented before this one. It defines eight positions per lane, distance as empty spaces, snapshot-time RANGED classification, movement gauge/speed, out-of-range Gambit behavior, Slow/Ice Bolt, and deterministic position/movement logs.

This change consumes that contract for Blinkstrike (formerly Backstab), Shield Bash, Fearless Focus and Violent Shot. Heavy Swing and Fire Blast remain single-target for now; AoE and party targeting wait for future group combat. Do not implement a second or approximate position/range system inside this change.

## Capabilities

### New Capabilities
- hand-equipment-mastery-skills: Hand loadouts, handedness, Mastery XP/levels, skill trees/effects, Gambit choices and warnings, Rune/Rod catalogue migration, and combat integration contracts.

### Modified Capabilities
- No existing OpenSpec capability is registered in this repository yet. The canonical full-game SPEC.md and its openspec/specs/SPEC.md mirror will be updated during implementation as tracked documentation tasks.

## Impact

Expected areas: shared game types and deterministic battle simulator; API Character, Equipment, Gambit, Data and Battle services; TypeORM entities/migrations; items/skills/curve/vendor JSON; Character creation and Mastery/Gambits/Grind UI; item tooltips; tests; .env.example; SPEC.md, ARCHITECTURE.md and STATUS.md. The existing BattleService-owned future-combat mutation boundary remains authoritative: skill/equipment changes apply immediately to saved character state but must not mutate the active battle snapshot. Only stale future battles are invalidated, and rebuilding waits until the active battle resolves.
