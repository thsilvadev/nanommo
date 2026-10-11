# Tasks

## 1. Define and validate battle-unit snapshots

- [x] 1.1 Extend the shared combatant snapshot with lane position, combatStyle, basic-attack damage/range metadata, movement gauge, movement intent and base/effective Move Speed; shared/API builds passed.
- [ ] 1.2 Add an explicit combat-style derivation step for the character from enabled valid Foe Gambit lines, equipped Bow basic attacks, learned/equipped ranged skills and in-stock ranged items; verify Ally/self lines, disabled lines and unavailable actions never classify the player as RANGED.
- [x] 1.3 Add explicit combatStyle and moveSpeedBase fields to every current monsters.json row, assigning Field Bat/Dune Raider as ranged physical, Wailing Wraith as ranged due to ranged magic Ice Bolt with a melee physical basic attack, and all remaining monsters as melee physical; committed catalog assertions cover all 15 rows, the -10% Evasion adjustment, and matching mirrors.
- [ ] 1.4 Add JSON-backed monster move speed constants by archetype and level scaling (constant + level - 1); verify the speed remains independent of atkSpeedTicks and varies only according to its catalog definition and level.

## 2. Positions and movement gauge

- [x] 2.1 Initialize the eight-space lane: MELEE/MELEE at positions 3/4; any RANGED combatant at positions 0/7; committed regression test verifies all four player/monster style pairings.
- [ ] 2.2 Implement distance as max(0, abs(positionA - positionB) - 1) and validate bounds/occupancy; verify adjacency is distance 0, endpoints are distance 6, and no two units can occupy one position.
- [ ] 2.3 Implement character Move Speed 50 + level and the independent movement gauge; verify level-1 starts at 51, each character level adds one, gauge reaches one step per 100 points, overflow is preserved, and no more than one step occurs per tick.
- [ ] 2.4 Implement movement intent from a selected otherwise-legal out-of-range action; do not spend SP, consume items or start cooldowns; verify no fallback to lower priority on the same gauge fire and that a later in-range ranged action clears stale approach intent.
- [ ] 2.5 Resolve movement in the deterministic post-action phase, with character movement before monster movement and new positions affecting range checks next tick; verify opposing movements, a single empty space, lane edge, occupied next position and target death do not create overlaps or infinite movement.
- [ ] 2.6 Freeze style/positions/gauges/intent into the battle snapshot and never alter the currently active battle after Character/Gambit/equipment mutations; verify only future snapshots are invalidated through the existing BattleService mutation boundary.

## 3. Range metadata, Gambit and combat behavior

- [ ] 3.1 Add explicit action range/target metadata and apply range checks to basic attacks, skills and items while retaining existing Gambit priority/legality rules; verify Foe ranged actions count toward entry position but Ally/self support does not.
- [ ] 3.2 Treat Bow basic attack as ranged and all declared melee basic attacks/skills as usable only on the target immediately in front at distance 0; verify at-range attacks execute normally and out-of-range attacks cause movement instead.
- [x] 3.3 Do not emit range-blocked log events; retain movement intent without spending SP/items or starting cooldown, and cover no-range-blocked-event behaviour in the committed regression test.
- [x] 3.4 Add position and movement fields to the battle log, including starting/final positions, move speed, distance before/after and reason; committed regression test verifies same-seed replay and movement events.
- [ ] 3.5 Ensure every current monster has a valid Gambit and preserve existing monster behavior unless explicitly changed; verify the shared Gambit evaluator remains the single action-selection system.

## 4. Slow and Wailing Wraith Ice Bolt / Freeze

- [ ] 4.1 Preserve Slow as a reusable timed status (-50 effective Move Speed for 20 seconds); verify clamping, refresh without stacking duplicate Slow entries and expiration.
- [x] 4.2 Configure monster_skill_ice_bolt with Wailing Wraith MATK magic damage, zero SP/cooldown, two-tick cast, target-inclusive maxRange 7, and `applyStatus: "freeze"` plus `statusChance: 0.25`; keep status duration, stack penalty and cap in the canonical `status_effects.json` and verify the shared simulator uses that status contract.
- [x] 4.3 Add regression coverage for Wraith's ranged formation, stationary Ice Bolt use, player Freeze application, and Silenced melee fallback/approach; verify movement and status logs use the updated event semantics.
- [x] 4.4 Add canonical root/frontend `status_effects.json`, move Freeze duration/penalty/cap out of Ice Bolt, load definitions into API/shared runtime and frontend, and cover stack-lessened/final-ended lifecycle events plus skill-damage log visibility.

## 5. Mastery integration

- [ ] 5.1 Update hand-equipment-mastery-skills to depend on this change, rename Backstab to Blinkstrike, define the exact front-of-target relocation, make Violent Shot push to distance 6, set Shield Bash to distance 0 and wire Fearless Focus to authoritative attack distance; verify each contract uses this change's position API.
- [ ] 5.2 Keep Heavy Swing and Fire Blast single-target and exclude party/AoE behavior until an approved multi-target proposal; verify no cloned extra target damage is emitted.
- [ ] 5.3 Implement the approved hit formula clamp(100 + Precision - Evasion, 5, 95); recalibrate monster stats to the same scale and validate Bow penalties -75/-74/-73 with representative hit-rate tests. Validate the total-DEX precision formula against starting values and record the DEX-225 / DEX-228 checkpoint decision.

## 6. Documentation and integration verification

- [x] 6.1 Update root SPEC.md and openspec/specs/SPEC.md mirror with lane, range, combatStyle, Move Speed, reusable Slow, stacked Freeze/Ice Bolt and no-range-blocked-log rules; corrected active-battle mutation language in both documents.
- [x] 6.2 Update ARCHITECTURE.md with movement-gauge ownership, deterministic tick ordering, position snapshot/log fields and future five-lane 5x5 direction; explicitly notes that lane UI and group combat are not implemented.
- [ ] 6.3 Expand the committed focused tests to cover remaining distance/occupancy/tie-order edge cases, Slow refresh/expiry, and invalid Gambit-action/range resource invariants; current regression covers formations, deterministic replay, movement, Freeze penalties/cap, Ice Bolt timing, Wraith stationary casting and Silenced fallback.
- [ ] 6.4 Run shared/API/frontend builds, focused tests, strict OpenSpec validation and git diff --check; verify this change is complete before applying hand-equipment-mastery-skills.
- [x] 6.5 Update STATUS.md with files changed, tests actually executed and remaining gaps; explicitly records that the change is incomplete and no production deployment was performed.
