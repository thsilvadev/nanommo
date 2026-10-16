# Tasks

## 1. Canonical catalogues, Storage placement and guard

- [x] 1.1 Extend root maps.json with one canonical NPC-ID list per map. Add the existing NPC references to map_town and ensure every map with type=town lists storage. Update the frontend public maps.json mirror and preserve all existing map/roster metadata other than the approved coordinates.
- [x] 1.2 Add the single Storage NPC definition to npc_catalog.json with the exact user-supplied monologue, location=town and types=[storage]. Keep it separate from Vendor and quest capability contracts.
- [x] 1.3 Extend map/NPC DTOs and TownService discovery so NPCs are selected from the current canonical Town-type map's NPC references. Return monologue in the public NPC payload and preserve all existing behavior for William, Father Marcelus, Loren and Cecilia on map_town.
- [x] 1.4 Replace hardcoded map_town-only Town guards where appropriate with one canonical map type=town, character status=town, pendingMapTransition=null guard. Apply it to every Town Storage read/capacity/write endpoint and to legacy /inventory/warehouse, /inventory/to-warehouse and /inventory/from-warehouse routes.
- [x] 1.5 Add boot/catalogue validation for map NPC IDs, exactly one canonical Storage definition, exact monologue text and presence of storage in every type=town map. Add service tests for current map/type resolution and future town maps.

## 2. Atomic full-stack Warehouse transfers

- [x] 2.1 Design one row-ID-based transfer operation covering Inventory→Warehouse and Warehouse→Inventory. Lock Character first, then source/destination inventory rows consistently; validate row ownership, current location, destination, slot capacity, max stack and instanceData inside a single transaction.
- [x] 2.2 Implement whole-stack transfer semantics: merge only when an existing destination stack can take the full source quantity; otherwise require a free slot. Never partially merge, split, duplicate or silently route a failed transfer. Guarantee all slot indexes are valid and unique at commit.
- [x] 2.3 Replace the unimplemented TownService deposit/withdraw stubs and delegate legacy inventory warehouse endpoints to the same guarded transactional implementation. Ensure reads/capacity are also Town-guarded.
- [x] 2.4 Add Storage mode to Town NPC UI with the exact monologue, 10 fixed square cells in a 5×2 grid, existing item icons/tooltips, and no Vendor prices/buttons/modals. Show the player's real Warehouse rows.
- [x] 2.5 Connect Inventory and Storage as bidirectional CDK drop targets. Double-click an Inventory item deposits it only while Storage is selected; double-click a Warehouse item withdraws it. Preserve existing consumable/equipment double-click semantics outside Storage mode, disable duplicate actions while busy, and reload authoritative lists after success/rejection.
- [x] 2.6 Add API/controller/service tests for Town authorization on reads and writes, JWT character isolation, row-ID source selection, full destination failure with source unchanged, equipment instanceData, whole-stack merge/free-slot fallback, slot collisions and concurrent transfer calls. Frontend Chrome tests cover both drag directions, both double-click directions, Storage selection, vendor scoping and All behavior.

## 3. Remove hidden drop-to-Warehouse fallback

- [x] 3.1 Audit every InventoryService.addItem caller and remove generic implicit overflow-to-Warehouse behavior. Make explicit Storage transfers the only ordinary path that writes location=warehouse.
- [x] 3.2 Add an atomic/preflight Inventory-only grant path for battle drops. It must calculate whether the complete stack fits before mutating any stack or slot. Avoid relying on catching an exception after a partial merge.
- [x] 3.3 Change BattleService drop resolution so each fitting drop is granted to Inventory; each non-fitting drop is recorded/logged as discarded with character, battle, item/drop ID and quantity. Continue the same payout transaction for all other effects and drops.
- [x] 3.4 Add direct-run capacity-matrix tests for compatible-stack fit, free-slot/multi-slot fit, full Inventory, insufficient partial-stack room, independent Warehouse occupancy and multi-drop best-effort behavior. A resolver code-contract assertion verifies XP payout precedes drop processing and the resolved marker/commit follows it; each failed drop is caught or skipped without escaping the battle transaction. PostgreSQL-backed transaction testing remains separately gated on database access.
- [x] 3.5 Verify generic grants cannot write Warehouse, Auto Feed counts/removes Inventory only, a Warehouse-only food is unavailable, and an `Insufficient item quantity` Auto Feed race is a normal skipped candidate.

