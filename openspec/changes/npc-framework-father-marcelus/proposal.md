# NPC Framework + Father Marcelus

## Why
Town now has a real Vendor NPC, but NPC behavior is still coupled to the vendor shape. Quest/dialogue NPCs need a server-authoritative, data-driven contract that can express dialogue choices and character/inventory effects without inventing a new system for each NPC.

## Scope
1. Establish a reusable NPC framework for Town NPC definitions and capabilities.
2. Support NPCs with one or more types/capabilities, with predictable UI composition.
3. Add a quest/dialogue capability with dialogue nodes, player choices, and authoritative effects.
4. Implement Father Marcelus as a quest NPC.
5. When the character is hungry and has no food item, Marcelus grants Bread transiently and the selected dialogue action consumes it immediately; Bread is never left in inventory by this interaction.
6. Reuse existing Character and Inventory persistence/services and keep all state changes server-authoritative.
7. Keep William's vendor behavior compatible while migrating the NPC selector to the generic contract.

## Non-goals
- No quest progression database, quest log, or multi-step persistent quest state.
- No new currency or inventory system.
- No NPC combat.
- No production deployment.

## Acceptance
- /town/npcs exposes William and Father Marcelus through one generic NPC catalog.
- NPC capabilities are composable; a future NPC can expose vendor and quest capabilities together.
- Vendor UI remains functional for William.
- Quest NPC UI renders in the same persistent Town panel, below vendor inventory when both capabilities exist.
- Marcelus dialogue exactly follows the requested hungry/non-hungry branches.
- Hungry + no food grants Bread and consumes it immediately; inventory remains unchanged by the temporary Bread.
- Effects are validated and applied only by the backend.
- Shared/API/frontend builds, focused tests, strict OpenSpec validation and git diff check pass.
