# Tasks

## 1. Catalogue and monster behavior

- [x] 1.1 Add Mutant Bee, Giant Mantis and Flaming Treant to canonical root monsters.json and mirror apps/frontend/public/data/monsters.json. Set every required stat, explicit aggression/combat style/elemental resistance, XP, final moveSpd and valid Gambit without changing unrelated monsters.
- [x] 1.2 Add Mutant Bee's Sting skill to root/mirrored skill_trees.json and define the Tip of Pain self-status (tip_of_pain) in status_effects.json plus its icon. Implement a reusable next-basic-attack enhancement path in the shared simulator: double raw physical ATK before normal hit/mitigation, consume once, and apply 10-tick Disarm only on a hit. Respect the two-tick cast, 30 SP, 15-tick cooldown and the status-aware Gambit fallback.
- [x] 1.3 Add all six common/rare monster-part items to root/mirrored items.json with valid schema, distinct names, level-appropriate drop chances/prices and item icons. Keep common names exactly “Fun Purple Paint” and “Forest Ancient's Teardrop”.
- [x] 1.4 Create sprites for all three monsters as transparent 167×199 assets under apps/frontend/assets/monsters/<monsterId>.svg. Follow the current centered foe-sprite convention, supplied Mantis image/pose/purple detailing and the agreed Bee/Treant art direction.
- [x] 1.5 Add the red-symbol aggression badge asset, overlay it at the foe sprite's upper-right corner based on canonical isAggressive, and implement the exact hover/focus tooltip without changing the sprite canvas.
- [x] 1.6 Update the six affected map rosters to the exact agreed weights; verify totals, monster references, root/frontend catalogue parity, final moveSpd validation and the aggression validator's non-aggressive allowance for mon_giantmantis.

## 2. Regional gathering assignment

- [x] 2.1 Apply regional pools to current Green Grounds numbering: GG0 Wheat/Milk 50/50; GG1 Cabbage/Carrot/Honeycomb 40/40/20; GG2 Cabbage/Carrot 50/50 (former GG3); GG3 Wheat 100 (former GG4); GG4 Sugar/Honeycomb 80/20 (former GG5); GG5 Sugar 100 (former GG6); Menace Hills 1/3 Wild Blueberries 100; Iporá Beach 0/1 Cooking Oil 100; all Kwaiouá Forest, Forest Ruins and Caetê maps Herbs 100.
- [x] 2.2 Remove unassigned items from all prohibited pools; allow maps whose regional allow-list is empty to omit gatheringPool. Keep Meat drop-only and Honeycomb restricted to current Green Grounds 1 and 4 (former GG1 and GG5). Mirror maps.json to the frontend.
- [x] 2.3 Update DataService and scripts/validate-monster-catalog.js (and related map validators) to validate each material's exact allow-list, weights, mirrors, optional empty pools and no-drop behavior instead of requiring every Grind map to have a non-empty pool.
- [x] 2.4 Update the authoritative Gathering award path so an empty pool completes/resets the cycle without awarding a fallback item, touching Warehouse, or emitting a success Journal event. Preserve transactional inventory-capacity behavior.

## 3. Global Chat and Idle Journal services

