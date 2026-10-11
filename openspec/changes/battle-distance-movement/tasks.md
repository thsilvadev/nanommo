# Tasks

## 1. Define and validate battle-unit snapshots

- [ ] 1.1 Extend the shared combatant snapshot with lane position, combatStyle, basic-attack damage/range metadata, movement gauge, movement intent and base/effective Move Speed; verify type/build tests cover both player and monster snapshots.
- [ ] 1.2 Add an explicit combat-style derivation step for the character from enabled valid Foe Gambit lines, equipped Bow basic attacks, learned/equipped ranged skills and in-stock ranged items; verify Ally/self lines, disabled lines and unavailable actions never classify the player as RANGED.
- [ ] 1.3 Add explicit combatStyle and moveSpeedBase fields to every current monsters.json row, assigning Field Bat/Dune Raider as ranged physical, Wailing Wraith as ranged magic, and all remaining monsters as melee physical; verify a catalog validation test rejects missing/invalid style/speed.
- [ ] 1.4 Add JSON-backed monster move speed constants by archetype and level scaling (constant + level - 1); verify the speed remains independent of atkSpeedTicks and varies only according to its catalog definition and level.

## 2. Positions and movement gauge

- [ ] 2.1 Initialize the eight-space lane: MELEE/MELEE at positions 3/4; any RANGED combatant at positions 0/7; verify all four player/monster style pairings with deterministic tests.
- [ ] 2.2 Implement distance as max(0, abs(positionA - positionB) - 1) and validate bounds/occupancy; verify adjacency is distance 0, endpoints are distance 6, and no two units can occupy one position.
- [ ] 2.3 Implement character Move Speed 50 + level and the independent movement gauge; verify level-1 starts at 51, each character level adds one, gauge reaches one step per 100 points, overflow is preserved, and no more than one step occurs per tick.
- [ ] 2.4 Implement movement intent from a selected otherwise-legal out-of-range action; do not spend SP, consume items or start cooldowns; verify no fallback to lower priority on the same gauge fire and that a later in-range ranged action clears stale approach intent.
- [ ] 2.5 Resolve movement in the deterministic post-action phase, with character movement before monster movement and new positions affecting range checks next tick; verify opposing movements, a single empty space, lane edge, occupied next position and target death do not create overlaps or infinite movement.
- [ ] 2.6 Freeze style/positions/gauges/intent into the battle snapshot and never alter the currently active battle after Character/Gambit/equipment mutations; verify only future snapshots are invalidated through the existing BattleService mutation boundary.

## 3. Range metadata, Gambit and combat behavior

- [ ] 3.1 Add explicit action range/target metadata and apply range checks to basic attacks, skills and items while retaining existing Gambit priority/legality rules; verify Foe ranged actions count toward entry position but Ally/self support does not.
- [ ] 3.2 Treat Bow basic attack as ranged and all declared melee basic attacks/skills as usable only on the target immediately in front at distance 0; verify at-range attacks execute normally and out-of-range attacks cause movement instead.
- [ ] 3.3 Add range-blocked log events with attempted action, required range and actual distance; verify such events do not record damage or resource/cooldown spending.
- [ ] 3.4 Add position and movement fields to the battle log, including start/end positions, move speed, distance before/after and reason; verify the same snapshot+seed yields identical positions/events/logs.
- [ ] 3.5 Ensure every current monster has a valid Gambit and preserve existing monster behavior unless explicitly changed; verify the shared Gambit evaluator remains the single action-selection system.

## 4. Slow and Wailing Wraith Ice Bolt

- [ ] 4.1 Add canonical timed Slow state with -50 effective Move Speed for 20 seconds; verify speed clamps at zero and the same Slow refreshes duration instead of stacking penalties.
- [ ] 4.2 Add monster_skill_ice_bolt using Wailing Wraith's MATK as magic damage and applying Slow on a successful spell; add the selected Wailing Wraith Gambit line(s) and JSON timing values; verify damage type, slow duration and cooldown behavior in the deterministic engine.
- [ ] 4.3 Add regression coverage for Wraith at ranged starting position, Ice Bolt cast and Slow effect while preserving its intended fallback behavior; verify other monsters do not acquire Ice Bolt unless explicitly configured.

## 5. Mastery integration

- [ ] 5.1 Update hand-equipment-mastery-skills to depend on this change, rename Backstab to Blinkstrike, define the exact front-of-target relocation, make Violent Shot push to distance 6, set Shield Bash to distance 0 and wire Fearless Focus to authoritative attack distance; verify each contract uses this change's position API.
- [ ] 5.2 Keep Heavy Swing and Fire Blast single-target and exclude party/AoE behavior until an approved multi-target proposal; verify no cloned extra target damage is emitted.
- [ ] 5.3 Implement the approved hit formula clamp(100 + Precision - Evasion, 5, 95); recalibrate monster stats to the same scale and validate Bow penalties -75/-74/-73 with representative hit-rate tests. Validate the total-DEX precision formula against starting values and record the DEX-225 / DEX-228 checkpoint decision.

## 6. Documentation and integration verification

- [ ] 6.1 Update root SPEC.md and openspec/specs/SPEC.md mirror with lane, range, combatStyle, move speed, Slow/Ice Bolt and immutable-log rules; verify no conflict with active Gambit, status-effect or future-combat mutation contracts.
- [ ] 6.2 Update ARCHITECTURE.md with movement-gauge ownership, deterministic tick ordering, position snapshot/log fields and future five-lane 5x5 direction; verify no claim that group combat or lane UI exists now.
- [ ] 6.3 Add focused unit tests for distance, entry classification, position initialization, movement speed/gauge, range blocked actions, Slow refresh/expiry, Ice Bolt, logs and determinism; verify the focused suite passes.
- [ ] 6.4 Run shared/API/frontend builds, focused tests, strict OpenSpec validation and git diff --check; verify this change is complete before applying hand-equipment-mastery-skills.
- [ ] 6.5 Update STATUS.md with files changed, tests actually executed and any runtime checks unavailable; verify no production deployment is claimed unless it was performed.
