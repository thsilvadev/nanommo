# Design

## Current-state findings

1. Town NPC data is in npc_catalog.json and map ownership in maps.json. Pajé and Spitz portrait assets already exist at apps/frontend/assets/npcs/paje_piata.png and whitesmith_spitz.png.
2. William is listed in Sierra Village, Outpost, Ancient Aramaia City and Caelum. The approved decision is to leave William in those towns and give Pajé the same current potion/antidote stock only in Kwaiouá-Taba.
3. Cooking is the working reference for cumulative profession XP, timed server-owned sessions, inventory/output reservations, cancellation, recovery and atomic completion. Reuse it without regressing Cooking. Alchemy and Blacksmith need persisted level/XP and session state.
4. The Character Professions tab already lists Gathering, Cooking, Blacksmith and Alchemy; Blacksmith and Alchemy are currently placeholders.
5. QuestService's monster_drop mechanism is deterministic and can issue quest-owned item instances. Existing turn-in consumption primarily covers deliver_items, so the five quest-only teardrops must be consumed by matching quest instance at turn-in, atomically with reward grants.
6. Current offer dialogue supports linear steps; Pajé's two initial player responses and optional explanatory branch require a backward-compatible data-driven branch graph. Only the explicit “Estou indo!” choice accepts the quest. The optional “O que o senhor fará com essas lágrimas?” branch must not accept it.
7. Refinement does not exist. Inventory/equipped item instanceData is JSON and already stores rolledAttribute/rolledValue and quest provenance. Refinement must preserve all metadata and remain server-authoritative.
8. Item definitions have both randomRollOnDrop and the recently added randomRollOnCraft fields. Current drop code supports attribute rolls in attributesPool but the new statsPool/rolls definitions and randomRollOnCraft need end-to-end implementation and verification. A dropped item must use its drop-roll definition; a crafted item must use its craft-roll definition, never both just because both fields exist.
9. Existing boot definitions are Earth/Water T1, Fire/Shadow T2 and Wind/Holy T3. Shift them upward one tier, with their corresponding level requirement and drop-pool band, and introduce a separate neutral T1 boot. The user confirmed there are no current boot inventory instances, so no item-instance ID migration is needed; all catalogue references must still be updated.
10. Rune SVGs for T1–T3 already exist in svg/equipment and svg-noframe/equipment; validate exports/manifests rather than recreating the runes.
11. The global rare drops need independent deterministic streams so that adding a global roll does not shift any existing monster drop, consumable, equipment or stat-roll result. Keep the new global drops out of individual monster drop lists.
12. Runtime i18n is not currently wired into the frontend. Use an explicit locale service and localized catalogue/API fields rather than replacing literal strings. Scope remains limited to NPC and quest UI/content.

## Pajé Piatã and Forest Elder quest

- Place Pajé only on Kwaiouá-Taba. Compose vendor and Alchemy capabilities with the persistent quest interaction.
- Copy William's current potion/antidote list into Pajé's stock and add Greater Elixir at exactly 1,200 Gold. Leave William in his other towns.
- The quest is eligible at Character Level 35 or higher. The two initial answers should lead to Pajé's appropriate response; the optional explanation branch returns to the conversation and has a distinct “Nós vai, Pajé!” action. Only “Estou indo!” accepts.
- Once active, show the specified fallback dialogue on re-entry, and show progress/turn-in UI only according to server-authoritative quest state.
- Retain part_flamingtreant_common as “Forest Ancient's Teardrop”, mark it quest-only and remove it from ordinary monster loot. Roll the existing 35% chance only for an active Pajé quest against mon_flamingtreant. Stamp each item with its quest instance ID; prevent market/vendor/mail/warehouse transfer and consume five matching tears atomically at turn-in.
- Replace the ordinary Flaming Treant common drop with a new common item, proposed ID part_flamingtreant_bark, display name “Charred Treant Bark”, keeping the existing 35% common-drop chance. Add its own sprite. The exact asset filename should follow repository conventions.
- Grant Grounded Boots and exactly 31,630 Character XP. The XP is a hardcoded absolute reward, not a calculation based on the character's current or next XP threshold. The Grounded Boots reward must have no rolled attribute bonus and remain non-tradable through its quest reward provenance.

## Spitz, Blacksmith and crafting

