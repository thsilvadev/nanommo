# Storage, Map, Balance and Progression Correction Requirements

## ADDED Requirements

### Requirement: Storage is a canonical Town-only NPC with private ten-slot storage

The system SHALL define one canonical Storage NPC with ID storage, name Storage, and exact monologue "You know I have a name, right? But you'll keep calling me Storage anyway." Every canonical map whose type is town SHALL reference this NPC by ID. Storage SHALL be presented as a storage capability, not as a vendor. All storage contents and transfer operations SHALL be character-private and server-authoritative.

#### Scenario: Storage exists on every Town-type map
- **GIVEN** the canonical map catalogue contains one or more records whose type is town
- **WHEN** map/NPC catalogues are validated
- **THEN** every such map references the canonical storage NPC
- **AND** each reference resolves to one canonical NPC definition
- **AND** no per-map duplicate Storage definition is created.

#### Scenario: Selecting Storage renders the character's Warehouse
- **GIVEN** a character is settled in a map whose canonical type is town
- **WHEN** the character selects Storage
- **THEN** the UI displays the exact monologue and 10 fixed square Warehouse slots
- **AND** the slots represent only that character's persisted inventory rows where location is warehouse
- **AND** the surface has no Vendor stock, price, buy/sell or gold actions.

#### Scenario: Double-click and drag/drop deposit a stack
- **GIVEN** a stack is displayed in Inventory and Storage is selected
- **WHEN** the character double-clicks the stack or drags it onto an eligible Warehouse slot/list
- **THEN** the whole source stack is deposited in one atomic server operation
- **AND** the source row is removed only if the complete transfer commits
- **AND** the displayed Inventory and Warehouse state refreshes from authoritative server state.

#### Scenario: Double-click and drag/drop withdraw a stack
- **GIVEN** a stack is displayed in Storage
- **WHEN** the character double-clicks it or drags it to an eligible Inventory slot/list
- **THEN** the whole source stack is withdrawn in one atomic server operation
- **AND** the source Warehouse row is removed only if the complete transfer commits
- **AND** both location views refresh from authoritative server state.

#### Scenario: Transfer destination cannot fit the whole stack
- **GIVEN** a transfer's destination has neither a compatible stack with enough room for the entire source stack nor a free slot
- **WHEN** the transfer is attempted
- **THEN** the server rejects the transfer without splitting/partially merging the stack
- **AND** source quantity/location, destination rows and slot indexes remain unchanged.

#### Scenario: Storage endpoint cannot be used outside settled Town
- **GIVEN** the character is on a grind map, has status other than town, or has a non-null pendingMapTransition
- **WHEN** any warehouse read, capacity or transfer endpoint is called directly
- **THEN** the server rejects it
- **AND** no Warehouse row is returned or mutated, including through legacy /inventory/warehouse and /inventory/to-warehouse or /inventory/from-warehouse routes.

### Requirement: Storage transfers are full-stack, atomic and row-locked

Every inventory↔warehouse transfer SHALL move one identified source InventoryItem row/stack and SHALL be performed in one PostgreSQL transaction. The transaction SHALL lock the Character first, then revalidate/lock source and destination rows in a stable order, verify destination capacity, and commit source removal and destination merge/insertion atomically. Inventory capacity is 50 slots; Warehouse capacity is 10 slots. Stackable items cannot exceed their catalogue maxStack. A merge is permitted only when the entire source quantity fits one destination stack; otherwise the complete stack requires a free destination slot. Equipment instanceData SHALL be preserved. Direct or concurrent endpoint calls SHALL not duplicate, lose, partially move or overwrite items.

#### Scenario: Concurrent requests cannot double-transfer a stack
- **GIVEN** two requests try to move the same source row simultaneously
- **WHEN** the transactions acquire their locks and revalidate the row
- **THEN** at most one request moves the source stack
- **AND** the other request fails with no duplicated item quantity.

#### Scenario: Inventory and Warehouse slot constraints stay valid
- **GIVEN** a successful transfer or merge
- **WHEN** the transaction commits
- **THEN** every row has a unique valid slot index in its own location
- **AND** Inventory and Warehouse remain within their slot limits
- **AND** no transient staging index remains committed.

