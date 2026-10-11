# Proposal

## Why

The deterministic BattleEngine currently simulates combat without positions, distances or movement, so a Ranged/MELEE build has no tactical distance and range-dependent actions cannot be implemented honestly. This change introduces an eight-space battle lane, snapshot-time combat-style classification, per-unit movement speed and movement logs without adding a battle map UI or changing the current one-character-versus-one-monster encounter structure.

## What Changes

- Add eight ordered positions to every current battle lane. Each unit occupies exactly one position; distance is the number of empty positions between units (0–6).
- Add explicit combatStyle = melee | ranged to every monster definition and classify the character from valid enabled Foe Gambit actions plus the equipped Bow basic attack.
- Initialize MELEE-vs-MELEE combat adjacent in the two center spaces; when either combatant is RANGED, initialize them at opposite ends (positions 0 and 7).
- Add a deterministic movement gauge independent of attack/cast gauges. Character base Move Speed is 50 + character level; monsters use a per-type level-1 base plus level - 1. One step is earned per 100 accumulated movement-speed points.
- If the next selected valid attack/skill/item is out of range, do not execute it, spend SP/item quantity or start its cooldown; set a movement intent toward the target. Ranged actions remain usable at distance according to explicit reach metadata.
- Add position, distance, move-speed, completed movement and status information to the deterministic battle log, without rendering the eight-space lane in the UI yet. Out-of-range decisions set movement intent but do not create standalone `range_blocked` log events.
- Preserve Slow as a reusable timed -50 Move Speed status lasting 20 seconds. Wailing Wraith gains a zero-SP, one-second-cast, zero-cooldown ranged magic Ice Bolt with target-inclusive `maxRange: 7`; each successful cast has a 25% chance to add one independently expiring five-second Freeze stack to the player (-15 Move Speed per stack, max five).
- Set Field Bat and Dune Raider as ranged-physical monsters; Wailing Wraith is classified RANGED because Ice Bolt is ranged, but retains an adjacent-only melee physical basic attack. While Ice Bolt is usable the Wraith remains stationary; its fallback attack line is conditioned on Silence, allowing it to approach and attack only while silenced. Reduce every monster's previously calibrated Evasion by 10%, rounded to the nearest integer; all other monsters remain melee-physical.
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
