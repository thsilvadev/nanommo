# Design

## Context

The current Character already persists activeFoodBuff, while InventoryService.useConsumable() handles manual food use. BattleService.queueBattles() projects food through the five-entry queue, and resolveBattle() applies food state after consuming simulated items. The existing realtime contract already carries complete Character + Inventory snapshots with stateVersion.

The Diet must extend these existing authorities rather than create a second food/buff system.

## Data representation

Add three Character fields:

- diet: JSONB ordered array of up to three entries { itemId, consumedAt, digestUntil, dietLevel }, oldest first and newest last.
- dietLevels: JSONB map { [itemId]: { level: 0..3, lastDigestUntil } }, preserving permanent mastery and the last digestion boundary even after a slot leaves the three-slot window.
- autoFeed: boolean, default false.

activeFoodBuff remains the authoritative combat/stat buff. Diet entries are the persistent digestion/history state; they are not Inventory quantities.

A food can be consumed only when that food has no Diet entry whose digestUntil is in the future. Expired entries are eligible for replacement. Consuming a food after its prior entry has fully expired increments that food's permanent level, capped at 3. The first consumption starts at level 0 and does not immediately grant a star.

## Consumption semantics

Every authoritative food consumption, manual or Auto Feed, uses one backend path that validates Inventory ownership/quantity, food definition, digestion state and character state before mutation.

On success:
1. Remove exactly one food from Inventory.
2. Append the new food as the final Diet slot, shifting older entries left and dropping the oldest when already full.
3. Set consumedAt and digestUntil from the item's configured duration.
4. Set or replace activeFoodBuff with the same authoritative expiry/effects.
5. Increase the food's permanent level only when a previous Diet instance of that same food has already finished digesting; cap at 3.
6. Persist Character and Inventory consistently.

Manual use remains a normal consumable action outside battle. It may replace an active food buff early; that replacement is intentional.

## Auto Feed

autoFeed=true is authoritative Character state. Eligible food means a food represented by the character's Diet configuration/history and present in Inventory. Auto Feed never invents an item and never consumes a food absent from Inventory.

The server checks Auto Feed at authoritative digestion boundaries. It must act before a completed grind cycle can transition the character to Hungry when an eligible food exists. The check belongs to battle-resolution/queue advancement, not a browser timer.

If no eligible food exists, Auto Feed does nothing. The normal Hungry rule remains authoritative and the character returns to Town when the active food buff expires without a valid replacement.

When Auto Feed consumes food during queue advancement, the unresolved future queue is invalidated and rebuilt from the new Character + Inventory state. The resolved battle is never retroactively changed.

## Safe timing invariant

Before resolving the final usable battle of a grind chain, the server must determine whether active food expires before the next encounter can safely begin. If Auto Feed is enabled and an eligible food exists, the server consumes it before allowing the chain to end in Hungry and then rebuilds the future queue. This invariant applies to normal BullMQ resolution and crash recovery.

## Realtime synchronization

Diet and Auto Feed are part of Character gameplay state. Any authoritative food mutation advances Character stateVersion and publishes Character + Inventory together when it affects the grind loop. battle:resolved and post-resolution battle:queueUpdated carry the same coherent snapshot/revision. Frontend stores continue rejecting older revisions; no Diet client polling or local mutation is authoritative.

## Gambits

Delete self_hungry from the shared enum/catalog, backend validation and frontend catalog usage. Food remains a normal use_item action, including manual food use through the existing consumable endpoint. Auto Feed is the only official automatic food behavior.

## Compatibility and migration

Existing characters with null Diet fields normalize to empty diet, empty dietLevels and autoFeed=false. Existing activeFoodBuff remains valid and must be reconciled into Diet state on first authoritative load or mutation where necessary. No inventory migration is required.
