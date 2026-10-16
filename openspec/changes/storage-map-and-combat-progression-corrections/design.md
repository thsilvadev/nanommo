# Design — Storage, Map and Combat Corrections

## Architectural guardrails

- maps.json, monsters.json, items.json, skill_trees.json and status_effects.json remain canonical root catalogues. Frontend copies must be byte-equivalent JSON mirrors for the files already mirrored.
- Never fork combat rules in Angular. HP tuning is catalogue data; status panels project the persisted/simulated battle log; battle payouts and drop decisions remain in BattleService.
- Use existing Town guard and Character-first transaction/row-lock conventions. No frontend guard may be treated as authorization.
- Do not edit any resolved battle or the immutable snapshot of the one battle that has already started. Removing future unresolved queue rows is allowed only as part of the explicit map reset and must be paired with delayed-job cleanup/reconciliation.
- Preserve unrelated work and do not opportunistically refactor the unfinished monster-catalog overhaul.

## 1. Storage NPC data and town-map membership

### Canonical data model

Add one NPC definition in root npc_catalog.json:

- id: storage
- name: Storage
- location: town
- types: ["storage"]
- monologue: "You know I have a name, right? But you'll keep calling me Storage anyway."

The monologue is exact, including punctuation. Storage is an inventory capability, not a vendor. Its canonical definition must not contain a vendor stock, prices, buy/sell rules or quest dialogue.

Extend maps.json map records with an optional explicit NPC-ID list (for example npcIds) rather than copying NPC definitions into map records. Every record with type: "town" must include storage in that list. For the current map_town retain current NPC availability as references too: william, father_marcelus, blacksmith_loren, cecilia and storage. Future Town-type maps may explicitly list other NPCs independently; the shared Storage ID remains the same. Validate every NPC reference against the NPC sources (William remains defined by the vendor catalogue; the other NPCs by npc_catalog.json). Keep map JSON structure/catalogue mirror and API map DTO consistent.

TownService.getTownNPCs() must resolve NPCs available on the character's actual canonical map rather than returning an unconditional global list. The map's canonical type and its NPC references decide visibility. npcPublic() must include monologue as public display data. Preserve existing NPCs and their behaviors in map_town.

### Town authorization

Replace currentMapId === map_town as the sole definition of a Town location in the shared Town guard. Resolve character.currentMapId through the canonical map catalogue and require all of:

1. Map type === "town".
2. Character status === "town".
3. pendingMapTransition === null.

The Storage read endpoints, capacity endpoint, and every transfer path must use this same guard. Also close the bypass through /inventory/warehouse, /inventory/to-warehouse and /inventory/from-warehouse: apply the same guard or safely delegate through the guarded Town service. During Grind or a pending Town return, those routes must reject without reading or mutating warehouse rows. A disabled UI is not enough.

## 2. Storage UI and atomic full-stack transfers

Reuse the established item icon, tooltip, drag preview, placeholder and fixed-slot patterns from Vendor/Inventory. Do not implement Storage by labeling it vendor or routing it through buy/sell methods.

When Storage is selected:
- Display its exact monologue.
- Render exactly 10 player Warehouse slot cells in a 5-column, 2-row grid using fixed square cells like Vendor.
- Render actual InventoryItem rows scoped to location = warehouse, including quantity, frame/tier treatment and existing item tooltip.
- Keep Vendor greeting, price labels, infinity markers, quotes, purchase modals and selling behavior out of Storage mode.

Inventory → Storage drag/drop or double-click deposits the selected stack. Storage → Inventory drag/drop or double-click withdraws the selected stack. Double-click keeps existing consume/equip behavior when Storage is not selected; when Storage is active, it performs a transfer rather than consuming/equipping the selected item. Both directions should call one canonical row-ID-based transfer operation (do not identify the source merely by itemId when multiple stacks of that item may exist). Refresh/update both authoritative location lists after a committed transfer and leave the displayed source untouched on rejection.

### Transfer atomicity

Implement one transaction per transfer. Lock the Character row first; then lock/revalidate the source InventoryItem row and destination rows in a stable order. Validate the source's current location and that the destination is allowed. Inventory has 50 rows/slots; Warehouse has 10. Recheck stack capacity and slot indexes inside the transaction.

The transfer moves a whole source row/stack. For stackable items, merge only if an existing destination stack can accept the entire source quantity without exceeding maxStack. Otherwise use a free destination slot. Do not partially merge or split a stack to make a transfer succeed. If no full destination slot or full-stack merge is possible, reject the transfer and preserve the source row and quantity. Preserve instanceData for equipment and row identity/history where applicable; source removal and destination merge/insert must commit together. Enforce each location's slot range and uniqueness so no temporary or duplicate slot index can commit. Return authoritative inventory/Warehouse snapshots or an unambiguous result that causes both lists to reload.