## 4. Horizontal map-art board

- [x] 4.1 Update root maps.json and apps/frontend/public/data/maps.json coordinates to Town=(0,0), map_lv_1=(1,0), map_lv_6=(2,0), map_lv_11=(3,0), map_lv_16=(4,0), map_lv_21=(5,0), map_lv_26=(6,0), with no other catalogue changes.
- [x] 4.2 Replace the one-column/full-width CSS with a single seven-tile row using one fixed tile-size token, equal fixed columns/row and square tile boxes. Prevent shrinking/wrapping; use horizontal overflow/scroll when the container is too narrow.
- [x] 4.3 Catalogue coordinate/mirror tests pass. Playwright Chromium smoke in a desktop viewport and a 390px mobile viewport confirms seven fixed square tiles in order, one row, and horizontal overflow without shrink/wrap; screenshots were visually reviewed.

## 5. Add all missing item/skill/status icons

- [x] 5.1 Add both framed and frameless SVG item icons under apps/frontend/assets/ui/items/svg/monster_parts and apps/frontend/assets/ui/items/svg-noframe/monster_parts for: part_mudflatcrocodile_common, part_mudflatcrocodile_rare, part_bandit_common, part_bandit_rare, part_kwaioua_ranger_common, part_kwaioua_ranger_rare, part_sacredforestguardian_common, part_sacredforestguardian_rare, part_gravelhorn_common, part_gravelhorn_rare, part_ridgebreaker_common, part_ridgebreaker_rare, part_saltfangcrab_common, part_saltfangcrab_rare, part_needlebackstalker_common, part_needlebackstalker_rare, part_giantmosquito_common, part_giantmosquito_rare, part_rootboundbrute_common, part_rootboundbrute_rare, part_moonleafarcanist_common, part_moonleafarcanist_rare, part_aramaianwarden_common and part_aramaianwarden_rare.
- [x] 5.2 Add apps/frontend/assets/ui/skill-icons SVGs for monster_skill_pickpocket, monster_skill_poison_sting, monster_skill_prowess, monster_skill_physical_reflection, monster_skill_magic_reflection, monster_skill_rage, monster_skill_opening_spear and monster_skill_arcane_surge.
- [x] 5.3 Add apps/frontend/assets/ui/status SVGs for poison, prowess, physical_reflection, magic_reflection, rage and silence.
- [x] 5.4 Reviewed a contact sheet of all 38 new icons; framed/frameless variants have consistent viewBox/padding, readable distinct silhouettes and common/rare treatments. Production build contains all referenced SVGs; existing assets/catalog IDs were preserved.
- [x] 5.5 Reusable UI asset validator checks all current catalogue IDs using runtime paths, both item variants, new IDs and future catalog additions, and verifies assets exist in the production build (288 paths in the current catalog).

## 6. Reduce HP for every level-15+ monster

- [x] 6.1 Record/use monsters.json at git baseline HEAD a5fd8b3, before this change is applied, as the baseline and set each monster with level>=15 to max(1, round(baseline HP × 0.60)), including species not assigned to a current map. Apply the transformation once.
- [x] 6.2 Make no changes to level, XP, attack/defense, skills, Gambits, drops, presence rates or any other field; assert every monster below level 15 retains exact HP and all other fields remain unchanged.
- [x] 6.3 Copy the resulting canonical monster JSON exactly to apps/frontend/public/data/monsters.json.
- [x] 6.4 `validate-monster-hp-adjustment.js` compares every row against immutable git baseline a5fd8b3, applies the exact transform only once to level>=15 rows, verifies below-15/all other fields unchanged and root/public byte identity. No database or battle snapshots were modified.

## 7. Unify the real-time status icon timeline

