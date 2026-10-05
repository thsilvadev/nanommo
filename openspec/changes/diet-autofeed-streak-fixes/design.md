# Design

## Diet state model

The persisted Character.diet remains the ordered three-entry window. Unlike the previous implementation, an entry is not removed merely because digestUntil has passed.

Each entry remains in the slot after digestion and is rendered as an expired/transparent food marker until a later food consumption shifts it out.

dietLevels is no longer permanent history. It mirrors only foods represented by the current three-slot Diet window. Each map value stores the current streak level and the digest boundary for that food.

A food may be consumed again only after its previous occurrence has finished digesting. On a repeat:
- find the previous retained Diet entry for that food;
- increase its level by one, capped at 3;
- append the new entry with that level.

When appending a food to a full Diet:
1. remove the oldest entry;
2. if that removed item has no other retained Diet entry, remove its dietLevels record;
3. append the new food at the right;
4. persist dietLevels rebuilt from the resulting three entries.

This means a food that falls out of the left side loses its streak immediately. The next time it is eaten, its first consumption in the new streak has level 0.

## Auto Feed

Auto Feed remains an authoritative Character setting.

At every authoritative battle resolution, the server determines whether the current food can sustain the next encounter. If the active food has expired or expires no later than the next safe encounter boundary, Auto Feed selects the first eligible retained Diet food that:
- is a food definition;
- is not still digesting;
- has positive Inventory quantity;
- is not the currently active food before its digestion boundary.

The server consumes exactly one unit through the same transactional consumeFood() path used by manual consumption. The consumption updates Diet, streak, activeFoodBuff and Inventory atomically.

After Auto Feed succeeds, all unresolved future battles are discarded and the queue is rebuilt from the new Character + Inventory state. The just-resolved battle remains resolved and is never rewritten.

If no eligible food exists, the normal Hungry/Town invariant remains unchanged.

## Realtime and frontend

The Character DTO SHALL expose all three Diet entries, including expired entries, until they are evicted by a subsequent consumption. The frontend marks expired entries visually instead of deleting them locally.

No client timer changes gameplay state. Existing boundary refresh behavior may request a fresh authoritative Character snapshot, but it must not prune or mutate Diet locally.

## Compatibility

Existing characters with an old permanent dietLevels map are normalized against their current diet entries. Levels for foods absent from the three retained slots are discarded on the next authoritative food-state mutation.

No inventory schema change is required.