- Place Whitesmith Spitz in Caelum, with the same base list/pricing as Blacksmith Loren, plus equip_rune_t1, equip_head_phys_t1 and equip_head_magic_t1. Leave the other vendor NPCs unchanged.
- Create alchemy_recipes.json with the Level 1 recipe: 5 mat_herbs → 1 elixir_greater, 5 Alchemy XP.
- Create blacksmith_recipes.json with initial baseline values that the user can easily edit:
  - Level 1: 10 Bronze Ore → 1 Bronze Ingot.
  - Level 2: physical and magic T2 headgear; each recipe consumes 2 Bronze Ingots.
  - Level 3: physical and magic T2 capes; each consumes 3 Bronze Ingots.
  - Level 4: physical and magic T2 body armor; each consumes 4 Bronze Ingots.
  - Level 5: neutral T1 Traveler's Boots; consumes 5 Bronze Ingots.
  - Level 7: all T2 weapons, shield and rune definitions; each consumes 7 Bronze Ingots.
- Add mat_bronze_ore and mat_bronze_ingot. Register Bronze Ore in gathering data for Wastelands 1, Wastelands 0 and Menace Hills 2. Create matching item icons in established SVG icon styles and include required exports/manifests.
- Keep initial XP reward values simple/editable in blacksmith_recipes.json; use 5 XP as the initial placeholder for each recipe until the user tunes the data.
- Use Cooking's profession thresholds/session lifecycle: server-owned deadline, reservation, output capacity, cancellation, reload recovery and exactly-once completion. A Character cannot hold overlapping active sessions across professions.
- For crafted equipment, implement randomRollOnCraft as defined on the existing user-edited item catalogue: choose one attribute from attributesPool, roll an inclusive value in [min,max], store the result in instanceData and apply that attribute through Character stats/equipment projection. The stats display and tooltip must expose the rolled attribute. Test that Craft uses randomRollOnCraft while monster loot continues to use randomRollOnDrop.
- For equipment drops, implement the configured randomRollOnDrop.statsPool / rolls form in addition to the existing attributesPool form. Persist the rolled stat and value on that item instance; apply it in derived stats, battle snapshots and tooltips, and ensure the chosen rolled stat can be improved by refinement.

## Boot tier shift and Move Speed

- Add a neutral T1 item with display name “Traveler's Boots”, +1 DEF, +10 Move Speed and no elemental immunity. It is the Blacksmith Level 5 recipe output.
- Shift old Earth/Water boots from T1 to T2, old Fire/Shadow from T2 to T3, and old Wind/Holy from T3 to T4. Shift requirements and drop pools along with the tier. Use the next corresponding level band for T4 consistent with catalogue/map pool data, validating actual pool IDs rather than inventing nonexistent ones. Rename IDs to match tiers and update every reference.
- Tiers grant flat Move Speed: T1 +10, T2 +15, T3 +30, T4 +45. Ensure equipment-derived stats, Character data, combat snapshots and world-travel speed include this bonus.
- Grounded Boots uses the shifted Earth boot definition as the quest reward but the awarded instance has no random rolled attribute and has questReward metadata that blocks Market transfer.

## Item refinement

### Inputs, validation and lifecycle

- Refinement is available from Spitz. The UI has one equipment input, one Bliss Stone input, and an optional Divine Shard slot for attempts starting from +6 through +11. Only unequipped, owned inventory equipment is eligible. The character's item and material quantities are rechecked in a serialized server transaction.
- A valid attempt consumes one Bliss Stone. A Divine Shard is optional and consumed if inserted into a valid attempt. Reject invalid items, wrong ownership, duplicates/concurrent replays and attempts over +12 without spending materials.
- Store refinement level in item instanceData and preserve all existing keys. Render canonical item name with “ +N” and include base refinement and random-roll improvements in the same authoritative derived-stat paths. The client never determines success or grants stats.

### Success chances and failure behavior

| Current level | Target level | Success chance | Failure without Divine Shard |
| --- | --- | ---: | --- |
| +0 | +1 | 100% | Not applicable |
| +1 | +2 | 100% | Not applicable |
| +2 | +3 | 100% | Not applicable |
| +3 | +4 | 90% | Stone lost; item remains +3 |
| +4 | +5 | 80% | Stone lost; item remains +4 |
| +5 | +6 | 70% | Stone lost; item remains +5 |
| +6 | +7 | 60% | Reset to +0 |
| +7 | +8 | 50% | Reset to +0 |
| +8 | +9 | 40% | Reset to +0 |
| +9 | +10 | 30% | Item destroyed |
| +10 | +11 | 20% | Item destroyed |
| +11 | +12 | 10% | Item destroyed |

