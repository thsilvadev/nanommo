# Tasks

This checklist records apply progress for the user-authorized implementation. Checked items have code/data and validation evidence; unchecked items are explicit follow-up gaps.

## 1. Preserve existing work and freeze data

- [x] 1.1 Preserve the existing maps.json edits and the latest randomRollOnCraft fields in items.json; inspect diffs before catalogue updates.
- [x] 1.2 Freeze the confirmed global-drop formulas and Divine Shard eligibility, consumption, failure-protection and tradability rules in the canonical data and tests.
- [x] 1.3 Verify exact map IDs and gathering resource configuration for Wastelands 1, Wastelands 0 and Menace Hills 2.
- [x] 1.4 Freeze the boot tier shifts, item IDs, level requirements, drop pools and references.
- [x] 1.5 Add approved dialogue text and locale variants for Pajé; preserve Cecilia's existing offer flow.

## 2. Canonical data and sprites

- [x] 2.1 Add Pajé Piatã in Kwaiouá-Taba and Whitesmith Spitz in Caelum; leave William in all existing towns.
- [x] 2.2 Copy William's current potion/antidote stock into Pajé, add Greater Elixir at 1,200 Gold, and add Spitz's Loren-like stock plus the three specified T1 items.
- [x] 2.3 Add alchemy_recipes.json and blacksmith_recipes.json with the approved starter recipes and editable XP/ingredient quantities.
- [x] 2.4 Make part_flamingtreant_common quest-only, preserve the current item identity/name/sprite for Forest Ancient's Teardrop, remove its ordinary drop path, and add the new common Flaming Treant material with its own sprite.
- [x] 2.5 Add mat_bronze_ore and mat_bronze_ingot; register Bronze Ore in gathering data for the specified maps.
- [x] 2.6 Add mat_bliss_stone, mat_divine_shard, Traveler's Boots, and Charred Treant Bark item/icon definitions. Reuse existing Rune icons; do not regenerate them.
- [x] 2.7 Add global_item_drops.json (or existing canonical equivalent) with independent drop rules and sync the frontend mirror if required by project conventions.
- [x] 2.8 Shift existing elemental boot definitions upward one tier, adjust requirements/drop pools and update all item references.
- [ ] 2.9 Generate/validate new SVG sprites, exported assets/manifests and all data mirrors.

## 3. Profession persistence and crafting

- [x] 3.1 Add persisted Alchemy/Blacksmith level, XP and session data using a forward-only migration; do not run it.
- [x] 3.2 Reuse Cooking session logic for reservation, deadlines, cancellation, recovery and atomic completion; prevent overlapping sessions across professions.
- [x] 3.3 Implement Alchemy Level 1 Greater Elixir recipe and replace placeholder profession UI state.
- [x] 3.4 Implement Bronze Ore → Bronze Ingot and the Blacksmith equipment recipe groups at Levels 2/3/4/5/7.
- [x] 3.5 Implement randomRollOnCraft end-to-end on crafted equipment and verify the rolled attribute is applied by Character/equipment stat resolution and UI.
- [x] 3.6 Implement randomRollOnDrop.statsPool/rolls end-to-end for equipment drops, preserving existing attributesPool behavior and deterministic outcomes.
- [x] 3.7 Test no random-roll cross-contamination between drops and crafts, and no double application after re-equip/reload.

## 4. Forest Elder quest

- [x] 4.1 Implement the Level 35 offer and backward-compatible branched dialogue; only the explicit acceptance choice starts the quest.
- [x] 4.2 Configure a 35% Flaming Treant tear roll only while the quest is active; stamp each tear with the active quest-instance ID.
- [x] 4.3 Replace the old ordinary common drop with Charred Treant Bark at the existing 35% rate.
- [x] 4.4 Atomically consume exactly five matching quest tears and grant Grounded Boots plus exactly 31,630 Character XP.
- [x] 4.5 Ensure quest tears and the Grounded Boots quest reward cannot be transferred/sold and concurrent turn-in cannot duplicate rewards.

## 5. Refinement and global drops

- [x] 5.1 Persist refine level in instanceData, preserving random rolls and quest provenance.
- [x] 5.2 Implement refinement through +12 with chances 100/100/100/90/80/70/60/50/40/30/20/10 and exact failure outcomes.
- [x] 5.3 Consume one Bliss Stone per valid attempt and implement the optional Divine Shard slot for attempts +6→+7 through +11→+12, consuming the shard on valid attempts; on failure at +6→+7 through +8→+9 preserve current refine, and at +9→+10 through +11→+12 preserve the item but remove one refine level.
- [x] 5.4 Apply +3 direct-stat bonus per level and from +7 onward add per-level increments to the item's rolled attribute/stat.
- [x] 5.5 Ensure all authoritative stat paths, item names/tooltips, Market/Mail/Vendor displays, combat snapshots and re-equipped items use the same refinement state.
- [x] 5.6 Build the refinement UI with validation, before/after preview and green gains; accurately describe odds and failure penalty with/without shard.
- [x] 5.7 Implement global Bliss Stone/Divine Shard rolls in an independent deterministic global-drop resolver and test formulas at Levels 1/99/100 without perturbing existing drops.
- [x] 5.8 Enable both Bliss Stone and Divine Shard Market trading and vendor sale, with data-driven sell values consistent with existing vendor pricing conventions.

## 6. Boot movement and localization

- [x] 6.1 Include boot Move Speed in equipment-derived stats, persisted/returned Character values, combat snapshots and world-travel speed.
- [x] 6.2 Add pt-BR/en-US runtime locale service and Settings toggle with persistent preference.
- [x] 6.3 Localize NPC names/greetings/actions/dialogues and quest offer/log/objective/reward UI only; pass locale through API/catalogue responses.
- [x] 6.4 Add translation completeness checks and confirm locale changes update visible text without reloading.

## 7. Verification and handoff

- [x] 7.1 Focused API tests for quest flow, drops, crafting/rolls, item transactions and refinement failure branches.
- [ ] 7.2 Frontend tests for multi-service NPCs, craft sessions, refinement slot/preview and runtime locale switching.
- [x] 7.3 Build shared/API/frontend; run relevant tests and asset/data validators.
- [x] 7.4 Strict OpenSpec validation and git diff --check; inspect final catalogue diffs to ensure prior user changes remain.
- [x] 7.5 Update SPEC.md, openspec/specs/SPEC.md, ARCHITECTURE.md and STATUS.md from verified implementation results only.
- [x] 7.6 Leave migrations unexecuted and do not deploy.
