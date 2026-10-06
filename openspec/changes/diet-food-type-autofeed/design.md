# Design

## Item boundary

food_buff items are catalogued as `type: food`. Ordinary battle-use items remain `type: consumable`. The distinction is authoritative and is checked by both the shared Gambit evaluator and the API inventory service.

## Consumption paths

There are exactly two legal food paths:

1. **Manual:** the player uses a `food` item through the existing inventory REST action while outside battle. It continues through the transactional `consumeFood()` authority.
2. **Automatic:** `tryAutoFeed()` consumes an eligible `food` from the configured Diet during authoritative Grind battle resolution.

A `food` item is never legal for Gambit `use_item`, and the shared BattleEngine therefore cannot consume food during a battle simulation.

## Grind continuity

Auto Feed remains a battle-resolution concern only. After applying the resolved battle's authoritative state, the server evaluates the current Diet on every resolution boundary. It walks the current Diet and consumes every currently eligible food available in Inventory, up to the three Diet slots, through the authoritative `consumeFood()` path; an already-active food buff does not suppress this evaluation. The Diet is re-read after each successful consumption so FIFO rotation and the no-same-food-while-digesting rule remain authoritative. On any success, unresolved precomputed battles are discarded and rebuilt once from the new authoritative Character + Inventory state. Only then may the resolver route the character to Hungry/Town.

No extra Auto Feed action is performed on map entry; the existing server-side resolution boundary is the single continuity trigger.

## Compatibility

Existing queued battle logs may still contain historical `use_item` food events. `applyResolvedFoodState()` continues to understand those logs so already-created entries can resolve safely, but new simulations cannot create such events.