- [x] 7.1 Inspect initial player/monster status snapshots and payload variants for status_applied, status_refreshed, status_stack_applied, status_stack_lessened, status_ended and status_expired. Document the real fields and their array order before coding; do not guess incompatible payloads.
- [x] 7.2 Implement one pure reusable status timeline projector used by Character summary and Grind monster STATUS. Feed both the same battle entry, header snapshot, target and display tick; replay eligible events in persisted array order and filter status ownership by target.
- [x] 7.3 Shared projection now replays full opening snapshot and event history before final display-tick expiry filtering. Tests include exact expiry, old-stack removal when a later stack has a different lifetime, equal-tick order, refresh, zero-duration, target ownership and DoT not creating stacks; battle logs are immutable.
- [x] 7.4 Remove/replace both current independent reducers without regressing icon position, Freeze frame, stack badges, tooltips, trackBy and viewport-aware tooltip behavior. Load icons from canonical status IDs including newly added Poison, Prowess, reflection, Rage and Silence.
- [x] 7.5 Direct-run reducer suite covers Poison apply/expiry, simultaneous events/DoT, both source-target directions, refresh, independent stack lifetimes, stack decrement, explicit ended/expired events, zero-duration and unknown status IDs, and equal-tick order.
- [x] 7.6 Chrome component tests drive the same immutable battle entry through controlled ticks and verify Character Summary/Grind state agrees at apply, refresh/end, independent stack expiry and battle end. Full authenticated visual smoke of rendered status icons remains explicitly open as 12.2.

## 8. Correct Greatsword Mastery Level 7 and UI progress