### Requirement: Inventory overflow never stores combat drops in Warehouse

Generic inventory grants SHALL NOT silently fall back from Inventory to Warehouse. Warehouse rows SHALL be created only by an explicit, authorized Town Storage transfer. A battle drop is granted only when the entire drop stack can fit in Inventory by compatible full-stack merge or free slots under catalogue stacking rules. If it cannot fit, that drop is discarded and logged, and battle resolution continues without rollback due solely to that drop.

#### Scenario: Drop fits a compatible Inventory stack
- **GIVEN** the Inventory has a compatible stack with capacity for the complete drop quantity
- **WHEN** the battle resolves
- **THEN** the entire drop is added to Inventory
- **AND** no Warehouse row is written.

#### Scenario: Inventory is full and drop cannot fit
- **GIVEN** the entire drop cannot fit any compatible stack and no free Inventory slot exists
- **WHEN** the battle resolves
- **THEN** the drop is discarded and recorded with character, battle, item/drop ID and quantity
- **AND** the battle's XP, gold, other eligible drops, Auto Feed handling and resolved marker still commit normally
- **AND** no Inventory or Warehouse quantity is partially mutated for the discarded drop.

#### Scenario: Generic item grant cannot auto-deposit
- **GIVEN** an item grant uses the generic inventory service and Inventory has no room
- **WHEN** the grant is attempted
- **THEN** it does not create or modify Warehouse rows implicitly
- **AND** the calling business operation handles the capacity failure according to its own explicit contract.

### Requirement: Map board renders fixed square tiles in one horizontal row

The map-art surface SHALL show Town first at the left, followed by all six current grind maps to its right. The canonical coordinates SHALL be Town (0,0), then grind maps at x=1 through x=6 with y=0. Every tile SHALL use a fixed equal width and height and SHALL remain a perfect square independent of container width. The tiles SHALL neither wrap into multiple rows nor expand to full container width. Narrow viewports MAY scroll horizontally while preserving tile dimensions and order.

#### Scenario: Desktop map board has seven equal square tiles
- **GIVEN** the canonical map board is rendered on desktop
- **WHEN** the layout is measured
- **THEN** seven tiles appear side-by-side in one row, Town first
- **AND** every tile has equal fixed width and height
- **AND** each grind map is to the right of Town in increasing level order.

#### Scenario: Narrow viewport preserves tile shape
- **GIVEN** the map panel is narrower than the combined tile row
- **WHEN** the board renders on mobile or a narrow desktop
- **THEN** the tiles keep their fixed square dimensions
- **AND** horizontal scrolling exposes the remaining tiles without wrapping or shrinking them into rectangles.

### Requirement: Every newly introduced item, skill and status has a shipped runtime icon

Every new item introduced by the monster/map overhaul SHALL have framed and frameless SVG variants at the exact item-icon paths used by CatalogService. Every new player/monster skill or status effect SHALL have a corresponding SVG at the exact runtime path. An asset validator SHALL compare catalogue IDs with shipped asset paths so missing icons fail validation/build checks rather than silently displaying broken images.

#### Scenario: New monster-part item icons are complete
- **GIVEN** any of the 24 new monster-part IDs is present in the item catalogue
- **WHEN** the asset validator runs
- **THEN** both assets ui/items/svg/monster_parts/{id}.svg and ui/items/svg-noframe/monster_parts/{id}.svg exist.

The required new item IDs are: part_mudflatcrocodile_common, part_mudflatcrocodile_rare, part_bandit_common, part_bandit_rare, part_kwaioua_ranger_common, part_kwaioua_ranger_rare, part_sacredforestguardian_common, part_sacredforestguardian_rare, part_gravelhorn_common, part_gravelhorn_rare, part_ridgebreaker_common, part_ridgebreaker_rare, part_saltfangcrab_common, part_saltfangcrab_rare, part_needlebackstalker_common, part_needlebackstalker_rare, part_giantmosquito_common, part_giantmosquito_rare, part_rootboundbrute_common, part_rootboundbrute_rare, part_moonleafarcanist_common, part_moonleafarcanist_rare, part_aramaianwarden_common, and part_aramaianwarden_rare.

