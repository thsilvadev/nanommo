# Proposal

## Why

Gathering already supplies cooking materials and the food catalogue already defines the existing food effects, but Cooking progression, recipes, and a cooking interaction do not exist. Uncle Phillip will turn those existing items into a server-authoritative crafting loop without changing their combat effects.

## What Changes

- Add Uncle Phillip, the Mastercook, exclusively to Sierra Village (`map_town`) with the requested greeting and the `[I'd like to cook]` action.
- Add a reusable `cooking` Town NPC capability and a centered Cooking modal sized to about 50% of desktop viewport width, with horizontally styled recipe rows, existing food icons, ingredients, level requirements, a disabled `COOK` state, a 10-second progress bar, and `Cancel`.
- Add canonical cooking recipe data for Bread, Blueberry Jelly, Cheese, Herbtea, Honey, Hunter's Stew, and Roasted Barbecue, using existing material IDs and food item IDs. Unlock levels: 1, 1, 2, 2, 5, 6, 7 respectively; Honey is level 5 and Hunter's Stew is level 6.
- Persist Cooking XP, level, and an active timed session. The server owns the deadline, completion, cancellation, and recovery if the modal is closed or the page reloads.
- On successful completion, atomically consume reserved ingredients, create one food item, award recipe XP, update level, and return authoritative inventory/progression state. A level-up immediately re-evaluates recipes and exposes newly unlocked recipes in the modal.
- Propose the initial XP curve calibrated to roughly 200 successful preparations to reach level 7; retain food item IDs and gameplay effects, renaming the existing `food_roast` display name to **Roasted Barbecue**.
- Integrate inventory-reservation and future-battle-queue invalidation rules so ingredients cannot be spent twice and newly cooked food is reflected in future server-simulated battles.

## Capabilities

### New Capabilities
- `cooking-progression`: Recipes, XP thresholds, timed cooking, ingredients, food creation, session recovery, cancellation, and server authority.
- `town-cooking-npc`: Uncle Phillip's Sierra Village placement, dialogue action, and Cooking modal.

### Modified Capabilities
- Town NPC catalog/map ownership and item catalog metadata to register the new NPC, recipe data, and `Roasted Barbecue` display name.

## Impact

Root and frontend-mirrored `npc_catalog.json`, `maps.json`, and `items.json`; a new canonical `cooking_recipes.json` and its public mirror; Character entity/DTO and forward-only migration; Town NPC APIs/UI; InventoryService reservation/capacity checks; durable cooking completion scheduling/recovery; BattleService future-combat mutation integration; validators and focused regression tests. Update `SPEC.md`, `openspec/specs/SPEC.md`, `ARCHITECTURE.md`, and `STATUS.md` during apply, based only on verified behavior.

No gameplay code, canonical specification, migration execution, live database mutation, or deployment is part of this proposal-only change.
