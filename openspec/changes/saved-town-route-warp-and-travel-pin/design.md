# Design

## Saved-Town waypoint

At map-request time, compute the same deterministic cardinal BFS route the server already uses. A saved-Town waypoint applies only when:
- the request is not a direct click on the saved Town;
- the saved map is a canonical clickable `town`;
- the route contains that map at an index greater than zero and before its final node.

In this case persist a `saved-town-route-teleport` intent that retains the clicked destination and identifies the waypoint. `advanceTravel` must check the battle queue before processing this intent, just like all other travel. Once no started battle blocks movement, atomically commit currentMapId to the saved Town, clear old-map travel/gathering/encounter progress and obsolete future battle rows, then recompute BFS from the saved Town to the original destination and replace the intent with an ordinary route. Route generation/scheduling remains the existing durable flow. If the saved Town is already the origin or final destination, do not add a waypoint. Direct clicks on saved Town retain the existing terminal teleport.

The waypoint teleport is performed at most once because the special intent is converted to an ordinary route in the same transaction. The target remains the original clicked map. If validation or the continuation route fails, clear the invalid intent without creating a loop; the normal connected canonical map graph should make this a defensive failure path. The teleport commits only after a current battle no longer blocks it. On death during this special route, respawn occurs at the saved Town and the route resumes toward the original target; deaths outside this special route keep existing behavior.

## Location-pin position

Use `Character.travelIntent.routeMapIds`, `segmentIndex`, and the same `activityProgress()` used by the gauge. For a normal route segment, derive the entry edge from the previous route node; on the first segment with no remembered entry direction, use the edge opposite the next node as the starting edge. Derive the exit edge from the next route node. Move linearly from entry edge to tile center over the first half of segment progress, then linearly from tile center to exit edge over the second half. With cardinal BFS, each leg changes only one coordinate and turns happen at the tile center.

At a segment arrival, the current map and segment index advance together; the next position begins on the edge shared with the map just left, so the visible pin remains on the exact same map-grid boundary and then moves across the new tile. If the route is inactive or there is no valid next node, keep the remembered incoming edge after arrival when available, otherwise fall back to the tile center. A saved-Town teleport is an instantaneous location change, not a fake animated segment.

Progress is sourced from `activityProgress()`, which already observes the persisted segment progress, estimated local accrual, speed pause, `waitingForBattle`, and active battle intervals. The pin therefore cannot advance through a battle or independently simulate travel. Disable its existing bounce animation only while a route is active.

## Verification

- Shared tests: only an intermediate saved-Town route node produces a waypoint index; origin/final destinations do not.
- API contract tests/build: special intent keeps original destination, defers during a started battle, teleports to the saved Town, and continues from a recomputed route; no direct saved-Town behavior regression.
- Frontend tests: positions for all four cardinal directions, route-segment handoff edge continuity, progress 0/0.5/1, stationary center fallback, and gauge-identical pause behavior.
- Run shared/API/frontend tests and builds available offline, OpenSpec strict validation, and `git diff --check`. No migration, database mutation, or deployment.