#### Scenario: New monster skill icons are complete
- **GIVEN** the skill catalogue is loaded
- **WHEN** icon completeness is validated
- **THEN** these icons exist under ui/skill-icons: monster_skill_pickpocket, monster_skill_poison_sting, monster_skill_prowess, monster_skill_physical_reflection, monster_skill_magic_reflection, monster_skill_rage, monster_skill_opening_spear and monster_skill_arcane_surge.

#### Scenario: New status icons are complete
- **GIVEN** the canonical status catalogue is loaded
- **WHEN** icon completeness is validated
- **THEN** these icons exist under ui/status: poison, prowess, physical_reflection, magic_reflection, rage and silence.

#### Scenario: Future catalogue icons cannot silently go missing
- **GIVEN** an item, skill or status has no required runtime asset
- **WHEN** catalogue/asset validation runs
- **THEN** validation fails with the catalogue ID and missing path
- **AND** the validator includes all catalogue categories, not only this change's fixed ID list.

### Requirement: Monster HP is reduced by forty percent at level 15 and above

Using the canonical catalogue at git baseline HEAD a5fd8b3 as the unscaled baseline, the canonical monster catalogue SHALL set HP for every monster with level >= 15 to max(1, round(baselineHp × 0.60)), where baselineHp is that monster's pre-change canonical HP. Monsters below level 15 and all non-HP fields SHALL remain unchanged. Root and frontend public monster catalogues SHALL be kept identical. Existing precomputed battle logs/snapshots and resolved history SHALL not be rewritten.

#### Scenario: Level 15 or higher monster uses reduced HP
- **GIVEN** a monster's pre-change level is 15 or above
- **WHEN** the updated catalogue is validated
- **THEN** its HP equals max(1, round(baselineHp × 0.60))
- **AND** this reduction is applied exactly once, including monsters not currently assigned to a grind-map roster.

#### Scenario: Lower-level monster is unchanged
- **GIVEN** a monster's level is below 15
- **WHEN** the updated catalogue is compared to the baseline
- **THEN** its HP is unchanged
- **AND** the catalogue's other fields are unchanged for all monsters.

#### Scenario: Existing queued battle retains its original snapshot
- **GIVEN** an unresolved or resolved battle was precomputed before the catalogue update
- **WHEN** the new catalogue is loaded
- **THEN** its persisted log, seed, outcome, HP snapshot and reward remain unchanged
- **AND** newly generated battles use the new monster HP.

### Requirement: Character and monster status icons use one real-time timeline projection

The summary STATUS area and Grind monster STATUS area SHALL use the same reusable pure timeline projection over an immutable battle snapshot and the battle's canonical ordered events, evaluated at the same display tick. Event target determines the combatant that owns a status; actor/sourceActor identify the source, not the recipient. The projection SHALL apply status-applied, refreshed, stack-applied, stack-lessened, ended and expired events, respecting per-stack expiry, max stacks, catalogued refresh rules and explicit removal. Untimed effects remain active until an explicit removal or battle end. A status is not active at a display tick equal to its expiresAtTick. The projection SHALL not run combat or mutate the persisted log.

#### Scenario: Poison status starts and expires in sync with the live log
- **GIVEN** a battle log applies Poison to the character on tick T and ends/expires it on tick U
- **WHEN** the display tick crosses T and U
- **THEN** the summary Poison icon appears at T and disappears at U
- **AND** the icon timing agrees with the log event timing rather than a separate timer.

#### Scenario: Source and target are not confused
- **GIVEN** the character applies a status to the monster, or the monster applies one to the character
- **WHEN** the target status projection replays the event
- **THEN** only the actual target receives the status icon
- **AND** the actor/source remains source metadata only.

#### Scenario: Stacks and same-tick events are replayed deterministically
- **GIVEN** a stackable effect receives multiple applications, an explicit stack decrement, refresh, expiry or end event, including multiple events on one tick
- **WHEN** the projection evaluates through that tick
- **THEN** events are consumed in persisted array order
- **AND** each stack's duration and the resulting visible stack count match the canonical battle log
- **AND** untimed statuses are not prematurely removed by an invented duration.

