# Diet Auto Feed — Boundary Reliability

## Why

Auto Feed is enabled and the configured Diet foods can be present in Inventory, but the grind can still reach an empty future queue without consuming the next eligible food. The current boundary check uses the current time when no future queue entry exists, so food that expires shortly after the resolving battle is incorrectly considered still safe; the character then remains without a queued encounter and eventually falls into the Hungry/Town invariant.

## What Changes

- Make the Auto Feed boundary decision use the next safe encounter boundary, including the encounter-search interval, even when the current unresolved queue has no future entry.
- Ensure an eligible configured Diet food is consumed before the character is allowed to continue into a no-queue/food-exhaustion state.
- Preserve the existing transactional food-consumption path for Auto Feed and manual consumption.
- Rebuild the unresolved Grind queue from the authoritative post-Auto-Feed Character + Inventory state after a successful automatic consumption.
- Add regression coverage for the specific empty-future-queue boundary case, including the case where the active food expires shortly after the current battle ends.
- Preserve the existing Hungry/Town behavior when Auto Feed is disabled or no eligible configured food exists.

## Capabilities

### Modified Capabilities

- diet-auto-feed: make authoritative Auto Feed reliable at the transition between the current battle and the next encounter.

## Impact

This is a server-side correctness fix. No new client gameplay authority, inventory model, food type, or API toggle is introduced. The existing Auto Feed setting remains authoritative; the change affects only when the server decides that the current food must be replaced before the next encounter can safely start.
