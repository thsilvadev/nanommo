# Design — Monster Catalog, Map-Owned Rosters, and Reactive Combat

## Goals and invariants

1. The server and shared deterministic simulator remain authoritative. Monster behavior, combat resource changes, item theft, status applications, reflected damage and battle events must be reproducible from immutable snapshots and seeded randomness.
2. JSON is the normal balance-editing surface. Adding/changing a monster, its weapon/element matchups, skill chances, status parameters, map roster or presence rate should not require a one-off branch in the simulator.
3. Monster identity and map occurrence are separate concepts. A monster has one definition/ID and any map can reference that ID.
4. The current battle remains one character versus one monster. No party/area-target assumptions are introduced.
5. Catalog changes do not retroactively change an active or already-resolved battle's snapshot/history.

## 1. Canonical map catalogue

Create root `maps.json` and mirror it to `apps/frontend/public/data/maps.json`. The API `DataService` loads maps separately from `monsters.json`; the frontend's CatalogService loads the matching public mirror. `monsters.json` becomes monster definitions only and is no longer the authoritative owner of map metadata or occurrence.

### Map record contract

Each record contains:
- `id`: stable API/database identifier.
- `name`: exactly `Town`, `lv. 1`, `lv. 6`, `lv. 11`, `lv. 16`, `lv. 21`, or `lv. 26`.
- `coordinates: { "x": 0, "y": N }`, where Town is (0,0) and map records follow the approved y positions 1–6.
- `isClickable: true` for every map in this release.
- `type: "town" | "grind"`.
- `is_town_border`: true only for `map_lv_1`, the only grind map directly adjacent to Town in this layout; false for Town and all later level maps.
- `description: null` for every map in this release.
- `recommendedLevel` and `levelRange` for the six level maps; Town has no level range.
- `monsters_quantity: 100` for each grind map; Town has no encounter population.
- `monsters`: an array of `{ "monsterId": string, "presenceRate": integer }`. `presenceRate` is a percentage weight for encounter selection, not a duplicated monster definition.

Presence rates sum to 100 for each grind map. Because no species dominance has been specified yet, assign equal probability among the monsters on that map and distribute integer rounding deterministically in catalogue order. The expected default weights are 34/33/33 for a three-monster roster, 25 each for four monsters, and 50/50 for two monsters. These values remain directly editable in JSON.

The first population interpretation for this release is a configured map population quantity/cap of 100 plus a weighted encounter-selection roster. The battle generator selects eligible monster IDs from the selected map's roster according to `presenceRate`; it must not infer map membership from `monster.map` or list every catalogued monster on every map.

### Assigned level bands

- `map_lv_1`, levels 1–5: Slime (1), Field Bat (2), Thornsprout (5).
- `map_lv_6`, levels 6–10: Mudcrawler (7), Dire Wolf (9), Cinder Golem (10).
- `map_lv_11`, levels 11–15: Gravelhorn (11), Mudflat Crocodile (12), Mirage Stalker (13), Sand Scorpion (14).
- `map_lv_16`, levels 16–20: Ridgebreaker (18), Saltfang Crab (18).
- `map_lv_21`, levels 21–25: Needleback Stalker (21), Dune Raider (23), Bandit (25), Venom Viper (25).
- `map_lv_26`, levels 26–30: Giant Mosquito (27), Rootbound Brute (29).

The remaining new forest monsters and existing Ruins/Forest creatures above level 30 remain catalogued and unassigned in `maps.json` for later world-map work. Kwaiouá Ranger (33), Arcane Wisp (45), Sacred Forest Guardian (50), Moonleaf Arcanist (41), Aramaian Warden (55), Ruins Guardian (58), Bone Knight (62), Broken Sentinel (68) and Wailing Wraith (73) are not members of these six rosters in this release. Keep Cinder Golem and Mirage Stalker in their level-derived bands despite their original thematic notes; this release intentionally prioritizes level-only distribution.

### Data consumers and migration

