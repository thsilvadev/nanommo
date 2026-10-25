# Proposal — Pajé Piatã, Whitesmith Spitz, professions, refinement and NPC/quest i18n

## Why

NanoMMO already has data-driven Town NPCs, persistent quests, server-authoritative Cooking sessions, inventory reservations, and existing drag/drop and confirmation UI patterns. This change builds on those systems to add two specialist NPCs, Alchemy and Blacksmith progression, item-instance refinement through +12, global rare-material drops, tiered boot Move Speed, and runtime pt-BR/en-US localization for NPCs and quests.

This is a proposal only. No implementation, migration execution, or deployment is authorized by this artifact.

## What Changes

- Add Pajé Piatã to Kwaiouá-Taba with William's existing potion/antidote stock, plus Greater Elixir at 1,200 Gold. William remains available in his other towns.
- Add a Level 35 persistent quest from Pajé for five Forest Ancient's Teardrops, dropped only by Flaming Treant while the quest is active. Keep item ID part_flamingtreant_common for the quest-only item; replace Flaming Treant's ordinary common drop with a new item, provisionally named Charred Treant Bark, with a new sprite. Preserve the existing 35% common-drop rate for the replacement bark and use the same existing rate for the quest-only teardrop roll when eligible.
- The quest reward is Grounded Boots and exactly 31,630 Character XP, a fixed absolute amount, not a value recalculated from future XP curves.
- Add Whitesmith Spitz to Caelum with Loren-like vendor stock, plus T1 Rune and physical/magic T1 headgear.
- Add Alchemy and Blacksmith recipe catalogues. Alchemy starts with 5 Herbs → 1 Greater Elixir at profession Level 1 for 5 XP. Blacksmith Level 1 produces Bronze Ingots from 10 Bronze Ore; Bronze Ore is gatherable in Wastelands 1, Wastelands 0, and Menace Hills 2. Initial equipment recipes use only Bronze Ingots, with ingredient quantity equal to the recipe's unlock level: 2 for Level 2 headgear, 3 for Level 3 capes, 4 for Level 4 body armor, 5 for Level 5 Traveler's Boots, and 7 for Level 7 T2 weapons/shield/runes. Values remain editable in blacksmith_recipes.json.
- Reuse Cooking's profession progression and server-owned session behavior, including deadlines, reservation of ingredients/output capacity, atomic completion, cancellation, reload recovery, and battle-mutation serialization.
- Implement the existing items.json randomRollOnCraft fields for crafted equipment: roll one attribute from attributesPool within min/max, store the roll on that item instance, and apply it through all authoritative character/equipment stat paths. Keep crafted attribute rolls distinct from dropped equipment stat rolls.
- Add neutral T1 Traveler's Boots (+1 DEF, +10 Move Speed, no elemental immunity). Shift existing elemental boot IDs/tiers one step upward: Earth/Water T1 → T2, Fire/Shadow T2 → T3, Wind/Holy T3 → T4. Shift level requirements and drop pools along with their tiers. There are no existing boot inventory instances in the database, so no item-instance migration is planned; update every catalogue/map/recipe/quest reference.
- Add Bliss Stone and Divine Shard as independent, deterministic global drops, configured separately from each monster's monster.json entry. Bliss Stone chance: 0.501% at monster Level 1, increasing by 0.001 percentage point per level, capped at 0.600%. Divine Shard chance: 0.0501% at Level 1, increasing by 0.0001 percentage point per level, capped at 0.0600%. Both Bliss Stone and Divine Shard are Market-tradable and vendor-sellable.
- Add refinement through +12. Base refinement bonus is +3 to each eligible direct combat-stat field present on the equipment per successful level. From +7 through +12, also increase the item's existing random roll once per level above +6: crafted rolled attribute +2 per level; dropped rolled stat uses the agreed stat-specific increments. Use Bliss Stone for every attempt; the optional Divine Shard slot is available for attempts starting at +6 through +11, covering every attempt from +6→+7 through +11→+12.
- Refinement success chances: +0→+1, +1→+2, +2→+3: 100%; +3→+4: 90%; +4→+5: 80%; +5→+6: 70%; +6→+7: 60%; +7→+8: 50%; +8→+9: 40%; +9→+10: 30%; +10→+11: 20%; +11→+12: 10%. Failure from +3→+4 through +5→+6 consumes the stone but leaves the refinement unchanged. Failure from +6→+7 through +8→+9 resets refinement to +0 when no Divine Shard is used. Failure from +9→+10 through +11→+12 destroys the item when no Divine Shard is used. The Divine Shard slot is optional for every attempt from +6→+7 through +11→+12 and a supplied shard is consumed on a valid attempt. If an attempt starting at +6, +7 or +8 fails with a shard, the equipment and its current refinement level are preserved. If an attempt starting at +9, +10 or +11 fails with a shard, the equipment is preserved and loses exactly one refinement level (for example, +9 becomes +8) instead of being destroyed.
- The refinement confirmation modal previews before/after stats, highlights increases in green, previews random-roll growth where applicable, and describes the actual failure penalty after taking the Divine Shard into account.
- Add runtime language selection in Settings for pt-BR/en-US, limited to NPC and quest UI/content. Reuse existing Pajé/Spitz portraits and existing Rune SVG artwork. Create new icons in the current style for Traveler's Boots, Bliss Stone, Divine Shard, Bronze Ore, Bronze Ingot, and Charred Treant Bark.
- Add a separate global_item_drops.json catalogue (or the equivalent existing canonical data convention discovered during apply) for global drops, rather than duplicating these entries in every monster record.

## Capabilities

- Pajé and Spitz multi-service Town NPCs and vendor inventories.
- Forest Elder quest, including quest-only source item provenance and atomic turn-in consumption.
- Data-driven Alchemy and Blacksmith progression/session behavior.
- Applying randomRollOnCraft attributes to crafted items throughout authoritative stats.
- Item-instance refinement, including +12, stat roll improvements and optional Divine Shard protection.
- Global rare-material drop resolution.
- Boot Move Speed and tier changes.
- Runtime NPC/quest localization.

## Impact and safeguards

Expected changes cover canonical item/NPC/map/quest/recipe data and frontend mirrors, SVG/PNG item assets and manifests, gathering configuration, shared types and reward resolution, API persistence/services/forward-only migrations, authoritative equipment and combat/world-speed stat projection, Town and profession/refinement UI, tests, and documentation updates during apply.

The existing uncommitted changes in root maps.json must be preserved. The current items.json includes recent randomRollOnCraft changes supplied by the user; preserve those fields and build on them instead of replacing or reverting them.

No database migration is to be executed, and no deployment is part of this change.
