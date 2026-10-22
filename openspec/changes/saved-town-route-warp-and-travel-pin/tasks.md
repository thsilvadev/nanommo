# Tasks

## 1. Saved-Town route waypoint
- [x] 1.1 Add and test a shared helper that identifies a saved Town strictly inside a canonical route.
- [x] 1.2 Create a persisted saved-Town-route-teleport intent when the initial BFS contains that intermediate waypoint; preserve the requested final destination and existing queue-lock/FLEE semantics.
- [x] 1.3 Commit the waypoint only after no started battle blocks movement, then recompute the route from the saved Town and continue at most once.
- [x] 1.4 Add regressions for route origin/final-node exclusions, invalid/missing saved Town, battle deferral, death continuity, and continued travel. Direct saved-Town click retains its existing separate intent.

## 2. Location pin
- [x] 2.1 Derive its pixel position from the active authoritative route segment and the same progress calculation as the Traveling gauge.
- [x] 2.2 Interpolate between entry/exit edges through the center of the tile; preserve edge continuity when the current map advances.
- [x] 2.3 Freeze with the gauge during battle and speed pause; remove bounce only while Traveling.
- [x] 2.4 Add component tests for cardinal directions, progress 0/50/100, segment boundary handoff, and stationary arrival fallback.

## 3. Documentation and verification
- [x] 3.1 Update SPEC.md and openspec/specs/SPEC.md without removing unrelated history, plus ARCHITECTURE.md and STATUS.md.
- [x] 3.2 Run focused shared/API/frontend tests and builds, strict OpenSpec validation, and git diff --check. The five focused frontend tests ran in Headless Chromium.
- [x] 3.3 No migrations, live database mutations, or deployment performed.
