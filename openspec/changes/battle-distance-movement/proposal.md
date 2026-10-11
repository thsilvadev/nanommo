# Proposal

## Why

The deterministic BattleEngine currently simulates combat without positions, distances or movement, so a Ranged/MELEE build has no tactical distance and range-dependent actions cannot be implemented honestly. This change introduces an eight-space battle lane, snapshot-time combat-style classification, per-unit movement speed and movement logs without adding a battle map UI or changing the current one-character-versus-one-monster encounter structure.

## What Changes

- Add eight ordered positions to every current battle lane. Each unit occupies exactly one position; distance is the number of empty positions between units (0–6).
- Add explicit combatStyle = melee | ranged to every monster definition and classify the character from valid enabled Foe Gambit actions plus the equipped Bow basic attack.
- Initialize MELEE-vs-MELEE combat adjacent in the two center spaces; when either combatant is RANGED, initialize them at opposite ends (positions 0 and 7).
- Add a deterministic movement gauge independent of attack/cast gauges. Character base Move Speed is 50 + character level; monsters use a per-type level-1 base plus level - 1. One step is earned per 100 accumulated movement-speed points.
- If the next selected valid attack/skill/item is out of range, do not execute it, spend SP/item quantity or start its cooldown; set a movement intent toward the target. Ranged actions remain usable at distance according to explicit reach metadata.
- Add position, distance, move-speed, movement and range information to the deterministic battle log, without rendering the eight-space lane in the UI yet.
- Add Slow as a timed flat -50 Move Speed status lasting 20 seconds; give Wailing Wraith a ranged magic Ice Bolt action that applies Slow.
- Set Field Bat and Dune Raider as initial ranged-physical monster examples; set Wailing Wraith as ranged-magical; all other current monsters are explicitly melee-physical.
- Add exact range contracts for current one-on-one combat, Blinkstrike, Shield Bash, Fearless Focus and Violent Shot. Keep multi-target AoE, line changes and party targeting out of scope.
- Preserve the intended future architecture for five parallel lanes in 5x5 PvE/PvP, without implementing groups, ally targeting, cross-lane movement or the eight-space visualization in this change.

## Dependencies and interaction with Mastery change

This change must be implemented before hand-equipment-mastery-skills. After its contract is approved, update that change to depend on this change and remove the unresolved distance/movement gaps. The Mastery change will implement skill-specific effects against the positional API established here, including Blinkstrike relocation, Fearless Focus distance scaling and Violent Shot push-to-six-spaces. Heavy Swing and Fire Blast remain single-target for the current simulator; future AoE waits for group combat.

The current Monster gambit field and the shared Gambit evaluator already exist. This change extends their semantics for range and adds Ice Bolt to Wailing Wraith's own Gambit; it does not create a second monster-AI system.

## Capabilities

### New Capabilities
- battle-distance-movement: Position, range, movement gauges, combat-style classification, movement/status logs, monster combat styles and movement-related ability integration points.

### Modified Capabilities
- No canonical OpenSpec capability registry exists in this repository yet. Root SPEC.md and ARCHITECTURE.md are updated by tracked tasks when this change is approved/applied.

## Impact

Shared BattleEngine snapshots, tick loop, deterministic logs and tests; API BattleService snapshot construction; monsters.json, skill_trees.json, items.json range metadata and mirrored frontend data; movement-speed calculation and status effects; root SPEC.md, ARCHITECTURE.md, and STATUS.md. No UI lane visualization and no production deployment are included.
