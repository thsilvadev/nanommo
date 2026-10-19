# Design

## Context

See `proposal.md` for motivation and scope. Root `maps.json` is already the canonical catalogue and is validated by API `DataService`; `apps/frontend/public/data/maps.json` is its frontend mirror. The current map board uses a 90px horizontal level row in `map-board.html/css`, with its behavior implemented in `MapBoard` in `components.ts`. The new artwork is 2295×1989px, exactly 15×13 cells at 153px each; the existing viewport frame is 761×660px. Character map state lives in `characters.currentMapId/status/pendingMapTransition`. The existing map service only enters grind maps, uses `unlockLevel` as a hard gate, and most return-to-Town behavior assumes `map_town` is the only Town.

## Goals / Non-Goals

**Goals:**
- Define the 41 listed world locations and the complete first-pass grind roster distribution.
- Render a correctly aligned native-scale background, contiguous tiles, a fixed viewport, pointer panning, persistent fog-of-war and a current-location pin.
- Allow entry to every catalogued map regardless of character level, while distinguishing Town transitions from grinding.
- Preserve deterministic battle snapshots, safe Town deferral, canonical NPC/Storage guards, and safe database migration practices.

**Non-Goals:**
- Implement pathfinding, movement routes, map-to-map travel time, collision, PvP or instanced maps.
- Add new monster definitions or alter combat formulas, XP curves, equipment drops or monster abilities.
- Make suggested levels an access restriction or show level text on the map tiles.
- Change the existing 761×660 viewport size or scale the world art to fit it.

## Decisions

### 1. Canonical catalogue and identifiers

Keep root `maps.json` authoritative and mirror it byte-for-byte to `apps/frontend/public/data/maps.json`. Preserve `map_town` as Sierra-Village to minimize the legacy ID transition. Use stable ASCII-slug IDs for other records. Every one of the 41 listed locations sets `isClickable: true`, numeric `unlockLevel: 0`, and its explicit `coordinates`, `type`, `is_town_border`, `recommendedLevel` (when provided), `description: null`, and roster fields. The four repeated Menace-Hills entries are named `Menace-Hills_0..3`; the three Wastelands entries are `Wastelands_0..2`. Keep the user's spelling `Emperial-Capital-Caelum`.

Coordinate conversion is fixed and tested: a location (x,y) maps to one-based grid column `x + 8` and row `7 - y`. This means Sierra-Village (0,0) is column 8, row 7; the westmost listed x=-6 is column 2; y=5 is row 2; y=-6 is row 13. The supplied data intentionally leaves other columns/coordinates empty for future world expansion. Reject coordinates that collide, exceed the grid bounds, or are not integers.

`unlockLevel` is always 0. Preserve the submitted `[lv N+]` values in a separate `recommendedLevel` advisory field for map recommendations and future information surfaces only. Remove the level legend from the tile UI. Map recommendations, if surfaced by the existing API, must use `recommendedLevel` rather than infer thresholds from `unlockLevel`; they may never reject entry.

Town records use `type: "town"`, `isTown: true`, zero monsters and zero population. Sierra-Village keeps NPC IDs `william`, `father_marcelus`, `blacksmith_loren`, `cecilia`, and `storage`. Each other Town destination references the same canonical `storage` NPC; do not duplicate NPC records. Grind records use `type: "grind"`, `isTown: false`, `monsters_quantity: 100`, and a weighted roster with a total presence rate of 100. Preserve `is_town_border = true` only on the five records marked in the user's list: Green-Grounds_0, Green-Grounds_4, Green-Grounds_6, God's Bridge and Wastelands_2; set it false elsewhere.

### 2. Definitive map catalogue

The following table is the complete canonical location list. All entries have `isClickable: true`, `unlockLevel: 0`, and `description: null`; an em dash means no recommended level. `Town` records use `monsters: []` and `monsters_quantity: 0`. All coordinates are (x,y).

