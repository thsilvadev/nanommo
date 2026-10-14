# Design

## Authoritative model

`Character.diet` is an ordered array of at most three unique food `itemId` values. The leftmost entry is the oldest retained food; the rightmost is the most recently consumed. Digestion expiry alone does not remove an entry: an expired food stays visible until a later successful consumption displaces or reorders it.

`dietLevel` is streak progress attached to an item only while that item is retained in the Diet window, range 0–3. `dietLevels` remains the per-item authority for current retained level and last digestion boundary, but these meanings must not be conflated:
- For an item retained in Diet, `level` agrees with that unique Diet entry.
- When an item is evicted, its streak level resets to 0.
- Its `lastDigestUntil` must still be retained while the timestamp is in the future, so evicting a food cannot let the player eat it while it is still digesting. An absent item's level must never be resurrected from old map data.
- Expired digestion records with no retained Diet entry may be cleaned up; this cleanup must not affect retained levels or any active/queued battle snapshot.

The active food buffs, food-stat scaling formula, food duration and battle mutation boundary stay as specified elsewhere.

## Consumption transition

All paths use one authoritative, deterministic transition helper. Under the Character lock/transaction, it must validate that the selected item is food and that its latest digestion boundary has elapsed before changing Inventory or Diet.

For a valid consumption:

1. Read the selected item's current retained Diet entry, if present. Compute its next level **before any eviction**: retained item → `min(current level + 1, 3)`; item absent from Diet → level 0. This keeps the level-3 cap and prevents stale `dietLevels` records from restoring an evicted streak.
2. If the Diet has three entries at the start of the transition, evict its oldest/leftmost entry. If that item's streak is not the selected food's retained streak, reset that evicted item's level to 0. Keep its future `lastDigestUntil` for the digestion guard.
3. Remove any remaining occurrence of the selected `itemId` from the retained entries. This is required even if it was not the oldest item.
4. Append one new entry for the selected food at the right with the consumption timestamp, new digestion boundary and computed next level. Preserve the order of every other retained entry.
5. Persist a Diet with no duplicate `itemId`, at most three entries, and a matching `dietLevels` projection. Inventory decrement, Diet, digestion state and active buff remain atomic under the existing transaction path.

If Diet has fewer than three entries at the start, skip step 2: a new food fills the next empty slot, and a repeat moves its existing entry to the right without evicting an unrelated food.

The full-window rule deliberately ages out the leftmost item on every subsequent meal, including when the selected food was already the rightmost entry. This represents the last three food-consumption events with repeated food types coalesced into unique slots.

## Required examples

Entries below are shown oldest-to-newest; a missing level is level 0.

| Before | Consumed | After |
|---|---|---|
| `[Bread ★★★]` | Bread | `[Bread ★★★]` |
| `[Bread ★★★]` | Cheese | `[Bread ★★★, Cheese]` |
| `[Bread ★★★, Cheese]` | Bread | `[Cheese, Bread ★★★]` |
| `[Cheese, Bread ★★★]` | Cheese | `[Bread ★★★, Cheese ★]` |
| `[Bread ★★★, Cheese ★]` | Meat | `[Bread ★★★, Cheese ★, Meat]` |
| `[Bread ★★★, Cheese ★, Meat]` | Cheese | `[Meat, Cheese ★★]` |

In the last example, the full Diet first drops Bread, which has not been eaten in the last two consumption events. Meat shifts into the older retained slot and Cheese returns to the newest slot at ★★.

Repeatedly consuming Bread → Cheese → Meat, after each food's digestion finishes, increments each retained food's level up to ★★★. A food that is displaced out of the three-entry window loses its streak; later reintroduction starts at level 0 once it is no longer digesting.

## Legacy duplicate normalization

Existing rows can contain duplicate `itemId` entries from the old append-on-repeat behavior. Normalize them deterministically before the next gameplay mutation and through a one-time data normalization:
- retain one entry per `itemId`;
- order retained foods by the recency of their newest occurrence (oldest retained first);
- preserve the maximum `dietLevel` found among duplicate entries for that retained food, to avoid destroying already-visible progress;
- use the newest occurrence's `consumedAt` and a safe latest digestion boundary for eligibility;
- ensure any item absent from the normalized Diet has level 0, while keeping a future `lastDigestUntil` only as a digestion lockout;
- never create replacement entries to fill slots vacated by deduplication.

The normalized state must be returned coherently by the Character DTO and persisted without changing Inventory quantities. This is a state repair, not an extra food consumption.

## Integration boundaries

- Manual `POST /inventory/use`, Auto Feed, Father Marcelus/NPC food grant and battle-resolution food events use the same transition semantics.
- Auto Feed examines only the newest valid digestion boundary for each food ID; a still-digesting candidate is skipped normally and other eligible candidates may be tried.
- Battle simulation and resolution must derive the same post-consumption level and Diet order. A change to future food state crosses the existing `BattleService.runFutureCombatMutation()` boundary; an active battle queue entry/job remains immutable.
- Frontend Diet renders the authoritative three unique entries. It must not deduplicate locally or decide whether food is consumable.

## Risks and traps

- Do not compute the new level after dropping the oldest entry; otherwise consuming the leftmost food at full capacity would incorrectly lose its streak.
- Do not delete a food's future digestion boundary when its streak is evicted.
- Do not rebuild `dietLevels` solely from visible entries if that would lose digestion lockout data.
- Do not leave the old behavior that permits multiple retained occurrences of one food ID.