## 3. Inventory-full drop behavior

The current InventoryService.addItem() implementation recursively redirects to warehouse when no Inventory slots remain. Remove this implicit fallback. Explicitly audit all addItem() callers so only intentional Storage transfer code can place rows in Warehouse.

Battle drop placement must be all-or-nothing per drop stack:
1. Calculate whether the entire drop quantity can fit in an existing inventory stack or in free inventory slots under the canonical stacking rules.
2. If it fits, grant it to Inventory.
3. If it does not fit, leave both locations unchanged for that drop and log/record it as discarded with character, battle/drop/item IDs and quantity.
4. Continue resolving the same battle and processing other independent drops. A discarded drop is not a battle failure and must not roll back XP, gold, other drops, Auto Feed or the resolved marker.

Do not first partially modify stacks and then discover the remaining quantity will not fit. Use a transaction-aware preflight/atomic grant that respects the current EntityManager and state. Keep the preceding Auto Feed inventory-scope fix: Warehouse never counts as food eligible for combat or consumption.

## 4. Horizontal map-art tiles

Update coordinates in both root and frontend public maps.json to one row:

| Map | x | y |
|---|---:|---:|
| map_town | 0 | 0 |
| map_lv_1 | 1 | 0 |
| map_lv_6 | 2 | 0 |
| map_lv_11 | 3 | 0 |
| map_lv_16 | 4 | 0 |
| map_lv_21 | 5 | 0 |
| map_lv_26 | 6 | 0 |

Keep map IDs, names, unlock levels, levels/ranges, rosters, type and click behavior unchanged. Use a single CSS tile-size token with fixed equal width/height and square aspect ratio for all seven tiles. Define a fixed seven-column, one-row grid (or an equivalent coordinate-driven non-wrapping row), make each column and row the same fixed tile size, and prohibit grid shrinking/stretching. The art viewport may be container-width but its children remain fixed-size; overflow is horizontal with touch/keyboard scroll on narrow displays. Town is first/left and map_lv_1 through map_lv_26 are ordered left-to-right. Do not put seven full-width rows back into the DOM and do not add vertical tile scrolling.

## 5. Icon completeness audit

The current runtime conventions are:
- Items: CatalogService.itemIcon(id, framed=false) loads /assets/ui/items/svg-noframe/{folder}/{id}.svg; framed presentations use /assets/ui/items/svg/{folder}/{id}.svg.
- Skills: /assets/ui/skill-icons/{skillId}.svg.
- Statuses: /assets/ui/status/{statusId}.svg.

Add both framed and frameless SVGs for all 24 new monster-part items:
- part_mudflatcrocodile_common, part_mudflatcrocodile_rare
- part_bandit_common, part_bandit_rare
- part_kwaioua_ranger_common, part_kwaioua_ranger_rare
- part_sacredforestguardian_common, part_sacredforestguardian_rare
- part_gravelhorn_common, part_gravelhorn_rare
- part_ridgebreaker_common, part_ridgebreaker_rare
- part_saltfangcrab_common, part_saltfangcrab_rare
- part_needlebackstalker_common, part_needlebackstalker_rare
- part_giantmosquito_common, part_giantmosquito_rare
- part_rootboundbrute_common, part_rootboundbrute_rare
- part_moonleafarcanist_common, part_moonleafarcanist_rare
- part_aramaianwarden_common, part_aramaianwarden_rare

Add all eight missing monster-skill icons:
- monster_skill_pickpocket — Pickpocket
- monster_skill_poison_sting — Poison Sting
- monster_skill_prowess — Prowess
- monster_skill_physical_reflection — Physical Reflection
- monster_skill_magic_reflection — Magic Reflection
- monster_skill_rage — Rage
- monster_skill_opening_spear — Opening Spear
- monster_skill_arcane_surge — Arcane Surge

Add all six missing status icons:
- poison — Poison
- prowess — Prowess
- physical_reflection — Physical Reflection
- magic_reflection — Magic Reflection
- rage — Rage
- silence — Silence

The 24 item IDs, eight skills and six status effects above are the new catalogue content introduced by the current monster/map overhaul relative to the pre-overhaul canonical data. Do not miss or rename those IDs. Match the established game icon family, clear silhouettes, padding and SVG viewBox sizes. Keep the currently existing icon files intact. Add a catalogue/asset validator that gathers item IDs from all item categories, skill IDs from player and monster skills, and status IDs from the canonical data and verifies each expected runtime icon path exists; item IDs must have both variants. Do not merely validate the files listed here—make it easy to add a future catalogued icon as a checked requirement.

## 6. Monster HP rebalance