| ID | Display name | Coordinates | Type | Town border | Recommended level |
|---|---|---:|---|---|---:|
| `map_town` | Sierra-Village | (0, 0) | town | false | — |
| `map_green_grounds_0` | Green-Grounds_0 | (-1, 0) | grind | true | 1 |
| `map_green_grounds_1` | Green-Grounds_1 | (-2, 0) | grind | false | 1 |
| `map_green_grounds_3` | Green-Grounds_3 | (-2, 1) | grind | false | 5 |
| `map_green_grounds_4` | Green-Grounds_4 | (0, -1) | grind | true | 1 |
| `map_green_grounds_5` | Green-Grounds_5 | (0, -2) | grind | false | 1 |
| `map_green_grounds_6` | Green-Grounds_6 | (-1, -2) | grind | true | 5 |
| `map_outpost` | Outpost | (-2, -2) | town | false | — |
| `map_gods_bridge` | God's Bridge | (-2, -3) | grind | true | 10 |
| `map_ipora_beach_0` | Iporá-Beach_0 | (-3, -3) | grind | false | 10 |
| `map_ipora_beach_1` | Iporá-Beach_1 | (-2, -4) | grind | false | 10 |
| `map_kwaioua_forest_0` | Kwaiouá-Forest_0 | (-4, -3) | grind | false | 20 |
| `map_kwaioua_forest_1` | Kwaiouá-Forest_1 | (-4, -4) | grind | false | 20 |
| `map_kwaioua_forest_2` | Kwaiouá-Forest_2 | (-3, -4) | grind | false | 20 |
| `map_kwaioua_forest_3` | Kwaiouá-Forest_3 | (-2, -5) | grind | false | 20 |
| `map_kwaioua_forest_6` | Kwaiouá-Forest_6 | (-5, -3) | grind | false | 40 |
| `map_kwaioua_forest_7` | Kwaiouá-Forest_7 | (-4, -2) | grind | false | 40 |
| `map_kwaioua_forest_4` | Kwaiouá-Forest_4 | (-6, -3) | grind | false | 30 |
| `map_kwaioua_forest_5` | Kwaiouá-Forest_5 | (-6, -4) | grind | false | 30 |
| `map_kwaioua_taba` | Kwaiouá-Taba | (-5, -4) | town | false | — |
| `map_caete_0` | Caetê_0 | (-6, -5) | grind | false | 40 |
| `map_caete_1` | Caetê_1 | (-6, -6) | grind | false | 50 |
| `map_caete_2` | Caetê_2 | (-5, -5) | grind | false | 50 |
| `map_caete_3` | Caetê_3 | (-4, -5) | grind | false | 40 |
| `map_caete_4` | Caetê_4 | (-3, -5) | grind | false | 30 |
| `map_caete_5` | Caetê_5 | (-3, -6) | grind | false | 30 |
| `map_caete_6` | Caetê_6 | (-4, -6) | grind | false | 50 |
| `map_caete_7` | Caetê_7 | (-2, -6) | grind | false | 30 |
| `map_aramaia_city` | Aramaia-City | (-5, -6) | town | false | — |
| `map_forest_ruins_0` | Forest_Ruins_0 | (-5, -2) | grind | false | 60 |
| `map_forest_ruins_1` | Forest_Ruins_1 | (-5, -1) | grind | false | 60 |
| `map_forest_ruins_2` | Forest_Ruins_2 | (-6, -1) | grind | false | 60 |
| `map_forest_ruins_3` | Forest_Ruins_3 | (-6, -2) | grind | false | 70 |
| `map_menace_hills_0` | Menace-Hills_0 | (-2, 2) | grind | false | 10 |
| `map_menace_hills_1` | Menace-Hills_1 | (-3, 2) | grind | false | 10 |
| `map_menace_hills_2` | Menace-Hills_2 | (-4, 2) | grind | false | 10 |
| `map_menace_hills_3` | Menace-Hills_3 | (-4, 3) | grind | false | 10 |
| `map_wastelands_0` | Wastelands_0 | (-5, 3) | grind | false | 20 |
| `map_wastelands_1` | Wastelands_1 | (-5, 4) | grind | false | 25 |
| `map_wastelands_2` | Wastelands_2 | (-5, 5) | grind | true | 20 |
| `map_emperial_capital_caelum` | Emperial-Capital-Caelum | (-6, 5) | town | false | — |

