# Design

## Context and goals

Gathering materials already exist in items.json, and the food outputs already have stable IDs and combat effects. Town NPCs are data-driven through npc_catalog.json and each map's npcIds. This change introduces Cooking as a distinct NPC capability and persistent progression loop without changing the battle-food contract.

Goals: one server-authoritative source for recipes, exact 10-second cooking, atomic item/XP completion, durable Cancel/reload behavior, immediate recipe unlocks, and a polished modal consistent with the existing Town panel.

Non-goals: new food buffs, recipe ingredients beyond those listed, multi-output batches, deployment, or migration execution.

## Canonical recipe and progression data

Create root cooking_recipes.json and a public frontend mirror. DataService validates recipe IDs, output item references, positive ingredient quantities, level requirements, XP rewards, and unique/deterministic order. The frontend uses recipe/state DTOs from the API for decisions; it must not authoritatively calculate eligibility or XP.

| Recipe card | Required level | Ingredients | Output item ID | XP |
|---|---:|---|---|---:|
| Bread | 1 | 5 Wheat | food_bread | 5 |
| Blueberry Jelly | 1 | 5 Wild Blueberries | food_blueberry | 5 |
| Cheese | 2 | 10 Milk | food_cheese (Aged Cheese) | 18 |
| Herbtea | 2 | 10 Herbs | food_herbtea (Herbal Tea) | 18 |
| Honey | 5 | 15 Honeycomb | food_honey | 20 |
| Hunter's Stew | 6 | 8 Herbs, 6 Carrots, 4 Meat | food_stew | 25 |
| Roasted Barbecue | 7 | 10 Meat, 10 Carrots | food_roast | 30 |

Use existing material IDs (mat_wheat, mat_wild_blueberries, mat_milk, mat_herbs, mat_honeycomb, mat_carrot, mat_meat) and existing food effects. Rename only the display name for food_roast from Roasted Boar Leg to Roasted Barbecue; preserve its ID and effect. Existing Honey and Hunter's Stew regen values are canonical and must not be changed by this work.

Cooking XP is cumulative. Level thresholds are total XP: L1 0; L2 100; L3 220; L4 390; L5 640; L6 1640; L7 4140; L8 7890. For levels after L8, recursively set the next level's incremental requirement to floor(previous increment × 1.5). Derive level from server XP/thresholds, preserve overflow across multiple levels, and expose current-level progress as xpWithinLevel / xpRequiredForNextLevel. This provides the requested pacing: 20 level-1 crafts yield 100 XP; 30 level-2 crafts yield another 540 (L5 at 640); 50 Honey crafts yield 1000 (L6 at 1640); 100 Hunter's Stew crafts yield 2500 (L7 at 4140).

## NPC and frontend experience

Add uncle_phillip to root/frontend npc_catalog.json with types: ["cooking"], his requested greeting, and no vendor/quest capability. Add his ID only to map_town.npcIds in root/frontend maps.json, ensuring other Towns do not list him. The Town panel's generic NPC selector remains the entry point; its cooking capability renders the [I'd like to cook] action.

The modal is centered and approximately 50vw wide on desktop, constrained to fit small screens. Its recipe cards are horizontal, nearly full-width rectangles, stacked in deterministic recipe-level order. Use the existing output food icon, distinct decorative treatment for the food name, ingredient names/counts, level requirement, and a subdued disabled COOK button when the recipe level, ingredients, or inventory-capacity reservation is unavailable. Separate currently unlocked/available recipes from future level-locked recipes; level-up promotes freshly unlocked cards into the available list below existing available recipes. Ingredient shortages remain visible per card.

Starting a recipe changes COOK to Cancel and shows a Cooking progress bar inside the modal. Use server-provided startedAt and completesAt; browser intervals only animate the display. At success, keep the modal mounted, refresh authoritative XP/level/inventory/session state, and immediately update newly unlocked cards.

## Persistent session and transaction design

Add Character persistence for cookingLevel (default 1), cumulative cookingXp (default 0), and nullable cookingSession (JSONB). A session stores a server-generated session/generation ID, recipe ID, start/deadline timestamps, required ingredient reservations, and reserved output capacity. Only one session may be active per Character.

Starting requires a locked Character transaction, settled map_town location, Town status, no pending map transition or travel intent, no other cooking session, sufficient level/materials, and reservable output capacity. It persists the session and schedules an idempotent delayed completion job. Ingredients remain in inventory but reserved until completion; conflicting sell/deposit/transfer/list/use/remove operations must not spend reserved quantities. Other inventory grants must respect reserved output capacity. This guarantees that only the explicit Cancel action interrupts accepted Cooking, while the ingredients are not removed early.

Cancel and completion serialize through the established per-character lock and database row lock. Cancel is accepted only while server time is earlier than completesAt; it clears the current session and releases reservations without changing inventory/XP. At or after the deadline, completion wins even if the delayed worker is late: a status/Cancel request must reconcile the due session instead of allowing it to be cancelled. The completion path validates session ID/generation, the canonical recipe and reservations, then atomically consumes ingredients, grants exactly one output food, awards XP/level, clears the session, and returns authoritative state. Duplicate/stale jobs are no-ops. Session timestamps in PostgreSQL are authoritative; on process restart, a reconciler recreates any missing completion job and immediately processes overdue sessions.

Completion integrates with BattleService.runFutureCombatMutation() so new food reaches unstarted queue snapshots, while an already-started battle remains immutable. If completion and Cancel race, the common lock and session generation establish one terminal outcome. The client never submits ingredients, XP values, output item, or an authoritative completion time.

## API shape

Extend the authenticated Town NPC API with Cooking operations, for example:
- GET /town/npcs/uncle_phillip/cooking: recipes, authoritative Cooking progress, ingredient quantities/eligibility, and active session.
- POST /town/npcs/uncle_phillip/cooking/start: body contains only recipeId; server validates and creates the timed session.
- POST /town/npcs/uncle_phillip/cooking/cancel: cancels the current session by session ID/generation.
- Completion is worker-owned; GET/status reads reconcile against the persisted deadline if needed.

These are design names, not implementation constraints if existing Town route conventions require a consistent equivalent. All requests require the existing authenticated Character resolution and Sierra Village guard for starting; worker completion remains valid if the modal is closed or the client reloads.

## Verification approach

Use deterministic API/service tests for recipe references and order, XP threshold math, exact 10-second deadline checks, eligibility, reservations, insufficient space, cancel/retry races, duplicate jobs, restart recovery, atomic inventory/XP updates, level-up unlocks, and queue invalidation with an immutable active battle. Add Angular tests for disabled cards, responsive/modal composition, countdown/Cancel, refreshed unlocks, stale HTTP responses, and reload recovery. Validate JSON mirrors/assets, run relevant builds and openspec validate cooking-npc-uncle-phillip --strict; do not execute migrations or deploy during proposal/apply coding.