Update API map getters and `getMonstersInMap` to resolve IDs through `maps.json`, join roster entries to canonical monster definitions, and validate references/rates at boot. Update frontend catalog loading and map UI/presence consumers to use the canonical map records. Avoid building a second local roster or duplicating monster stat records inside the map JSON.

Replace equipment `dropPool` references that point to removed map IDs with the new level-map IDs. Preserve the existing tier design using editable JSON: T1 equipment is eligible in `map_lv_1` and `map_lv_6`; T2 in `map_lv_11` and `map_lv_16`; T3 in `map_lv_21` and `map_lv_26`. The existing per-monster equipment-drop sentinel can continue resolving against the selected map's pool; normalize old `equip_green_grounds_roll`, `equip_menace_roll`, and `equip_ruins_roll` labels to a generic map-equipment sentinel only if this is needed to remove misleading map semantics, while preserving backwards-compatible resolution.

When migrating a character's persisted map ID, preserve `map_town` if the character was in Town. For a character stored on any removed grind map, select the current level band from the character's saved level, clamped to `map_lv_26` for level 26 and above. Do not modify historical resolved battles. Use the existing BattleService future-combat mutation/queue invalidation boundary to discard/rebuild unstarted stale encounters; do not rewrite a currently active battle/job. Ensure any stale old map ID in presence state is reconciled by the authoritative map-presence path.

## 2. Monster catalogue and stats

Keep stable IDs for existing species and remove their single-owner `map` property. The catalogue owns identity, stats, battle style, elemental affinity, weapon/element damage-taken multipliers, resources, gambit, skill references, notes and drop definitions. Map occurrence lives only in `maps.json`.

Update the existing named creatures to the user's target levels and identity:
- Slime 1; Field Bat 2; Thorn Sprout → display name Thornsprout 5; Mud Crawler → Mudcrawler 7; Dire Wolf Alpha → display name Dire Wolf 9.
- Sand Scorpion 14; Dune Raider 23; Venom Viper 25.
- Ruins Guardian 58; Bone Knight 62; Broken Sentinel 68; Wailing Wraith 73; Arcane Wisp 45.
- Preserve Cinder Golem at 10 and Mirage Stalker at 13 for this level-only placement pass.
- Add Mudflat Crocodile 12, Bandit 25, Kwaiouá Ranger 33, and Sacred Forest Guardian 50.

Use level-appropriate stat budgets rather than changing only the `level` field. Recalculate HP, ATK, MATK, DEF, MDEF%, accuracy, evasion, crit chance, attack interval, move speed, combat style and basic attack range for the new target level. Establish the baseline progression from the current catalogue's level/stat shape and apply explicit role modifiers in JSON. The resulting roster must not have a higher-level baseline weaker than a lower-level same-role baseline unless a documented role trade-off explains it. Keep stat values easy to tune without special-casing species in TypeScript.

Role intent and acceptance boundaries:
- **Slime (1):** weak and fragile in every defense/offense dimension, but still deals nonzero damage.
- **Field Bat (2):** low HP and offense with clearly above-peer Evasion.
- **Thornsprout (5):** stationary (`canMove: false`, movement speed 0); melee-only with basic attack range 0; high physical damage; fire elemental damage multiplier 2.0 received; low XP for a level-5 monster. Under the current distance model, any ranged-style character remains outside its attack range because Thornsprout cannot approach, so it cannot damage that character with its basic attack. Do not add a ranged skill to Thornsprout. It exists as a safe ranged skill-training target, not an XP farm.
- **Mudcrawler (7):** conspicuously high MDEF% for its level, encouraging physical damage.
- **Dire Wolf (9):** faster than peers and uses Enraged Strike/Massive Damage under its existing HP condition; its attack must be threatening and closing range must make escape difficult. Do not introduce FLEE as a hidden side effect.
- **Sand Scorpion (14):** high physical DEF and low MDEF%.
- **Dune Raider (23):** ranged basic attack, high Evasion and high Accuracy.
- **Bandit (25):** Pickpocket uses the exact contract in section 5.
- **Mudflat Crocodile (12):** low movement speed and high basic-attack damage.
- **Venom Viper (25):** high magic DoT pressure and the Poison Sting contract in section 5.
- **Kwaiouá Ranger (33):** ranged blowgun attack; future flee metadata only, per section 7.
- **Ruins Guardian (58):** Prowess; retain a meaningful melee/skill threat.
- **Bone Knight (62):** rapid sustain using Regenerate.
- **Broken Sentinel (68):** high DEF and the conditional physical-reflection reaction.
- **Wailing Wraith (73):** ranged Ice Bolt, high MATK; preserve high-level ranged spell identity. Ice Bolt remains zero-cost and has no cooldown.
- **Arcane Wisp (45):** high MDEF% and high MATK, but a clear counter-matchup (physical categories).
- **Sacred Forest Guardian (50):** one strong opening spear, 50% chance of applying one Bleed stack, then approaches and fights in melee.

