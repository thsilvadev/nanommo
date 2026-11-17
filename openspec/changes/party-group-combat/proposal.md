# Party and shared PvE combat

## Why

Characters currently resolve independent solo queues. A Party needs one authoritative encounter and result for every participant, while equipment and Gambit edits must preserve the next encounter deadline. Reconnecting or restarting a worker must not duplicate combat, rewards or consumables.

## What Changes

- Add manual Party and opt-in AutoParty for 2–5 characters on the same map, invitations and deferred joins/leaves, ordered formation and leader permissions.
- Introduce versioned deterministic team combat with a 500 ms tick, an internal 10×10 grid, at most five players and ten monsters, actor-aware Gambits, log/replay and one immutable shared snapshot/result.
- Persist immutable encounter clocks and ordered idempotent intents; edits never extend search or gathering time.
- Configure exclusive seeded raid candidates per map roster entry, initially all zero percent; divide XP and drops among living eligible participants and resolve all participants atomically.
- Add leader-only group FLEE, hunger safeguards and ten effective seconds of pausable Fast Travel.
- Add Super Tonics sharing a 60-second cooldown: Fairy in a Bottle and Sapupema Leaf Tea. Preserve the user's Fairy level 10 and ten Mystic Dust. Tea requires Alchemy 7, 25 Herbs, eight Sapupema Leaves and awards 25 XP; Caetê 6 has 10% leaf weight. Antidote becomes a level 1 Potion made from two Herbs.
- Present group state, current targets, pending operations and a shared live log without a rendered arena.
- Preserve legacy active battles and histories, appearance guards and recovery/cutover behavior; provide forward-only schema and an operational rollback procedure.

## Impact

Shared engine/types; PostgreSQL entities/migration and recovery; Party/Battle/Inventory/Map/Town/Gambit/Quest services and authenticated REST/Socket interfaces; map/item/recipe catalogues and frontend mirrors; Angular stores and play interface; OpenSpec and rollout documentation. Production migration, queue deletion and deployment are outside this implementation request.
