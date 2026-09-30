# Design

## Current findings

1. BattleStore already receives battle:resolved and currently reloads Character and Inventory, but no dedicated inventory/HP event exists for every authoritative mutation. Battle resolution persists consumed items and drops before publishing the resolved event.
2. MapBoard.enterTown() only considers the locally selected active battle. Encounter-search entries are future-start entries, so a Town request during search currently falls through to immediate leave behavior instead of expressing a pending return against the queued loop.
3. BattleService.resolveBattle() currently loops through all XP thresholds in one resolution and applies battle.goldGain; resolveRewards() currently rolls monster.goldReward.
4. CharacterService.createCharacter() currently grants 10 HP potions and 5 Bread.
5. Town regeneration is currently calculated lazily from lastSeenAt, while Grind battle HP/regen is represented inside simulated battle logs. A continuous server timeline is required so battle boundaries do not reset a regen interval.
6. InventoryGrid and CharacterSummary derive item display from catalog IDs, but the hover surface is not a complete reusable item presentation and equipped slots expose only an item ID string.

## Server-authoritative approach

- Keep all gameplay mutations in existing API/services and BattleEngine/BullMQ paths.
- Extend existing /game facts only where needed to publish authoritative Character/Inventory deltas or full post-resolution state. REST bootstrap/reconnect remains the fallback authority.
- Store only transient Drops this session presentation state in the frontend, seeded/reset by Grind-session boundaries and populated from authoritative resolved-drop facts. Do not persist it as gameplay data.
- Represent a Town-return request as transient server-side character/loop state only if the existing battle queue requires it; otherwise correct the existing leave/queue lifecycle so the already authoritative status transition occurs once the current battle resolves.

## XP rule

At each successful resolution, apply the authoritative XP gain and perform at most one threshold transition. Preserve the remaining XP according to the existing toward-next-level representation. Add focused tests proving a large payout cannot move a character more than one level in that resolution.

## Regen rule

Regeneration must be keyed to a character-owned continuous tick timeline, not a Battle instance. The implementation should reuse the existing 1-second tick and existing derived regen values. A battle ending does not reset the next 10-tick boundary; encounter search and non-battle Grind time continue consuming the same timeline. Persist enough authoritative timing/state to survive process/reconnect boundaries without adding a parallel gameplay clock.

## Drops and rates

First verify the chance parser/PRNG semantics and the actual monster catalog values. Then adjust only the configured rates necessary for the intended Grind pace, preserving relative rarity. Record exact before/after values in the implementation notes. Do not blindly multiply all rates.

## Town return

The client may show pending feedback immediately, but it must not cancel or resolve a battle. The authoritative server state after the current active battle resolves must transition to Town when a return was requested. During encounter search, no battle is active yet, so the existing map-leave operation should complete immediately if the character is still safely in Grind.