### Eight additional monsters

Create the following eight original species with full level-appropriate JSON data and explicit matchups:
- Gravelhorn (Menace Hills concept, level 11): slow armored bruiser, high DEF and low MDEF%.
- Ridgebreaker (Menace Hills concept, level 18): high physical attack and slow wind-up; vulnerable to ranged pressure.
- Saltfang Crab (beach concept, level 18): very high DEF, low MDEF%, low movement; strong against selected blade categories and weak to fire.
- Needleback Stalker (forest concept, level 21): high Evasion and Accuracy, low HP, weak to fire.
- Rootbound Brute (forest concept, level 29): melee bruiser with the Rage fallback defined in section 5.
- Giant Mosquito (Wastelands concept, level 27): fast, high Evasion, fragile, ranged/piercing-style pressure; keep its counter-matchup clear.
- Moonleaf Arcanist (forest concept, level 41): high MATK and MDEF%, low physical DEF.
- Aramaian Warden (forest / ancient Aramaian civilization concept, level 55): durable control/physical-defense specialist; preserve a clear vulnerability so it is not a universal tank.

These roles are design intent, not permission to ignore the level stat budget. Final stats must be verified against deterministic matchup simulations and written plainly into JSON.

## 3. XP reward curve

Keep the existing character XP curve and global `GRIND_XP_RATE` unchanged. The original monster reward anchor is `baseXp(level) = round(18 * level^1.15)`; existing current rewards match this pattern. For every monster except Thornsprout, set `xpReward = round(baseXp(level) * 0.75)`: this is a 25% reduction from the normal level-based reward, including existing monsters whose target level changes. Never derive the new value from its old level's reward after its level changes.

Thornsprout instead gets `xpReward = round(baseXp(5) * 0.30)`, 70% below the normal pre-change reward for level 5. This is its one explicit XP exception. Do not multiply its exception by another 0.75. The runtime global Grind multiplier (currently 0.25) remains as-is in this change; the game owner will tune it manually if desired. New monsters follow the same formula and exception rules.

Add a deterministic validation that checks every catalogue reward against its expected formula/exception and allows no unnoticed drift. Do not modify `char_xp_curve.json` or the character XP threshold generator.

## 4. Data-driven matchup model

Retain the existing generic `damageTakenMultiplier` channels (`melee`, `ranged`, `magic`) as one independent factor for backward compatibility and broad defense roles. Add:
- `weaponDamageTakenMultiplier`: optional JSON object keyed by offensive weapon categories `sword`, `greatsword`, `dagger`, `bow`, `staff`, `rod`. Missing keys equal 1.0. Shield and Rune are defensive/off-hand categories and do not become attack types.
- `elementalDamageTakenMultiplier`: optional JSON object keyed by canonical element IDs, including `fire` and `light`; missing keys equal 1.0. Preserve other currently supported elements.
- `element` on skills to identify their attack/healing element; new/updated elemental values are JSON data, not skill-name checks.