### 3. First-pass monster presence

Use these as explicit percentage weights in `maps.json`. Keep the given rates unchanged except where Rootbound Brute is added to the high-level Kwaiouá Forest rosters; there, preserve the original roster's relative proportions in the remaining 80%. Exact monster IDs come from the existing canonical `monsters.json` catalogue.

| Map | Monster presence rates |
|---|---|
| Green-Grounds_0 | Slime 70%, Field Bat 30% |
| Green-Grounds_1 | Field Bat 20%, Thornsprout 80% |
| Green-Grounds_3 | Dire Wolf 20%, Mudcrawler 80% |
| Green-Grounds_4 | Slime 50%, Field Bat 50% |
| Green-Grounds_5 | Field Bat 20%, Mudcrawler 80% |
| Green-Grounds_6 | Mudcrawler 95%, Thornsprout 5% |
| God's Bridge | Mudflat Crocodile 100% |
| Iporá-Beach_0 | Mudflat Crocodile 70%, Sand Scorpion 20%, Thornsprout 10% |
| Iporá-Beach_1 | Mudflat Crocodile 50%, Sand Scorpion 50% |
| Kwaiouá-Forest_0 | Venom Viper 20%, Mudflat Crocodile 50%, Mudcrawler 30% |
| Kwaiouá-Forest_1 | Venom Viper 60%, Mudflat Crocodile 40% |
| Kwaiouá-Forest_2 | Venom Viper 40%, Mudflat Crocodile 60% |
| Kwaiouá-Forest_3 | Venom Viper 20%, Mudflat Crocodile 70%, Thornsprout 10% |
| Kwaiouá-Forest_4 | Rootbound Brute 50%, Venom Viper 30%, Mudflat Crocodile 20% |
| Kwaiouá-Forest_5 | Rootbound Brute 45%, Venom Viper 35%, Mudflat Crocodile 20% |
| Kwaiouá-Forest_6 | Arcane Wisp 32%, Kwaiouá Ranger 32%, Venom Viper 16%, Rootbound Brute 20% |
| Kwaiouá-Forest_7 | Arcane Wisp 32%, Kwaiouá Ranger 24%, Venom Viper 16%, Thornsprout 8%, Rootbound Brute 20% |
| Caetê_0 | Rootbound Brute 10%, Moonleaf Arcanist 35%, Sacred Forest Guardian 35%, Aramaian Warden 20% |
| Caetê_1 | Sacred Forest Guardian 35%, Moonleaf Arcanist 20%, Aramaian Warden 45% |
| Caetê_2 | Sacred Forest Guardian 40%, Moonleaf Arcanist 20%, Aramaian Warden 40% |
| Caetê_3 | Rootbound Brute 15%, Moonleaf Arcanist 40%, Sacred Forest Guardian 30%, Aramaian Warden 15% |
| Caetê_4 | Rootbound Brute 100% |
| Caetê_5 | Rootbound Brute 100% |
| Caetê_6 | Sacred Forest Guardian 50%, Aramaian Warden 50% |
| Caetê_7 | Rootbound Brute 100% |
| Forest_Ruins_0 | Broken Sentinel 25%, Ruins Guardian 15%, Bone Knight 25%, Arcane Wisp 10%, Wailing Wraith 25% |
| Forest_Ruins_1 | Broken Sentinel 25%, Ruins Guardian 15%, Bone Knight 20%, Arcane Wisp 15%, Wailing Wraith 25% |
| Forest_Ruins_2 | Broken Sentinel 30%, Ruins Guardian 10%, Bone Knight 25%, Arcane Wisp 10%, Wailing Wraith 25% |
| Forest_Ruins_3 | Broken Sentinel 25%, Bone Knight 25%, Arcane Wisp 15%, Wailing Wraith 35% |
| Menace-Hills_0 | Sand Scorpion 30%, Gravelhorn 30%, Mudcrawler 20%, Dire Wolf 20% |
| Menace-Hills_1 | Sand Scorpion 25%, Gravelhorn 35%, Mudcrawler 20%, Dire Wolf 20% |
| Menace-Hills_2 | Sand Scorpion 35%, Gravelhorn 25%, Mudcrawler 20%, Dire Wolf 20% |
| Menace-Hills_3 | Sand Scorpion 40%, Gravelhorn 25%, Mudcrawler 15%, Dire Wolf 20% |
| Wastelands_0 | Bandit 25%, Ridgebreaker 25%, Needleback Stalker 25%, Giant Mosquito 25% |
| Wastelands_1 | Bandit 35%, Ridgebreaker 15%, Needleback Stalker 25%, Giant Mosquito 25% |
| Wastelands_2 | Bandit 30%, Ridgebreaker 25%, Needleback Stalker 25%, Giant Mosquito 20% |

