# Proposal

## Why

The existing shortest route treats every intermediate map as an ordinary segment, even when the character's saved Town is itself an intermediate node. That misses the saved-Town teleport shortcut while traveling to a different destination. Separately, the map's location pin stays at the current tile center for the entire route, so it does not communicate segment progress or pauses during combat.

## What Changes

- When the canonical cardinal BFS route to a requested destination contains the character's valid saved Town strictly between the origin and final destination, use that saved Town as an instant waypoint. Teleport there, then recompute/continue the shortest route to the original destination. Do this at most once for a route; a direct click on the saved Town keeps its current behavior.
- Preserve the existing queue lock, persisted intent, battle pause, and parallel FLEE rules. If a battle is active when the destination is selected, the saved-Town teleport waits until the battle resolves (by normal resolution, successful FLEE, or death handling); the server remains authoritative for whether the intent survives.
- Animate the frontend location pin inside the current map tile from the incoming edge to the outgoing edge of the authoritative active route segment. Use the same normalized progress and timing as the Traveling gauge, freeze during battle/speed pause, and use cardinal straight-line interpolation only.
- Remove the pin's vertical bounce while traveling, since it would make the visible position deviate from the straight path. Keep settled-pin presentation unchanged.

## Non-goals

- No changes to route discovery, BFS tie-breaking, world movement speed/duration, encounter/FLEE formulas, town NPC availability, map layout/art, or combat simulation.
- No database schema/migration, deployment, or live database mutation.

## Impact

Backend: shared world-activity route helper and `MapService`. Frontend: `MapBoard` template/component/styles and focused tests. Update canonical SPEC mirrors, ARCHITECTURE, and STATUS after verification.