### Requirement: Mastery levels and progress derive from one cumulative XP threshold table

Mastery XP SHALL remain cumulative in weapon_proficiencies.xp. The level SHALL be derived through the shared canonical threshold table, and the frontend SHALL use the same shared helper/data rather than legacy weapon_xp_curve.json per-level values. This change sets the cumulative Level 7 threshold to 20,000 while retaining the other defined thresholds: levels 1–6 at 5, 10, 25, 50, 100, 500; Level 8 at 35,000; Level 9 at 45,000; and Level 10 at 60,000. Mastery remains capped at Level 10. Level-relative progress SHALL be computed as cumulative XP minus the threshold for the current level, over the distance from the current-level threshold to the next threshold.

#### Scenario: Existing Greatsword XP reaches Level 7
- **GIVEN** a Greatsword proficiency row has cumulative XP 20,120
- **WHEN** level and display progress are derived using the canonical thresholds
- **THEN** Mastery level is 7
- **AND** level-relative progress is 120 / 15,000 toward Level 8 (whose threshold is 35,000)
- **AND** the UI does not display cumulative XP 20,120 against the obsolete per-level requirement 13,674.

#### Scenario: Reconciled level yields available point without respec
- **GIVEN** the row has 20,120 cumulative XP, six spent skill points, and existing allocated ranks
- **WHEN** the stored derived level is reconciled to 7
- **THEN** available points derive as max(0, 7 - 6) = 1
- **AND** cumulative XP, skillRanks and spentSkillPoints remain unchanged.

#### Scenario: Threshold boundary and maximum level are consistent
- **GIVEN** cumulative XP values immediately below and at 20,000, 35,000 and the Level 10 threshold
- **WHEN** API and UI derive progression
- **THEN** both use the same levels and relative progress
- **AND** Level 10 uses a capped display with no invalid next-threshold division.

#### Scenario: Mastery UI refreshes after authoritative battle resolution
- **GIVEN** a battle awards Mastery XP and BattleService commits it
- **WHEN** battle:resolved reaches the Character/Play UI
- **THEN** XP, derived level, progress, category selector and available points refresh without a page reload
- **AND** the frontend never awards or increments XP independently.

### Requirement: One-time map reset moves all players to current Town without corrupting battles

A one-time migration SHALL move every Character's current location to the canonical map_town and settle characters with no already-started unresolved battle in Town. It SHALL remove stale unstarted future battle entries so old map IDs/outcomes cannot resume Grind. If a battle entry has already started or is due and unresolved at migration time, the migration SHALL preserve the earliest such entry and its immutable battle payload, discard only later unresolved successors, and set a Town pending transition so the existing resolver settles Town after that entry's normal payout. Resolved history SHALL never be rewritten or deleted. The migration SHALL not change XP, level, inventory, equipment, gold, HP/SP, Diet, quests or other unrelated character progression.

#### Scenario: Character with only future precomputed battles goes to settled Town
- **GIVEN** a character is grinding but all unresolved battle entries have startAt after migration time
- **WHEN** the migration is applied
- **THEN** the character is at map_town with status town and pendingMapTransition null
- **AND** its unstarted battle entries are removed
- **AND** resolved history and unrelated character state are preserved.

#### Scenario: Already-started or due battle completes before Town is settled
- **GIVEN** a character has an earliest unresolved battle whose startAt is at or before migration time
- **WHEN** the migration runs in the controlled maintenance window
- **THEN** that battle's log, seed, outcome and payout inputs are preserved unchanged
- **AND** only its later unresolved successors are removed
- **AND** the character is marked currentMapId map_town/status town with a pending Town transition
- **AND** Storage/NPC access is denied until the preserved battle resolves and clears the pending transition.

#### Scenario: Redis and delayed jobs cannot restore old Grind presence
- **GIVEN** characters and their queue entries have been migrated
- **WHEN** startup queue/presence reconciliation runs before workers accept work
- **THEN** cancelled future battle jobs and redundant top-up jobs are removed or made safe no-ops
- **AND** settled characters are counted only in Town presence
- **AND** pending-transition characters are excluded from gameplay map presence until the transition settles
- **AND** no old-map presence membership can start or revive a Grind run.