Use the canonical monsters.json as it exists at git baseline HEAD a5fd8b3, immediately before this change is applied, as the baseline. Do not use origin/main from before the monster/map overhaul, and do not calculate from an already-scaled value. For every monster in monsters.json with level >= 15, set:

newHp = max(1, round(baselineHp * 0.60))

The baseline is the current value before this change, not a previously scaled result. Apply the reduction once only. Every monster below level 15 must retain its exact HP. Do not retune any other property. Include unassigned high-level monsters; do not limit the pass to currently selectable map rosters. Mirror all changed records exactly into apps/frontend/public/data/monsters.json.

The new HP affects encounters generated after the change is loaded. Keep the existing queue/snapshot contract: do not recompute, rescale or rewrite any unresolved persisted entry that has already been simulated, and never modify resolved histories. Test the formula over the entire catalogue and assert all below-15 HP values are unchanged.

## 7. Shared real-time status timeline

The summary currently computes activeStatusEffects('character') and Grind separately computes monsterStatusEffects(entry). Replace both reductions with one reusable pure timeline projector, ideally in shared frontend/core code with explicit typed input/output and no mutation of the source battle log. Both components pass the same battle entry/header snapshot, target actor, and the same authoritative display tick.

Projection contract:
1. Start from the immutable header combat snapshot for the requested target.
2. Replay battle events in their persisted array order through event.tick <= elapsedTick. Do not sort same-tick events by action/name; array order is the canonical ordering.
3. Apply status_applied, status_refreshed, status_stack_applied, status_stack_lessened, status_ended and status_expired using the real payload and the status-owner target field. Source fields (actor, sourceActor) are not ownership.
4. Respect per-stack application/expiry ticks, maxStacks, catalogued reapplication behavior, explicit remaining-stack counts, and explicit end events. Untimed entries (no expiry and no positive duration) remain active until an explicit removal or battle end; do not synthesize an expiry at their application tick.
5. Use the simulator's tick boundary consistently: an event first appears when its event tick is reached, and a status is expired before action processing at any tick tick >= expiresAtTick. At a display tick equal to expiresAtTick, it is not active. Same-tick status events and DoT events must be displayed consistently with the canonical event sequence.
6. Preserve current status icon placement/frame and tooltip behaviors; generate labels, stacks and remaining duration from the projection and canonical status catalogue. Do not duplicate effect rules or run combat on the frontend.

Poison is the main regression case: for both the character and monster targets, the Poison icon appears on the tick where the application log becomes visible and disappears at the logged expiry boundary or explicit removal. Add deterministic tests for apply/refresh, multiple stacks with independent expiry, stack decrement, explicit end/expiry, zero-duration statuses, incorrect source-vs-target assignment and same-tick events. Browser smoke must inspect panel-summary and Grind together at a controlled battle elapsed tick.

## 8. Mastery Level 7, threshold source and live UI

### One cumulative XP rule

The current gameplay source is packages/shared/src/battle-engine/mastery-rewards.ts, while the Character UI reads the legacy weapon_xp_curve.json and displays cumulative XP against its per-level xpToNext. Those values are not the same units, which causes labels such as XP 20120 / 13674.

Keep weapon_xp_curve.json as legacy/reference data only. Put the authoritative cumulative threshold table and helpers in a shared exported location usable by API and Angular. Define thresholds by resulting Mastery level, not by a UI-side reimplementation. Set the cumulative threshold for Level 7 to 20,000 XP, keeping these other existing thresholds as currently documented: Level 1 5, Level 2 10, Level 3 25, Level 4 50, Level 5 100, Level 6 500, Level 8 35,000, Level 9 45,000, Level 10 60,000. The complete zero-based boundary table is [0, 5, 10, 25, 50, 100, 500, 20000, 35000, 45000, 60000], capped at Level 10.

This change explicitly revises the previously provisional Level 7 threshold of 25,000 to 20,000 to meet the supplied real-game progression expectation. It does not add a character-name exception. With 20,120 cumulative XP, Greatsword derives to Level 7 and the level-relative progress display is XP 120 / 15000 (20,120 total; next boundary 35,000). At Level 10, show the cap state with no bogus next threshold or division by zero. Make cumulative XP discoverable in a tooltip/accessibility label if the primary display is level-relative.

### Stored rows, points and migration

weapon_proficiencies.xp is cumulative XP; level is derived. Add a one-time migration to recalculate only stored level values from cumulative XP using the canonical thresholds. Do not change XP, skillRanks, spentSkillPoints, proficiency row IDs, or Character data. Derive available skill points as max(0, level - spentSkillPoints). For the reported Greatsword character, with 20,120 cumulative XP and six spent points, Level 7 yields one available point; retain every rank and spent-point value exactly. The migration must be transactional, safe to rerun in tests, and use a threshold implementation/table identical to the runtime shared helper.