The attack snapshot identifies its weapon category from the character's actual eligible weapon/skill. Resolve damage by applying the applicable broad damage-channel multiplier, weapon-category multiplier when the action has an offensive weapon category, elemental multiplier when the action has an element, and then the existing defensive mitigation (physical `DEF / (DEF + 300)`, magical `MDEF%`). Use one shared function and deterministic logs; no duplicate hard-coded switch statements. Existing monster channel multipliers remain a separate factor, so a weakness can intentionally combine with a weapon and elemental weakness. Healing/utility skills never damage the target or invoke damage multipliers merely because they carry an element tag.

Fire Ball and Fire Blast get `element: "fire"`; Light Wisp (current Rod skill ID `wisp_flow`) and Light of Heaven get `element: "light"`. Add `light` to canonical element typing, validation and the Gambit `foe_element_is` values without silently renaming existing `holy` monster data.

## 5. Data-driven skills, reactions and Luck

### Attribute rename and data migration

Rename every active game-domain attribute identifier `SOR`/`sor` to `LUK`/`luk` in shared attributes/types/formulas, API DTOs/services/entities/derived stats, frontend attribute panels/creation/spending tooltips, equipment-stat aggregation, catalogue metadata, Gambit conditions if relevant, tests and canonical docs. Migrate persisted Character stat columns/state and every JSONB/catalogue stat key from SOR to LUK atomically. Convert rolled equipment attribute values that equal SOR to LUK. Lucky Ring item IDs/names do not need to change, only their bonus key. Existing records must preserve the numeric stat and total stats exactly; no extra points may be created or lost. Historical text/logs may remain historical, but active identifiers and user-facing attribute labels use LUK.

### Atomic hidden `saveButtLuck` modifier

Implement one shared probability-adjustment helper and a validated optional boolean `saveButtLuck` on skill definitions. When true, subtract `min(max(0, floor(target.totalLuk)), 10)` percentage points from every supported chance/proc probability belonging to that skill, clamped to [0%,100%]. The chance adjustment is applied immediately before the probability roll and never mutates the catalogue value. It must work for any future skill marked `saveButtLuck: true`, not only Poison Sting. Keep this property out of player-facing skill descriptions/tooltips; it is an intentional hidden easter egg. For Poison Sting, base Poison application chance is 50%; a target with 10+ total LUK therefore sees 40%. Ensure `totalLuk` includes all applicable character stats/equipment bonuses in the immutable battle snapshot.

### Pickpocket — Bandit (level 25)

Add `monster_skill_pickpocket` to the monster-skill catalogue:
- Bandit has `maxSp: 80` and the current monster baseline SP regeneration of 2 SP per 10 ticks.
- It costs 60 SP, has 20 ticks (20 seconds) cooldown, and is considered only while the character/foe HP is strictly below 20%.
- Gambit priority: `foe_hp_below_percent < 20 -> Pickpocket`, then `always -> attack`. If skill execution is illegal (for example insufficient SP or no eligible stack), continue the normal first-legal-line behavior.
- Base theft chance is 10%. Unlike the generic `saveButtLuck` rule, Pickpocket's own rule reduces its chance by 1 percentage point per target total LUK, capped by 10% and by the base chance. Thus 5 total LUK reduces 10% to 5%, and 10+ total LUK reduces it to 0%.
- An eligible target inventory stack is a non-food consumable stack with positive remaining quantity. Select one eligible stack deterministically from the battle seed (uniformly among eligible stack rows), then roll the chance. On success, steal the entire remaining stack quantity—not one unit. Food, equipment, materials, empty stacks and unrelated inventory rows are ineligible. If no eligible stack exists, Pickpocket is not a legal action.
- Record the stolen inventory row/item ID and complete quantity in battle events/resolution output. Persist the theft in the authoritative BattleService resolution transaction. A stolen stack is lost permanently, even if the character later wins/dies/returns to Town; never return or refund it. Coordinate theft with item consumption in the same battle so a consumed/depleted stack cannot be stolen twice or resurrected. The active battle remains an immutable snapshot and the transactional final inventory must match the deterministic sequence of consumption/theft events.