- The optional Divine Shard slot is available for every attempt from +6→+7 through +11→+12. A supplied shard is consumed on the valid attempt. If the attempt starts at +6, +7 or +8, failure preserves the equipment at its current refinement level, preventing the normal reset to +0. If the attempt starts at +9, +10 or +11, failure preserves the equipment but decreases refinement by exactly one level (for example, +9 becomes +8), preventing destruction. The item keeps its rolled stat/attribute and all unrelated metadata.
- The optional Divine Shard slot is not offered below +6 or above +11 under this proposal.
- The normal direct-stat increase is +3 per refinement level for each supported base direct stat that the item actually provides: ATK, MATK, DEF and MDEF. Where MDEF is represented as mdefPercent, +3 means three percentage points per successful level. Do not grant irrelevant new stat fields to equipment that does not provide them.
- At each successful level +7 through +12, also increase the one pre-existing random roll again, cumulatively once per refinement above +6:
  - Random rolled attribute on crafted equipment: +2 to that attribute for each level above +6.
  - Random rolled drop stat: ATK +5; MATK +5; DEF +4; HP +10; SP +10; Attack Speed +10; Cast Time Reduction +5; Evasion +3; Accuracy +3; Critical +1 percentage point per level above +6.
- Stat roll increments only apply when that item actually has the relevant supported roll. Preserve the original roll data and track refinement-driven additions separately or derive them from refinement level to prevent double-application after reload/re-equipping.
- Build the confirmation modal for every non-guaranteed attempt. Show success chance, required Bliss Stone and whether Divine Shard is used, full current → resulting stat preview with increases in green (for example, DEF 16 → DEF 19; Critical +1% → +2% where applicable), and the exact penalty on failure after protection is accounted for. When a shard is used, clearly preview the applicable protection: at +6→+7 through +8→+9, the current refinement is preserved on failure; at +9→+10 through +11→+12, the item is preserved but loses one refinement level. Without a shard, preview the normal reset or destruction penalty. Do not imply success-only gains are granted on a failed attempt.

## Global rare drops

- Use a separate canonical global drop catalogue (proposed global_item_drops.json) to describe items, base chance, per-monster-level increment and cap. This avoids editing every monster record for globally applicable drops.
- Run independent deterministic rolls for every defeated monster, regardless of map or that monster's regular drop list, one roll per global item. Use stable streams keyed by monster/kill index/global item ID and never perturb existing reward streams.
- Bliss Stone chance: Level 1 = 0.501%; increase by 0.001 percentage point per monster level above Level 1; cap at 0.600%.
- Divine Shard chance: Level 1 = 0.0501%; increase by 0.0001 percentage point per monster level above Level 1; cap at 0.0600%.
- Both Bliss Stone and Divine Shard are market-tradable and vendor-sellable.
- New material icons should match existing SVG conventions and generated icon/manifest pipeline.

## Localization

- Add runtime locale pt-BR/en-US and a Settings toggle; persist selection locally and update visible NPC/quest content without a reload.
- Localize NPC-facing labels, NPC data, service actions, dialogue choices, quest offer/active/completion strings, quest log/objective/reward summaries and related buttons only. Pass the selected locale through API/catalogue delivery or use localized fields; do not replace text by matching the English literal. Unrelated game UI remains out of scope.

## Validation strategy

- Validate canonical roots and public mirrors for NPCs, maps, quests, recipes, items, gathering data, drop catalogue, localized fields and sprites.
- Test quest level gating, offer branches, exact fixed XP, quest-only tear issuance/consumption and duplicate-turn-in safety.
- Test profession XP/recipe unlocks, crafted randomRollOnCraft behavior, reservation/cancel/reload exactly-once behavior, and existing Cooking regressions.
- Test global drop formulas at Levels 1, 99 and 100, independent stream determinism, and unchanged outcomes from all existing drop streams.
- Test every refinement chance and failure boundary, shard slot eligibility/consumption/protection, +12 cap, base stat and random-roll improvements, item metadata preservation and no duplicated stat application.
- Test boot requirements/pools/Move Speed in Character, battle and world travel; verify no dangling references after boot ID renames.
- Test full modal preview and all failure penalties; test locale coverage and runtime toggling.
- Run focused tests, shared/API/frontend builds, sprite/catalogue validation, strict OpenSpec validation and git diff --check. Do not execute migrations or deploy.

## Decisions confirmed for this proposal

The Divine Shard slot is optional for every attempt starting at +6, +7, +8, +9, +10 or +11 and is consumed when supplied on a valid attempt. Failed attempts starting at +6 through +8 preserve the current refinement level; failed attempts starting at +9 through +11 preserve the item but reduce its refinement by exactly one level. Both global materials are Market-tradable and vendor-sellable. New sprites are planned apply tasks and have not been generated during proposal authoring.