Refresh the Mastery view after each authoritative battle:resolved event (or the existing battle-resolution state path) so cumulative XP, level, level-relative progress, points, and category row are current without a page reload. Do not increment XP on the client and do not award it twice. Add tests at 19,999/20,000/20,120/34,999/35,000, Level 10 cap, points derivation, migration preservation, and refresh after a resolved event.

## 9. Move all characters to current Town safely

Add a new monotonic TypeORM migration after the existing 1798000000000-MonsterCatalogMapOverhaul migration (recommended ID 1799000000000-ResetAllCharactersToCurrentTown). Keep a separate later migration for the Mastery row reconciliation (recommended ID 1799100000000-ReconcileMasteryLevelsForCumulativeXp). Do not reuse a migration timestamp. The migration must change every Character's authoritative location to the current canonical map_town and status = 'town'; it must clear unrelated/stale transition values for characters who have no currently started unresolved battle. Do not reset character XP, level, HP/SP, food/diet, inventory, gold, skills, quests, equipment or timestamps unnecessarily; advance the relevant state revision consistently when the persisted authoritative state changes.

### Battle/queue safety

Because battle outcomes are pre-simulated and persisted, a map reset must not silently grant or lose a battle result. Under the controlled migration window (API/worker consumers stopped so jobs cannot race):
- For each character, identify the earliest unresolved entry whose startAt <= migration time. Treat an already-due but unresolved row as started/needs resolution too; a late or retried job must not be mistaken for a future entry.
- If no unresolved battle has started, delete all unresolved pre-generated battle entries for that character and set Town settled (currentMapId = map_town, status = town, pendingMapTransition = null).
- If one started/due unresolved battle exists, preserve only that earliest row and its immutable log/seed/outcome/job so its existing payout resolves once; delete only its later unresolved successors. Set the Character's current location to map_town and status to town, and set pendingMapTransition = { destinationMapId: 'map_town', reason: 'town_request' } as the safety fence. Existing resolver logic must then settle the pending transition after the preserved row resolves. The pending flag keeps NPC/Storage access blocked until that happens and prevents Grind queue top-up.
- Never rewrite/delete any resolved BattleQueueEntry row. Never recalculate the preserved started battle against the new monster HP or changed catalogue.

The DB migration cannot itself delete Redis/BullMQ jobs. Add a dedicated idempotent maintenance/reconciliation entry point that runs after the DB migration and before API/queue worker consumers start. The deployment must fail closed (do not start consumers) if reconciliation fails. The script/reconciler must: remove BullMQ delayed/repeat/top-up jobs for cancelled future entries and each reset character that are not the preserved started battle; a stale job for a deleted entry must be harmless/idempotent (NotFound is a discard, not a retry loop). Ensure no retained queue-battles job can generate new entries for a settled Town character. Reconcile authoritative map presence and Redis cache: settled characters belong to map_town, pending-transition characters are excluded until the battle resolves, and no character remains counted on removed/old map IDs. Use the existing MapPresenceService self-healing behavior as a fallback, not as the only deployment step.

The operational order must be explicit: stop API/queue worker consumers, apply DB migrations, run/complete and verify the dedicated queue/presence reconciliation while consumers are still stopped, then resume consumers. A startup hook alone is insufficient if Bull processors can consume jobs before the hook finishes. Add integration tests for Town characters, grinders with only future rows, a started battle plus future rows, already-due/stuck rows, dead/pending-transition characters, rerun/idempotency, and preservation of resolved/started log+seed+payout. The migration is not permission to cancel the one already-started fight or to rewrite history.

## 10. Documentation and verification

On apply:
- Update root SPEC.md and make openspec/specs/SPEC.md byte-identical. Document Storage map references, Town-type guarding, atomic full-stack transfer, no hidden overflow, the icon inventory, HP formula, status projector, Level 7 cumulative threshold=20,000 and the Town reset/queue safety fence.
- Update ARCHITECTURE.md for NPC placement lookup, Storage transactions, shared status timeline, Mastery threshold owner and migration/startup reconciliation ordering.
- Update STATUS.md with exact changed files, real test/build outcomes, known blockers, migration not-run and no-deploy state. Keep all unverified browser claims explicitly unverified.

Required checks: catalogue mirror equality/validation; icon coverage validation; all monster HP formula and unaffected below-15 HP tests; transaction tests for capacity failure and concurrent transfer; drop-fit/drop-discard tests; Storage town authorization for all endpoints; horizontal map layout desktop/mobile smoke; target/tick status projection tests and browser verification; Mastery threshold/progress/refresh/migration tests; Town migration plus BullMQ/Redis reconciliation integration tests; shared/API/frontend production builds; strict OpenSpec validation; git diff --check. No deployment or migration execution is included in implementation verification unless separately authorized.