Add/extend the monster Gambit condition schema/evaluator for `foe_hp_below_percent` (character HP from the monster's perspective). It must be legal and serialized consistently with the current monster Gambit JSON shape.

### Poison Sting — Venom Viper (level 25)

Add `monster_skill_poison_sting`, with a cast/interval and cooldown calibrated for a level-25 enemy, and a `self_hp_below_percent < 80 -> Poison Sting` priority line followed by `always -> attack`. On resolution, the skill makes one deterministic 50% chance roll (modified by `saveButtLuck: true`) to apply one Poison status stack. Poison lasts 25 ticks and deals `floor(source MATK × 0.5)` damage every 5 ticks; each tick is magic damage and therefore is reduced by target MDEF% as normal. Treat 0.5 as the initial tunable JSON coefficient, not a hard-coded species branch. Poison durations, interval, source scaling and caps belong in `status_effects.json`/the skill's structured effect data rather than a species-specific UI rule. Apply status at most once per cast and log the source/target and tick damage. Do not allow repeated ticks to generate a second proc or trigger Mastery action XP.

### Prowess — Ruins Guardian (level 58)

Prowess reacts to the **player character** resolving an active skill against the Ruins Guardian; monster skills do not create its stacks. Each qualifying player skill resolution adds one Prowess stack, up to five. Each stack grants +10 monster ATK and +10 monster DEF for 20 ticks from its own application time. Each stack expires independently. At cap, an additional player skill does not add or refresh a stack until one expires. Values/duration/cap belong in `status_effects.json`; the trigger belongs in a declarative monster mechanic entry in `monsters.json`. Reuse the canonical status lifecycle and combat log; do not implement only a visual buff.

### Conditional damage reflection

Support declarative reaction entries on monster definitions, separate from Gambit actions. Reaction triggering is edge-based, avoiding renewal every tick while a condition remains true:
- **Broken Sentinel physical reflection:** when Disarm is newly applied to Broken Sentinel, activate physical reflection for 15 ticks.
- **Arcane Wisp magic reflection:** when the Wisp's highest-priority Arcane Surge line transitions to illegal specifically because it lacks SP, activate magic reflection for 15 ticks. Insufficient SP must be the cause; cooldown, range, Silence or another illegal-action reason must not trigger this reaction. Arcane Surge costs 60 SP and deals 2× MATK as magic damage.

While active, an incoming qualifying damage event causes raw reflected damage equal to 30% of the final damage the reflector actually received. Resolve reflected damage as a new hit of the corresponding type against the original attacker, using that attacker's normal DEF or MDEF% mitigation. Apply relevant attack-source category/element only if specified by the reaction; do not recursively reflect reflected damage and do not create a reflection loop. A zero-damage or fully absorbed hit reflects zero. Log activation, reflection source/target, raw reflected amount, mitigation and final HP changes deterministically. Both reactions use a 15-second duration and JSON-configurable 0.30 fraction.

### Rage — Rootbound Brute (level 29)

Add `monster_skill_rage` and make it a fallback Gambit line after the basic attack:
1. `always -> attack`
2. `always -> Rage`

If the basic attack is legal but the target is out of range, retain the existing approach/movement behavior; do not activate Rage merely because a legal melee attack needs movement. If the attack action is actually illegal at action evaluation (for example because Disarm makes the monster's basic attack illegal), the evaluator continues to the next legal line and can execute Rage. A global action-locking status that prevents all actions still blocks Rage itself.

Rage costs 0 SP, has a 15-tick cooldown, is usable as the fallback only when legal, and grants a 15-tick buff: dispel all negative/debuff statuses from the monster, double its basic-attack speed (halve the base attack interval, bounded by the existing minimum legal interval), and add +20 ATK. It does not double skill/cast speed. Rage values, status duration, cleansing classification and buffs are declarative data; only the generic effect application belongs in the shared engine. Add a canonical status `polarity: "buff" | "debuff" | "neutral"` classification and mark existing/new harmful statuses (including Freeze, Slow, Bleed, Burn, Stun, Disarm and Poison) as debuffs; mark War Cry, Magic Barrier, Prowess, reflection and Rage effects as buffs. Rage removes active statuses whose polarity is `debuff` and leaves buffs/neutral effects intact. The fallback ensures that future reasons which make basic attack illegal can reuse Rage without hardcoding every possible cause.

### Sacred Forest Guardian opening spear

The Sacred Forest Guardian (50) uses a one-time opening spear before transitioning to approach and melee behavior. The opening hit deals 2.0× its basic ATK as raw physical damage and has a 50% chance to apply one Bleed stack. The 2.0 multiplier remains editable in the skill JSON. It then closes distance and uses its melee basic attack; it must not remain ranged or repeatedly throw the opening spear. Set the opening/action flag in the deterministic battle-local snapshot and log the initial action, status roll and movement. The opening skill's timing, damage multiplier and range are data-driven.

### SP and existing rules

Use existing monster SP defaults (60 max SP, 2 regeneration per 10 ticks) except the user-approved exceptions: Venom Viper, Wailing Wraith and Bandit have 80 max SP. Pickpocket costs 60; other newly introduced monster abilities must have explicit catalogued costs (zero where a utility action is intended not to be SP-gated). A skill cannot execute without its cost unless catalogued cost is 0. Maintain existing cooldown sequencing, cast timing, event snapshots and server-authoritative resolution.

## 6. Future FLEE metadata only

Kwaiouá Ranger keeps ranged blowgun attacks and has a documented intended rule: below 10% HP, repeatedly attempt to FLEE until the battle ends. FLEE does not exist as an executable battle action yet. Put the future rule in a clearly disabled/comment-like JSON metadata field that the current simulator ignores, and document a follow-up to replace it with a real Gambit/action once FLEE has its own OpenSpec change. Do not make the current Gambit evaluator treat FLEE as a legal action or use a fake win/loss outcome.

## 7. Monster materials and drops

Every newly added species receives a unique common and rare material entry in `items.json` and the frontend public item mirror, using the existing monster-part item schema. Add the material drop rows to the monster definition. Preserve existing common/rare material IDs for existing creatures, adjusting only names explicitly requested and their rates only where the approved design calls for it. New materials need distinct IDs/names and reasonable sell/base values following their level band, but no new crafting recipes or progression systems are implied.

Verify all new material IDs resolve, no drop entry points at a missing item, and all map-level equipment pools point to valid current map IDs. Keep every drop probability in JSON and deterministic seeded roll ownership in `packages/shared/src/battle-engine/rewards.ts`.

## 8. Verification and migration discipline

- Add schema/boot validation for map IDs, unique coordinates, legal map types, roster monster references, presence rates in [0,100], roster totals of 100, positive population quantities and the rule that Town has no monsters.
- Validate monster ID uniqueness, level/stat ranges, all Gambit skill references, all drop item IDs, monster skill IDs, reaction trigger/effect schemas, element IDs and damage multiplier keys.
- Add deterministic tests for all XP values, map bands/rates, multi-map monster references, stat-role invariants, category/element multiplier composition, LUK data migration, saveButtLuck probability adjustment, Pickpocket eligibility/full-stack permanent loss/idempotent resolution, Poison tick mitigation, Prowess stack expiry/cap, edge-triggered reflection/no recursion, Rage fallback/cleanse/attack-speed semantics and the Guardian's single opening spear.
- Preserve historical resolved battles and immutable active battle jobs. Global character map migration and any queue changes must pass through the established BattleService-owned future-combat mutation path rather than mutating a running encounter ad hoc.
- Synchronize root `SPEC.md` and `openspec/specs/SPEC.md` exactly when applied; document the final architecture and implementation evidence in `ARCHITECTURE.md` and `STATUS.md`.