#### Scenario: Migration is repeat-safe and preserves history
- **GIVEN** the migration/reconciliation is retried or tested more than once
- **WHEN** it encounters already-settled Town characters or already-resolved entries
- **THEN** it does not change resolved history or duplicate state mutations
- **AND** already-started unresolved battle data remain byte-for-byte unchanged.

### Requirement: Vendor sell quantity is scoped to the selected stack
When a player drags an Inventory stack to a Vendor and opens the sell modal, the modal's maximum sell quantity MUST be limited to the quantity in that selected stack (and must not exceed the character's currently owned quantity). The All button MUST select that maximum. It MUST NOT aggregate other Inventory stacks of the same item. Buy modal All behavior remains unchanged.

#### Scenario: All selects only the dragged stack quantity
- **GIVEN** the Inventory contains 80 potions in four stacks of 20
- **WHEN** the player drags one stack of 20 onto a Vendor and clicks All in the sell modal
- **THEN** the selected sell quantity is 20, not 80
- **AND** the maximum quantity does not exceed the current owned total if inventory changes while the modal is being prepared.

#### Scenario: Buy modal All remains unchanged
- **GIVEN** a Vendor buy modal has a calculated maximum quantity based on stock, gold and capacity
- **WHEN** the player clicks All
- **THEN** the quantity is set to the existing buy modal maximum.

### Requirement: Migrations, worker startup, and queue maintenance fail closed

The API SHALL NOT automatically run TypeORM migrations or schema synchronization during normal application startup. The migration-history preflight SHALL use read-only database queries; it MUST NOT invoke TypeORM `showMigrations()` if doing so could create a missing migration-history table. If migrations are pending while the history table is missing/empty, or any incremental migration is pending at normal startup, startup SHALL fail before processing delayed battle jobs. An unknown legacy migration baseline MUST NOT be guessed or repaired automatically.

The queue startup process SHALL acquire a distributed maintenance lease, close the shared Redis gate, pause Bull globally and drain active jobs before reconciling database queue rows, delayed jobs, and authoritative MapPresence. Any migration-history, database, queue, or Redis/presence reconciliation failure MUST leave the gate closed and Bull paused. Only successful reconciliation may open the shared gate and resume the queue. A stopped-consumer maintenance entry point SHALL NOT register Bull processors and SHALL leave the gate closed/queue paused when it returns.

A legacy migration baseline may only be recorded by an explicit operator command after manually auditing the live schema/data against a chronological prefix of legacy migrations. It SHALL require stopped-consumer confirmation and an audit acknowledgement, SHALL never baseline newly introduced Town-reset/Mastery reconciliation migrations, and SHALL only write migration-history metadata. It MUST NOT change gameplay rows or infer the baseline from table existence alone.

#### Scenario: Missing or empty migration history is not silently replayed
- **GIVEN** the live schema already has application tables and the TypeORM migration-history table is missing or empty while registered migrations are pending
- **WHEN** migration preflight runs
- **THEN** the command fails closed and reports that an audited baseline is required
- **AND** it does not create the migration-history table, run historical migrations, mutate application data, or release battle workers.

#### Scenario: Queue or presence repair fails during startup
- **GIVEN** Redis, database queue reconciliation, or MapPresence rebuilding returns an error
- **WHEN** startup recovery runs
- **THEN** the readiness gate remains closed and the Bull queue remains globally paused
- **AND** the application fails startup rather than accepting work on partially reconciled state.

#### Scenario: Offline maintenance cannot start processors or resume the queue
- **GIVEN** all API/Bull consumers have been stopped and the operator runs the explicit reconciliation context
- **WHEN** it repairs DB entries, delayed jobs, and MapPresence
- **THEN** no Bull processor is registered in that context
- **AND** it leaves the shared gate closed and Bull paused on success or failure
- **AND** only a later normal API startup can repeat the preflight/reconciliation and open/resume the queue.
