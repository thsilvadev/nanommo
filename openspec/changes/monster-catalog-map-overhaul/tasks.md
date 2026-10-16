# Tasks

## 1. Canonical catalog contracts and migration plan

- [x] 1.1 Define and validate the `maps.json` schema, level-map IDs/names/coordinates, map types, clickability, town-border semantics, population quantity and roster presence rates.
- [x] 1.2 Move map ownership out of `monsters.json`; remove monster `map` fields, join monster IDs through map rosters, and load root/frontend map catalogues through the existing catalog services.
- [ ] 1.3 Add boot-time validation for unique IDs/coordinates, map roster references, percentage weights, map population values, monster stats, skills, materials, elements and all matchup keys.
- [ ] 1.4 Remap removed legacy map IDs for persisted characters (Town remains Town; grind characters route by saved level), reconcile stale map-presence state, and invalidate/rebuild only unstarted future encounter entries through the existing mutation/queue boundary. Never rewrite the active battle or resolved history.
- [x] 1.5 Update all item equipment drop pools and map-equipment resolution references to the six canonical level map IDs; ensure no active runtime lookup expects old Green Grounds/Menace/Ruins map IDs.
- [x] 1.6 Keep frontend public mirrors in lockstep with root canonical JSON. Do not overwrite unrelated/pre-existing catalog changes.

## 2. Retune and complete monster roster

- [x] 2.1 Retune the existing target levels and identities: Slime 1, Field Bat 2, Thornsprout 5, Mudcrawler 7, Dire Wolf 9, Sand Scorpion 14, Dune Raider 23, Venom Viper 25, Arcane Wisp 45, Ruins Guardian 58, Bone Knight 62, Broken Sentinel 68 and Wailing Wraith 73; retain Cinder Golem 10 and Mirage Stalker 13.
- [x] 2.2 Add Mudflat Crocodile 12, Bandit 25, Kwaiouá Ranger 33 and Sacred Forest Guardian 50 with full level-appropriate combat data, skills/gambits and role counters.
- [x] 2.3 Add eight original monsters: Gravelhorn 11; Ridgebreaker 18; Saltfang Crab 18; Needleback Stalker 21; Giant Mosquito 27; Rootbound Brute 29; Moonleaf Arcanist 41; Aramaian Warden 55.
- [x] 2.4 Recalculate every retuned/new monster's full stat budget, including HP/ATK/MATK/DEF/MDEF%, hit/evasion/crit, attack interval, movement, style, range, SP and defenses. Add data-based counters so higher-level same-role monsters generally increase in power with explicit, documented role trade-offs.
- [x] 2.5 Implement Thornsprout stationary, melee-only behavior and fire damage received ×2; assert a ranged-style character remains out of its attack range and takes no basic-attack damage, while close-range characters face its high physical attack; keep XP low.
- [x] 2.6 Apply the six exact level bands in `maps.json` and equal initial presence weights (34/33/33, 25×4, 50/50 as appropriate); every monster from level 1–30 is in exactly one of these rosters, and no monster above 30 is assigned yet.
- [x] 2.7 Keep all original monster IDs where identities remain; create stable IDs for the 12 new species; update the frontend catalogue without overwriting unrelated drop tuning.

## 3. XP reward rebalance and materials

- [x] 3.1 Apply `round(round(18 * level^1.15) * 0.75)` for standard monster XP rewards using the target level and preserve global `GRIND_XP_RATE` and character XP curve.
- [x] 3.2 Set Thornsprout to `round(round(18 * 5^1.15) * 0.30)`; make the exception explicit in validation/tests and apply no second 0.75 multiplier.
- [x] 3.3 Add common and rare monster-part items for all 12 newly added species in root/frontend item data and wire each one to that monster's drop table.
- [ ] 3.4 Validate XP reward formula for all catalogued monsters, drop references, seeded deterministic rolls, item IDs and new equipment pools.

## 4. LUK attribute rename

- [x] 4.1 Rename the canonical shared attribute enum/type and calculations from SOR/sor to LUK/luk; update backend DTOs, entities, services, derived stats and all active backend references.
- [x] 4.2 Update frontend character creation, attribute panels, labels, tooltips, types and public catalog stats to LUK; keep language localization separate from the identifier rename.
- [x] 4.3 Convert equipment bonus keys and rolled attribute values in JSON catalogues and persisted data from SOR to LUK, including Lucky Ring bonuses; preserve exact numeric totals.
- [ ] 4.4 Add a transactional/idempotent data migration and verify old Character attributes, equipment, inventory rolled stats, Gambit/state JSON and persisted references have no active SOR keys after migration; historical logs may remain unchanged.

