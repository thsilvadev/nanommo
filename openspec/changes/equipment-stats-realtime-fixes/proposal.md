# Equipment Stats & Realtime Character Sheet Fixes

## Why

The current equipment flow has correctness and presentation gaps: equipment bonuses are applied inconsistently between authoritative combat calculation and the Character DTO, Magic ATK is implemented in the shared engine but discarded by the API, the frontend waits for a second Character load after equipment mutations, and generic accessory items cannot be dropped into the two accessory slots.

## Scope

1. Make one authoritative equipment-stat aggregation path include fixed stats and rolled attribute bonuses.
2. Expose equipment-derived attribute bonuses and all covered Stats, including Magic ATK, in the Character response.
3. Normalize generic accessory items to the left/right accessory slots without changing the canonical item catalog.
4. Make equipment tooltips show the actual stats conferred by the item instance, including fixed stats and rolled attribute bonuses.
5. Add explanatory tooltips to the six Attributes.
6. Render item/buff attribute bonuses as green (+N) values next to base Attributes.
7. Rename the Character sheet section from Derived Stats to Stats and add Magic ATK.
8. Make equip/unequip/use-item HTTP success responses converge Character, Inventory and Equipment presentation immediately.
9. Preserve server authority: the frontend consumes returned authoritative Character state and never recomputes gameplay formulas.

## Non-goals

- No new equipment mechanics or new item definitions.
- No client-authoritative battle/stat simulation.
- No weapon XP/progression changes.
- No production deployment.