- [x] 3.1 Define Global chat-message entity/table and a forward-only TypeORM migration with sender-name snapshot, text, timestamp, stable ID and nullable sender FK preserving old messages if a Character is deleted.
- [x] 3.2 Add CHAT_HISTORY_RETENTION_LIMIT=20 to .env.example and the local .env when present; default only an absent value to 20 and fail startup for invalid supplied values. Use it to bound PostgreSQL Global history and Redis transient history; make Global insert+retention concurrency-safe and use a cross-instance atomic Redis rate limiter.
- [x] 3.3 Refactor chat responsibilities into Global PostgreSQL history, Redis-only transient/Journaling history, validated ChatService/orchestration, and thin controller/socket adapters. Retire stale drawer placeholder behavior and unsupported player-chat channels; remove unimplemented legacy handlers from the active contract without an unsafe destructive migration.
- [x] 3.4 Implement authenticated Global send/history APIs and the /game socket intent/event flow. Enforce only the Global send target, non-empty text, maximum 200 characters, one accepted message every five seconds per account, safe text rendering, chronology and cross-instance Redis pub/sub delivery.
- [x] 3.5 Implement character-scoped Redis Journal history and publication. Keep it out of PostgreSQL. Load still-retained Redis Journal entries after reload/reconnect without exposing another character's key or room.
- [x] 3.6 Emit Journal events only after the authoritative commit for a gathered item, skipped non-aggressive encounter, successful pre-combat dodge, successful in-battle FLEE, committed theft and committed food consumption. Format canonical item/map/monster names and avoid duplicate/false lines on retries, failed grants or failed theft rolls.
- [x] 3.7 Preserve all retained Global messages across API restart, cap persistent rows to the configured limit and document that Journal history has Redis-only durability. Keep Global fan-out failures logged and recoverable through the next history load.

## 4. Chat UI and layout

- [x] 4.1 Remove the old floating ChatDrawer mockup and header CHAT toggle; add the chat panel directly below the map within the Grind center column.
- [x] 4.2 Render five visible rows at a time, scroll older entries, combine Global/Journal by server timestamp and display at most 20 combined rows regardless of backend retention setting.
- [x] 4.3 Add single-line input, Send button, Enter-to-send, send/validation feedback and duplicate-submission protection. Clear the input only after accepted send.
- [x] 4.4 Add the Journal toggle, enabled by default and remembered locally. Turning it off hides Journal rows without disabling collection; re-enabling restores rows still in Redis. Preserve scroll position when reading older rows and auto-follow only when already at the bottom.
- [x] 4.5 Ensure the map and chat fit in the desktop central column without overlap or competing scrollbars; keep a usable map-then-chat flow at narrow widths.

## 5. Tests, validators and documentation

- [x] 5.1 Add deterministic simulator tests for Sting cast/resource/cooldown/self-target/one-use Tip of Pain behavior, doubled raw damage, normal mitigation, miss handling, Disarm duration and no recast loop.
- [x] 5.2 Add catalogue tests for species IDs, stats/roles/aggression/fire immunity, exact roster weights, drops/item names/icons, sprite dimensions/transparency and badge selection/tooltip.
- [ ] 5.3 Add gathering tests for exact material allow-lists, every listed weighted pool, maps without a pool, no Honeycomb leakage, Meat exclusion and no-drop/no-journal behavior. Static allow-list/pool assertions are covered, but the empty-pool MapService transaction and no-journal path still need an integration-level test.
- [ ] 5.4 Add chat tests for Global history across API restart/reconnect, DB retention under concurrent sends, invalid env values/channels, rate/length limits, cross-instance fan-out, Redis-only private Journal, 20-row frontend cap, timestamp merging and journal toggle persistence. Mocked service contracts pass; database concurrency/restart, multi-instance fan-out and end-to-end UI tests remain unverified.
- [ ] 5.5 Test each Journal trigger against committed outcomes and test that failed collection, unsuccessful dodge/FLEE, uncommitted theft, unavailable food and digestion skip create no success message. Formatter templates and deterministic Sting behavior are tested, but gameplay trigger commit boundaries and failed-trigger suppression need integration-level coverage.
- [x] 5.6 Update root SPEC.md and openspec/specs/SPEC.md carefully without overwriting existing differences; update ARCHITECTURE.md, .env.example and STATUS.md with the actual implemented boundaries, migration name, tests/results and remaining limitations.
- [ ] 5.7 Run the relevant focused suites, validators, shared/API/frontend builds, strict OpenSpec validation and git diff --check. Test migrations only against a disposable database; do not mutate a live DB or deploy as part of this work. Builds and offline focused suites pass; DB migration/integration testing remains intentionally unrun without a disposable database.
