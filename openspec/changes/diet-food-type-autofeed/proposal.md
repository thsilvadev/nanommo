# Proposal: Separate Food From Combat Consumables

## Why

Food currently shares the generic `consumable` item type, which allows Gambit `use_item` to consume food during battle and forces Auto Feed to coexist with a second food-consumption path. This undermines the intended Diet/Auto Feed boundary and makes Grind continuity harder to reason about.

## Scope

- Give every item with `effect.type = food_buff` the dedicated item type `food`.
- Keep manual food consumption available outside battle through the existing inventory action.
- Restrict Gambit `use_item` to items whose type is `consumable`; food is never a battle action.
- Keep Auto Feed as the only automatic food-consumption mechanism and evaluate it during authoritative battle resolution before Hungry/Town fallback.
- Do not add an Auto Feed trigger when entering Grind.

## Non-goals

- No change to food effects, Diet levels, digestion duration, or slot ordering.
- No client-side polling/timer for food consumption.
- No changes to ordinary potion/antidote Gambit behavior.
