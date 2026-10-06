# Design

## Root cause

The resolver calls the authoritative Auto Feed check after applying the resolved battle and after reading unresolved future entries. It passes the first future startAt as the boundary. When queue generation has already stopped because the active food cannot safely cover another encounter, there is no future entry, so the fallback boundary is Date.now().

That fallback is incorrect. The relevant decision point is the next encounter boundary, not the instant at which the current battle resolver happens to run. If the active food expires shortly after resolution, activeExpiresAt is still greater than Date.now(), so Auto Feed is suppressed even though the next encounter would start after the food has expired. The queue can then remain empty until another external authoritative action occurs, violating Grind continuity.

## Technical approach

1. Derive the next safe encounter boundary from the authoritative current battle end and the same encounter-search delay used by queue generation. Do not create a client timer.
2. Prefer the existing first unresolved battle startAt when one exists; otherwise calculate the next encounter start from the current battle end plus the authoritative search interval for the character's current map.
3. Keep candidate selection based on the retained Diet window and authoritative Inventory quantity. Preserve the existing consumeFood transaction and its Diet/streak semantics.
4. If Auto Feed succeeds, discard unresolved future entries and rebuild the queue from the newly persisted Character and Inventory state before evaluating the normal Hungry/Town fallback.
5. Make the boundary calculation reusable and testable so regression coverage includes both queued-next-battle and empty-future-queue paths.
6. Preserve the existing realtime snapshot contract: the post-resolution Character and Inventory revision must represent the automatic consumption and the rebuilt queue must be derived from that same state.

## Important traps

- Date.now() is not a substitute for the next encounter boundary when the future queue is empty.
- The search interval is gameplay time and must be included in the boundary; otherwise Auto Feed can still fire too late by the base 2 seconds plus map-population delay.
- Do not consume a food merely because it is close to expiry if the next encounter starts safely before expiry.
- Do not create a second food-consumption implementation. Manual and automatic use must continue through consumeFood.
- Do not let the frontend repair this with polling or a timer. The server must resolve the boundary and queue continuity.