The four Town records have no monster entries. Preserve every species ID and combat stat in `monsters.json`; this change only changes map membership and editable weights. Cinder Golem and Mirage Stalker remain in the species catalogue but are not placed on the new world map in this pass because the supplied regional distribution did not assign them to a location. Do not invent additional maps or silently replace any named creature to accommodate them.

### 4. Viewport and layered rendering

Package the supplied project images into the frontend's served assets (for example `apps/frontend/assets/maps/map-background.png` and `pinpoint.png`) and reference the built asset URLs, keeping the original `project/` files as source assets. The viewport shell is exactly 761×660px with `overflow: hidden`; the inner world is fixed at 2295×1989px with background size 2295×1989px. Use CSS Grid with `repeat(15, 153px)`, `repeat(13, 153px)` and `gap: 0`, or equivalent absolute positioning calculated from the same formulas. Do not use current `gap: 5px` or size the viewport around the map.

Each world cell may have a veil layer. Cells revealed by discovered locations are transparent; all other cells receive an opaque near-black overlay without margins or gaps. Revealed catalogued locations use an independent transparent interactive overlay sized exactly 153×153px, `box-sizing: border-box`, with `border: 1px solid #eee` or an equivalent near-white light-gray border drawn inside the tile. Hover/focus may brighten the border via inset shadow/outline, but must not enlarge the cell, add a gap or paint an opaque tile. Labels can be exposed for accessible name/tooltip without persistent large text across the artwork. The current map pin sits in a pointer-events-none layer above the map tiles, centered within the current tile.

Camera state is a scroll offset `cameraX/cameraY` in world pixels. At 100% zoom the maximum offsets are `2295 - 761 = 1534` and `1989 - 660 = 1329`; at other zoom levels the visible world dimensions are `viewportWidth/zoom` and `viewportHeight/zoom`, and offsets are clamped against those dimensions. To center the current tile, calculate its world center from the grid column/row, subtract half the viewport in world units, and clamp. During drag, store the pointer-down coordinates and original camera offset, then update the offset by the pointer delta divided by zoom. Use Pointer Events without capturing the pointer on initial pointer-down, because capture can retarget the native click away from the selected map tile; suppress click after a drag threshold so release never triggers an unintended map entry. Wheel zoom is cursor-anchored and ranges from 100% to 50%. Set `touch-action: none` only on the panning surface; the rest of the play page must retain normal touch behavior. If the current character map changes, recenter only at a committed transition or initial load; don't jump the camera on a pending Town request.

The existing `map-board.html` has Town and grind tiles as distinct templates and the `MapBoard` class is currently in `components.ts`. Refactor it toward a single catalogue-driven tile loop, filter all Town and grind records from `maps`, and preserve the existing panel's title, player-presence label and error/return feedback. Rename the world-view container from `map-art` to `viewport` (and update related selectors) rather than introducing a second competing map board.

### 5. Discovery persistence and veil calculation