## 5. Weapon and element matchup engine

- [ ] 5.1 Add JSON-keyed weapon-category and elemental damage-taken multipliers with safe defaults of 1.0 and strict catalogue typing.
- [ ] 5.2 Integrate broad damage channel × weapon-category × elemental factors with the existing DEF/MDEF mitigation in one shared damage-resolution path; log resolved factors and final damage deterministically.
- [ ] 5.3 Add the `light` element to shared typing, catalog validation and Gambit target-element options while preserving the existing `holy` ID on current monsters.
- [x] 5.4 Mark Fire Ball/Fire Blast as fire and Light Wisp/Light of Heaven as light in root and frontend skill catalogues; test both harmful elemental hits and the fact that Light of Heaven healing does not damage its target.
- [ ] 5.5 Add table-driven tests that verify category-specific strengths/weaknesses (including Sword/Dagger/Bow/Staff/Rod), elemental resistance/weakness and multiplicative combination without breaking old generic channel multipliers.

## 6. Special skills and reactions

- [x] 6.1 Add the generic `saveButtLuck` contract and helper: chance minus up to 10 percentage points from target.totalLuk; no mutation of catalogue values; no player-facing description; test future skills can opt in by JSON flag alone.
- [x] 6.2 Implement Poison Sting for Venom Viper with base 50% Poison application, `saveButtLuck: true`, LUK=10 → 40%, a 25-tick magic DoT that ticks every 5 ticks and is mitigated by target MDEF%.
- [x] 6.3 Implement Bandit Pickpocket at target HP below 20%, 10% minus 1 percentage point per target LUK (clamped at zero), 80 max SP, 60 SP cost, 20-tick cooldown, and an eligible full non-food consumable stack target.
- [ ] 6.4 Commit full-stack theft atomically and permanently on battle resolution, coordinating with inventory consumptions and supporting deterministic seeded selection, missing/ineligible stacks and duplicate resolver delivery. Add the `foe_hp_below_percent` monster-Gambit condition.
- [x] 6.5 Implement Ruins Guardian Prowess: each resolved player active skill adds +10 ATK/+10 DEF for 20 ticks, independently expiring stacks capped at five; cap hits do not refresh existing stacks.
- [x] 6.6 Implement edge-triggered 15-second 30% physical reflection on Broken Sentinel when Disarm is applied and magic reflection on Arcane Wisp when its highest-priority Arcane Surge action becomes illegal specifically from insufficient SP; reflected damage uses target DEF/MDEF and cannot recurse.
- [x] 6.7 Implement Rootbound Brute Rage fallback (`always -> attack`, then `always -> Rage`), 0 SP, negative-status cleanse, ×2 basic attack speed and +20 ATK for 15 ticks. A legal out-of-range attack still approaches instead of falling through.
- [x] 6.8 Implement Sacred Forest Guardian's one-time heavy opening spear and 50% one-stack Bleed chance, followed by approach and melee; verify no repeat spear.
- [x] 6.9 Add/extend status definitions for Prowess, Poison, reflection and Rage; classify statuses as buff/debuff/neutral (including legacy statuses), ensure Rage cleanses all and only debuffs, and ensure stat buffs, tick timing, expiry and source/target are part of canonical status events and immutable simulation state.
- [ ] 6.10 Preserve monster SP/cooldown/action-gauge contracts; assign explicit costs and cooldowns to every new skill and verify no illegal action pays SP or triggers effects.
- [x] 6.11 Add disabled future FLEE metadata for Kwaiouá Ranger and spec follow-up; verify current Gambit execution does not recognize FLEE or fake an escape outcome.

## 7. Integration and documentation

- [ ] 7.1 Add focused unit/simulator tests for map sampling, all monster Gambits, status activation/expiry, LUK chance calculations, theft idempotence, resistances, reflected damage and deterministic logs.
- [ ] 7.2 Add integration coverage for map migration, presence/queue reconciliation, transactional LUK rename, inventory theft, and preservation of active battle snapshots/jobs.
- [x] 7.3 Update root `SPEC.md` and `openspec/specs/SPEC.md` mirror exactly; update `ARCHITECTURE.md` for map ownership, reaction events, LUK and damage order.
- [x] 7.4 Update `STATUS.md` with changed files, migration behavior, tests actually run, unverified browser behaviors and explicit no-deploy statement.
- [ ] 7.5 Run JSON/schema validation, shared/API/frontend builds, focused test suites, strict OpenSpec validation and `git diff --check`; verify pre-existing uncommitted changes were preserved and do not deploy.
