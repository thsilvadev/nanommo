# Monster Catalog, Map-Owned Rosters, and Reactive Combat

## Why

The current catalog couples each monster to one map through `monsters.json`, while map metadata lives beside monster definitions. That makes it difficult to inspect or rebalance a map as a complete encounter roster. The current catalog also tops out at level 20, has no canonical world-map graph, and represents damage matchups mostly through melee/ranged/magic multipliers. The next content phase needs a level-scaled roster, explicit map exploration data, and deterministic monster mechanics that reward adapting Gambits and equipment.

## What Changes

- Rebuild the level, combat stats, role, abilities and base XP reward of every existing monster named in the approved roster; keep stable monster IDs where a creature remains the same.
- Add the remaining named creatures and the eight requested new creatures at levels 11, 18, 18, 21, 27, 29, 41 and 55. Give each new creature common/rare monster materials and complete JSON combat data.
- Introduce root `maps.json` as the canonical map catalogue. Map records own roster membership and per-monster presence rates; monster definitions no longer own a single `map` field.
- Replace the current Town/Green Grounds/Menace/Ruins catalog maps with Town and six clickable level maps (`lv. 1`, `lv. 6`, `lv. 11`, `lv. 16`, `lv. 21`, `lv. 26`). Place every monster of level 1–30 by level band only; higher-level monsters remain unassigned until a later map-distribution change.
- Load and validate the map catalogue in the API and frontend mirror. Rewire encounter generation, map UI/presence, item drop pools and map lookups to the map-owned rosters.
- Reduce standard monster `xpReward` by 25% relative to the original level formula, preserve the player XP curve and global Grind multiplier, and give Thornsprout only 30% of the normal level-based reward.
- Rename the attribute `SOR`/ `sor` to `LUK`/ `luk` across shared types, API/backend, frontend attributes, equipment bonuses, JSON contracts and persisted character/item data, with a safe legacy-data migration.
- Add data-driven weapon-category and elemental damage-taken multipliers. Assign Fire Ball/Fire Blast to `fire` and Light Wisp/Light of Heaven to `light`, with combat resolution and Gambit element filters using the canonical element IDs.
- Add deterministic combat contracts for Pickpocket, Poison Sting with the hidden `saveButtLuck` modifier, player-skill-triggered Prowess, conditional physical/magic reflection, Rage fallback, and Sacred Forest Guardian's opening spear.
- Record Kwaiouá Ranger's future FLEE Gambit as disabled metadata/documented work only. This change must not implement FLEE.
- Update OpenSpec, the root/full-game SPEC mirror, ARCHITECTURE.md and STATUS.md when implementation is applied.

## Map layout approved for this release

| ID | Display name | Coordinate (x,y) | Level band | Type | Town border |
|---|---|---:|---:|---|---|
| `map_town` | Town | (0,0) | — | `town` | false |
| `map_lv_1` | `lv. 1` | (0,1) | 1–5 | `grind` | true |
| `map_lv_6` | `lv. 6` | (0,2) | 6–10 | `grind` | false |
| `map_lv_11` | `lv. 11` | (0,3) | 11–15 | `grind` | false |
| `map_lv_16` | `lv. 16` | (0,4) | 16–20 | `grind` | false |
| `map_lv_21` | `lv. 21` | (0,5) | 21–25 | `grind` | false |
| `map_lv_26` | `lv. 26` | (0,6) | 26–30 | `grind` | false |

All seven map records have `isClickable: true` and `description: null`. Each grind map has `monsters_quantity: 100`. The first map is the only grind map adjacent to Town in this linear coordinate layout, so it alone has `is_town_border: true`. Map names are deliberately level-only; biome-themed maps are not introduced in this change.

## New named and additional monsters

Alongside the existing monsters being retuned, add:
- Bandit (level 25), Mudflat Crocodile (level 12), Kwaiouá Ranger (level 33), and Sacred Forest Guardian (level 50).
- Gravelhorn (Menace Hills, level 11), Ridgebreaker (Menace Hills, level 18), Saltfang Crab (beach, level 18), Needleback Stalker (forest, level 21), Rootbound Brute (forest, level 29), Giant Mosquito (Wastelands, level 27), Moonleaf Arcanist (forest, level 41), and Aramaian Warden (forest, level 55).

These biome labels inform creature concept and balance only. In this release, every creature with a level from 1 through 30—including currently existing Cinder Golem and Mirage Stalker—is assigned to the map whose level band contains it, regardless of its original thematic environment. Creatures above level 30 remain in the monster catalogue but are not placed on one of the six current grind maps.

## Non-goals

- Do not change the character XP requirement curve or automatically change the global `GRIND_XP_RATE`; the owner may tune that rate separately.
- Do not implement FLEE or make the Ranger's escape line executable.
- Do not create biome-named world maps or distribute monsters above level 30 yet.
- Do not mutate active/in-flight battle snapshots or rewrite resolved battle history.
- Do not deploy to production as part of this change.

## Impact

Expected areas: `monsters.json`, new root `maps.json`, matching `apps/frontend/public/data/` catalogues, `items.json`, `skill_trees.json`, `status_effects.json`, `gambit_catalog.json`, shared combat types/engine/rewards, API DataService/Character/Battle/Inventory/Map services and migrations, frontend attribute/map/Gambit catalogues and UI, catalog/engine/migration tests, `SPEC.md`, `openspec/specs/SPEC.md`, `ARCHITECTURE.md`, and `STATUS.md`.

Existing uncommitted changes outside this OpenSpec change are not part of this proposal and must be preserved during implementation.