Add a `discoveredMapIds: string[]` JSONB field to `Character` with a safe empty-array default. New character creation initializes it to [`map_town`]. On a committed arrival, use the same authoritative transaction/update boundary that commits the character's new `currentMapId` to merge the destination ID into discovery; do not duplicate IDs. Derive a set of revealed coordinate keys from each discovered map and its four cardinal neighbors. Use coordinate records, not grid indices, for this neighbor calculation. Coordinates may be revealed even when no destination record exists; such a cell simply shows artwork without a button. Never persist a 195-cell bitmap because it duplicates the coordinate-derived reveal state.

The migration is forward-only. Normalize each legacy placeholder map ID to a new grind map using the character's saved level and advisory recommendations, set every old/new `unlockLevel` to 0 through catalogue rollout, and ensure each existing character discovers Sierra-Village plus their mapped current destination. New characters start with Sierra-Village discovered. If a character is currently on a legacy grind map while an encounter is active, changing the persistent location/catalogue must not mutate that encounter's immutable map ID/snapshot. Use the existing battle queue maintenance and map-presence reconciliation approach to discard/rebuild only eligible future entries after audit. Do not run or baseline migrations without the documented stopped-consumer and live-schema audit safeguards.

### 6. Town destination semantics and battle safety

Keep `map_town` as the canonical Sierra-Village ID for default return-to-Town, new-character initialization, compatibility fallbacks and missing/invalid legacy IDs. The four other Town IDs represent physical destinations, not extra variants of one hard-coded location. `MapService.enterMap` must branch by catalogue `type`: a Town destination never checks food as an entry requirement and never schedules battles; a grind destination checks existing email verification and Hungry/food eligibility but not character level. Any `unlockLevel` remains zero and is ignored by both API and UI.

Refactor all hard-coded `map_town` checks that mean “any Town map” to resolve the current or requested catalogue record's `type === "town"`. Do not replace the stable ID constant globally: use it where the default return destination really is Sierra-Village. Town guards for Vendor/Storage require actual current map type Town, `status === "town"` and no pending transition. Every Town type map references the canonical Storage NPC; only Sierra-Village is required to have the current Vendor/quest/Blacksmith roster.

When the player requests a Town destination during an active battle, persist the exact destination as `pendingMapTransition.destinationMapId`, keep the active queue entry/job unchanged, invalidate later queued entries if needed, and finalize the selected Town after battle resolution. For a grind destination request during an active battle, preserve the active battle snapshot and resolve the new map at the existing safe future-queue boundary; do not regenerate or rewrite the active entry. A plain return-to-Town control requests `map_town`. Apply map-presence synchronization only after the authoritative state change.

The `getRecommendedMaps` endpoint may retain advisory recommendations using `recommendedLevel` ranges, but recommendation logic is distinct from entry permission. No map tile displays `Lv 0`, `Lv N`, or another level legend.

### 7. Validation strategy

Add or update automated checks for:
- exactly 41 unique map records; canonical/frontend maps match; every `unlockLevel` is integer 0; location types, `isClickable`, `is_town_border`, `recommendedLevel`, coordinates, NPC IDs, roster species and weights match this document;
- each coordinate maps to the expected world position, including negative coordinates, and the 15×13 cell layout has 0 gaps and correct 153px size;
- roster percentages sum to 100 (Town rosters are empty) and every monster reference resolves;
- revealed-set calculation reveals exactly the discovered coordinate and four cardinal neighbors, not diagonals, remains character-specific, and updates only after successful arrival;
- all destinations are available regardless of character level; Grind requires existing Hungry/food and email validation while Town never queues a battle;
- map pin uses committed currentMapId, mouse/touch drag clamps correctly, and drag release cannot dispatch click;
- Town transition to each non-Sierra Town destination persists the exact destination, with current battle immutability and Storage authorization maintained;
- migration idempotence, migration-history guard behavior and queue/presence reconciliation are covered without running against the live database during this proposal.

Before rollout, follow the project's established sequence: stop API/Bull consumers; run the read-only migration-history audit; manually audit or safely establish the existing legacy baseline where justified; run guarded migrations; run queue/presence reconciliation in maintenance mode with processing paused; then start normal services for a fresh reconciliation. No migration, database write, deployment or implementation is performed by this proposal.
