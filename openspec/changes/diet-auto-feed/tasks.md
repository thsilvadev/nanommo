# Tasks

## 1. OpenSpec and data contract
- [x] 1.1 Add Diet/Auto Feed requirements and scenarios.
- [x] 1.2 Define Character persistence, migration defaults, DTOs and frontend models.
- [x] 1.3 Remove the obsolete self_hungry contract from catalog/spec references.

## 2. Shared engine
- [x] 2.1 Preserve generic use_item food handling and expose sufficient result data for authoritative Diet updates.
- [x] 2.2 Add deterministic tests for food replacement and buff expiration boundaries without wall-clock APIs in the engine.

## 3. Backend
- [x] 3.1 Add Character Diet, dietLevels and autoFeed persistence.
- [x] 3.2 Centralize authoritative food consumption for manual use and Auto Feed.
- [x] 3.3 Validate digestion/repeat-food/star rules and inventory quantity atomically.
- [x] 3.4 Integrate Auto Feed with battle resolution, queue generation, crash recovery and Hungry/Town transitions.
- [x] 3.5 Rebuild future queue after Auto Feed consumption using new authoritative state.
- [x] 3.6 Add REST DTOs/endpoints needed by the UI and authoritative state refresh.

## 4. Frontend
- [x] 4.1 Render Diet below equipment with exactly three food slots and the existing tooltip system.
- [x] 4.2 Show permanent food stars from authoritative Diet state.
- [x] 4.3 Add Auto Feed switch bound to authoritative server state.
- [x] 4.4 Keep manual food use through the existing inventory consumable action.
- [x] 4.5 Remove self_hungry from Gambit UI/catalog rendering.
- [x] 4.6 Never use client polling/timers to decide food consumption or grind continuity.

## 5. Realtime and regression coverage
- [x] 5.1 Extend Character snapshots with Diet/Auto Feed.
- [x] 5.2 Verify Character + Inventory + Diet convergence regardless of resolved/queueUpdated order.
- [x] 5.3 Verify reconnect restores Diet, Auto Feed, food buff, Inventory and Character coherently.
- [x] 5.4 Add minimum Diet, Inventory, Auto Feed, Gambit and grind-boundary tests.

## 6. Verification and documentation
- [x] 6.1 Update SPEC.md and openspec/specs/SPEC.md only where required.
- [x] 6.2 Update ARCHITECTURE.md and STATUS.md with the final authoritative timing trap and evidence.
- [x] 6.3 Build shared, API and frontend.
- [x] 6.4 Run focused tests, strict OpenSpec validation and git diff --check.
- [ ] 6.5 Perform browser smoke coverage for Diet, stars and Auto Feed.
- [x] 6.6 No production deploy.