- [x] 8.1 Change the canonical shared cumulative threshold table so Level 7 begins at 20,000 while other current thresholds remain 5, 10, 25, 50, 100, 500, 35,000, 45,000 and 60,000 for levels 1–6 and 8–10. Export one helper/data source for API and frontend; retain weapon_xp_curve.json as legacy/reference only.
- [x] 8.2 Fix the Character Mastery UI to show level-relative progress (current total XP minus current level's cumulative threshold, over the gap to next cumulative threshold); for total 20,120 display Level 7 and XP 120 / 15000. Show total cumulative XP in accessible detail and handle the level-10 cap without bogus next XP or division by zero.
- [x] 8.3 Derive available skill points as max(0, level - spentSkillPoints). Ensure Greatsword with XP 20,120 and six spent points exposes one point while every rank/spent point remains unchanged.
- [x] 8.4 Add a separate later one-time transactional TypeORM migration (recommended ID 1799100000000-ReconcileMasteryLevelsForCumulativeXp) to recalculate only stored WeaponProficiency.level from XP and canonical thresholds. Treat it as forward-only; do not provide a down migration that silently lowers levels or changes allocated ranks after gameplay resumes. Preserve XP, skillRanks, spentSkillPoints, row IDs and character state. Document the forward-only behavior and a safe recovery procedure; do not reset trees or refund/rewrite points.
- [x] 8.5 Refresh Mastery rows/UI after authoritative battle:resolved so XP, level, progress, points and selected category reflect committed data without reload and without client-side XP awards.
- [x] 8.6 API/shared tests cover 19,999/20,000/20,120/34,999/35,000/60,000 and cap, relative progress/points and forward-only migration preservation. Chrome component test reloads authoritative Mastery rows (including ranks) to verify post-resolution refresh. Root SPEC mirror is identical.

## 9. Reset every character to current Town safely

- [x] 9.1 Add a new monotonic TypeORM migration after migration 1798000000000 (recommended ID 1799000000000-ResetAllCharactersToCurrentTown). Run it only with API/queue consumers stopped. Move every Character currentMapId to map_town and status to town; preserve all unrelated character data and increment stateVersion where authoritative location changes.
- [x] 9.2 In migration, identify the earliest unresolved BattleQueueEntry with startAt<=migration time for each character. If none has started, remove all unresolved pre-generated entries and settle pendingMapTransition=null. If one has started/is due, preserve its immutable row/job inputs, delete only later unresolved successors and set pendingMapTransition to the canonical Town request while currentMapId/status are Town. Never modify or delete resolved history.
- [x] 9.3 `reconcile:battle-queue` is a dedicated post-migration maintenance entry point requiring explicit stopped-consumer confirmation and registering no Bull processors. Queue/Redis gate is closed and Bull paused; failures fail closed. Normal startup drains jobs, reconciles state, validates migration history, then opens the gate and resumes Bull only on success. Reconciliation removes stale future jobs, preserves the earliest started battle row/job input, repairs missing resolver jobs, makes deleted-row jobs safe no-ops, and filters top-up to valid Grind characters.
- [x] 9.4 Full authoritative MapPresence rebuild deletes stale Redis-only hashes/memberships, recomputes all current map memberships from Character rows and excludes every pending transition. It is sequenced before queue gate release; direct test covers stale map removal and excluded pending character.
- [x] 9.5 Deterministic direct-run contracts cover already-Town and dead states, valid Grind with future-only entries, active/due plus future chains, pending return, invalid maps, resolved history preservation, idempotency, Bull job cleanup/repair and refusal to top up Town. A true PostgreSQL/Redis end-to-end run remains unverified because the configured host `db` did not resolve from this workstation; do not treat the mock contract suite as a live database integration test.
- [x] 9.6 Operational order is documented and guarded: stop every API/Bull consumer; run the strictly read-only `db:migration:show`; if legacy history is absent/empty, manually audit schema and use the explicit `db:migration:baseline` only with audited boundary and stopped-consumer flags; run guarded `db:migrate` only with tracked baseline; run `reconcile:battle-queue` while consumers remain stopped; then restart normal API so it revalidates state and opens/resumes Bull. No migration/deploy was run.

## 10. Documentation and final verification

- [x] 10.1 Update root SPEC.md and synchronize openspec/specs/SPEC.md byte-for-byte when changes are applied. Include Storage/NPC placement, Town-type guard, whole-stack transaction, no implicit overflow, icon IDs/path rules, HP formula, shared status projection, changed Level 7 XP threshold and Town migration semantics.
- [x] 10.2 Update ARCHITECTURE.md with Storage and inventory transaction ownership, the one status projector, cumulative Mastery threshold source, and migration/startup queue/presence ordering.
- [x] 10.3 Update STATUS.md with changed files, tests actually run, browser checks actually completed, migrations added but not run, and explicit no-deploy state.
- [x] 10.4 Builds, available direct-run service/contract tests, migration contract tests, Chrome component suite, map Playwright smoke, icon contact-sheet review, catalogue validators, strict OpenSpec validation and diff checks all passed in the final validation pass. Database-backed integration was unavailable, documented separately.
- [x] 10.5 Monster catalogue validator compares against baseline commit and passes only the approved HP transform/root-public mirror. Map mirrors, SPEC mirror and all icon paths pass. No DB/battle snapshot was modified and no deploy occurred.

## 11. Vendor sell modal stack-scoped All button

- [x] 11.1 When an Inventory stack is dropped onto a Vendor, pass the dragged row quantity into the sell modal. For stackable items, maxQuantity must be min(selected stack quantity, currently owned quantity), not the sum across all Inventory rows.
- [x] 11.2 Keep All bound to modal.maxQuantity; for 80 potions in four stacks of 20, dragging one stack and pressing All must set sell quantity to 20. Non-stackable items remain limited to one.
- [x] 11.3 Direct helper regression covers 80 items in four stacks of 20 and caps the selected stack to 20; Chrome component tests also cover vendor sell stack scoping and unchanged buy-modal All behavior.



## 12. Environment-dependent validation boundary

- [ ] 12.1 Run a read-only migration-history audit and a PostgreSQL/Redis/Bull end-to-end reconciliation test from a host/container where the configured DB service is reachable. The workstation attempt failed at DNS resolution (`getaddrinfo EAI_AGAIN db`) before a database connection; no table/schema/data was changed. Do not unblock startup or replay old migrations by guessing the baseline.
- [ ] 12.2 Complete full authenticated application visual smoke for status icons after a reachable API/database is available. Current controlled-tick Chrome component tests and the separate map-layout Playwright smoke pass, but do not substitute for an authenticated end-to-end live battle view.
