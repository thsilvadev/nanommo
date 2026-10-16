# Storage, Map Layout, Combat Balance, and Progression Corrections

## Why

The map/catalogue overhaul exposed a storage path that silently sends drops to an invisible Warehouse when the 50-slot inventory is full. The Warehouse currently has read endpoints but its transfer methods are stubs, its UI is not a usable player storage surface, and the lower-level inventory transfer endpoints are not protected by the Town-only boundary. This has already exposed an item-ownership problem and creates a direct Auto Feed resolution risk when warehouse stock is mistaken for inventory stock.

The same release needs a compact horizontal map board, artwork coverage for newly added catalogue content, more reasonable high-level monster durability, a single real-time status timeline, and one authoritative Mastery XP contract. Finally, existing characters need a safe one-time move to the current Town after the map IDs changed, without corrupting already-simulated battles or leaving stale queued encounters able to restart Grind.

## What Changes

1. **Real Storage NPC in Town maps.** Add the canonical NPC ID `storage`, display name `Storage`, and the exact monologue: `You know I have a name, right? But you'll keep calling me Storage anyway.` Every map whose canonical `type` is `town` references this NPC. Selecting Storage shows the player's own ten Warehouse slots in the same fixed-square grid style as Vendor stock, but with no vendor buy/sell behavior. Dragging an inventory stack to Storage deposits it; dragging a stored stack to Inventory withdraws it; double-click performs the same direction based on the source surface. Transfers move the whole stack, merge only when the whole stack fits an existing destination stack, and otherwise fail without altering the source. All read/write paths are server-authorized and Town-only, and transfers are atomic/locked.

2. **No hidden drop overflow.** Remove implicit Inventory-to-Warehouse fallback from generic item granting. A battle drop is collected only when its complete stack can fit in Inventory, including a compatible existing stack. Otherwise that drop alone is discarded and explicitly logged; the battle, XP, gold, other drops and resolution transaction continue. Combat, Auto Feed, manual use, vendor, and other inventory-only paths never consume Warehouse stock. Storage remains unavailable during Grind, including while a Town return is pending.

3. **Horizontal square map board.** Put Town first and the six current grind maps in one row to its right. Canonical coordinates become `(0,0)` through `(6,0)`; every tile has a fixed equal width and height, so each is a perfect square and cannot stretch to the map-art container's full width. Small viewports may scroll horizontally; tiles must not wrap or shrink into rectangles.

4. **Complete icons for content added in the monster/map overhaul.** Add both framed and frameless item SVGs for all 24 new monster-part IDs; add the eight monster-skill SVGs and six status SVGs listed in the design/spec. Add validation so future catalogue additions cannot silently render missing-image placeholders.

5. **High-level monster HP reduction.** Reduce HP by 40% for every canonical monster with level 15 or higher: `max(1, round(currentCatalogHp * 0.60))`. Make no unrelated stat, XP, skill, drop, level or roster changes. Keep the backend/root and frontend public catalogue mirrors identical. Already persisted battle snapshots and resolved history remain immutable; only newly generated encounters use the new HP.

6. **One authoritative real-time status projection.** Replace the separate summary/monster status reduction loops with one shared pure projection driven by the same battle display tick and the immutable initial snapshot plus ordered battle-log events. Event target determines who owns an effect; actor/sourceActor identify its source. Apply/refresh/stack/lessen/end/expiry events and tick boundaries must line up with the log, including Poison. Zero-duration untimed effects, stack-specific expiry, same-tick events and explicit removals must be handled consistently.

7. **Correct and reconcile Mastery progression.** Use cumulative Mastery XP and one shared threshold contract end-to-end; stop using the legacy `weapon_xp_curve.json` as the Mastery level/next-level display source. As an explicit progression adjustment to the currently documented provisional table, Level 7 begins at 20,000 cumulative XP; the reported Greatsword value of 20,120 XP therefore derives to Level 7. Preserve the character's cumulative XP, allocated skill ranks and spent points. Reconcile stored derived levels in a one-time migration, fix points-to-redistribute and level-relative progress display, and refresh the Mastery HUD after authoritative battle resolution.

8. **Move existing characters to the current Town.** Add a one-time database migration that sets every character's authoritative current location to `map_town`, cleans up stale unstarted Grind queue records, and prevents stale jobs from starting more encounters. A currently started/unresolved battle remains immutable and may finish its already-simulated payout before the pending Town transition settles; no resolved history is rewritten. Perform Redis/gameplay map-presence reconciliation and cancel/remove stale queued work before workers are allowed to top up Grind again.

## Explicit decisions and invariants

- The server remains authoritative for Town access, transfer capacity, inventory quantity and item location. A frontend-hidden control is not a security boundary.
- Inventory is 50 slots and Warehouse is 10 slots. Each transfer runs in one PostgreSQL transaction with row locks; the source stack is not changed unless the full transfer can commit.
- Storage is not a `vendor` capability. It must not expose quote, purchase, sale, gold, stock or quest behavior.
- Warehouse rows are written only by explicit Town Storage transfers. A full inventory during battle causes a drop to be discarded, not banked.
- All current and future records with `type: "town"` must include Storage. NPC definitions stay canonical and are referenced by ID rather than duplicated per map.
- A character at Town with a pending transition is not considered settled in Town and cannot access NPCs until the transition clears.
- Battle logs, active immutable battle snapshots, resolved outcomes, XP/gold already awarded, and historical queue entries already resolved are not rewritten by this change.
- The shared simulator, not Angular, owns game outcomes. Status icons are read-only projections of its snapshots/events.
- Catalogue changes must update root JSON and frontend public mirrors together. Item, skill and status icon references must resolve to shipped assets.
- No deploy, production database mutation, or migration execution is part of this proposal session.

## Non-goals

- No access to Storage while Grinding, during a battle, or during a pending Town return.
- No partial-stack transfer, warehouse expansion, remote bank, automatic sorting, crafting or mail integration.
- No new item drops, monster skills, status mechanics, level curve changes, weapon mastery reward-rate changes, or character XP changes except the explicitly specified Mastery Level 7 threshold adjustment.
- No rebalance of monsters below level 15, and no changes beyond HP for monsters level 15+.
- No retroactive recalculation or rewriting of already queued battle outcomes or resolved battle history.
- No production deploy or running the new migrations in this proposal.

## Expected areas

Canonical data and mirrors: `maps.json`, `npc_catalog.json`, `monsters.json`, `skill_trees.json`, `status_effects.json`, `apps/frontend/public/data/*`, and item asset trees under `apps/frontend/assets/ui/items/`.

API/shared: Town/NPC/Inventory services and controllers, battle reward/drop handling, map and presence reconciliation, Mastery thresholds/DTOs, shared status projection inputs/types, TypeORM migrations, deterministic tests and catalogue validators.

Frontend: `vendor.store.ts` or a dedicated Storage store, inventory grid, Town info panel, map-board HTML/CSS, character summary and Grind status rendering, Mastery panel/refresh, plus all missing SVG assets.

Documentation: root `SPEC.md`, exact mirror `openspec/specs/SPEC.md`, `ARCHITECTURE.md`, and `STATUS.md` are updated when the proposal is applied, not during this proposal-only session.
