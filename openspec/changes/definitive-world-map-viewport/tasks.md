# Tasks

## 1. Canonical world catalogue and roster validation

- [ ] 1.1 Replace the seven placeholder entries in root `maps.json` with the 41 locations and exact coordinates/types/border metadata in `design.md`; set every `unlockLevel` to numeric `0`, preserve advisory `recommendedLevel`, include all listed editable rosters, and verify the catalogue has 41 unique IDs, 41 unique in-bounds coordinates and 100% rates for each of the 36 grind maps.
- [ ] 1.2 Synchronize `apps/frontend/public/data/maps.json` with the canonical root catalogue and extend the existing catalogue validator/DataService checks; verify Town NPC/Storage references, all monster IDs, numeric zero unlock levels, valid roster totals and parity between root and frontend JSON.
- [ ] 1.3 Update map recommendations to use advisory `recommendedLevel` rather than `unlockLevel`; verify recommendation API behavior with representative character levels while confirming that its output never denies access to a map.

## 2. World artwork, contiguous tiles and accessible map controls

- [ ] 2.1 Copy the approved 2295×1989 `project/map-background.png` and `project/pinpoint.png` into the frontend's served map assets; verify source/output dimensions and byte integrity after a production build.
- [ ] 2.2 Refactor `map-board.html/css` and `MapBoard` in `components.ts` from the horizontal placeholder row into the fixed 15×13 world, rename `map-art` to `viewport`, align artwork and coordinates, and remove all grid gap, margin and padding that would create separation between the 153×153 cells; verify each cell remains exactly 153×153px and world size is exactly 2295×1989px.
- [ ] 2.3 Render transparent clickable overlays with an internal 1px near-white light-gray border, hover/focus border highlight and pointer cursor; remove level legends and opaque placeholder icons; verify adjacent cells share edges without gaps, the border does not alter geometry and map tiles render no level label.
- [ ] 2.4 Add the current-location pinpoint in a pointer-transparent layer and recenter the camera around the authoritative current map on initial load/committed map changes; verify its visual center matches the cell center and deferred transitions do not move it early.

## 3. Pointer camera and drag-safe interaction

- [ ] 3.1 Implement mouse and touch panning through a unified Pointer Events path without pointer capture on initial pointer-down, using pointer deltas, a drag threshold and click suppression; browser-verify a drag pans but does not enter a map accidentally.
- [ ] 3.2 Clamp camera offsets to `worldWidth - viewportWidth/zoom` and `worldHeight - viewportHeight/zoom` while preserving the fixed 761×660 viewport; verify dragging at every zoom cannot expose outside-world space and only scales the world layer.

## 4. Persistent exploration veil

- [ ] 4.1 Add `Character.discoveredMapIds` with a JSONB safe default, initialize newly created characters with `map_town`, and add a forward-only migration that backfills Sierra-Village plus each character's valid post-migration current map; verify new/existing characters have deduplicated IDs.
- [ ] 4.2 Persist a destination as discovered only when the authoritative map arrival commits; calculate reveal state from each discovered coordinate plus its four cardinal neighbors, and render all other cells under a contiguous black veil; verify north/south/east/west visibility, no diagonal leakage, empty revealed cells and per-character isolation.
- [ ] 4.3 Add API/frontend tests for rejected and pending transitions, reload persistence, repeated discovery idempotence and no premature reveal; verify the visible tile set derives from canonical coordinates rather than persisted per-cell flags.

## 5. Multi-Town transitions and zero-level entry

- [ ] 5.1 Refactor map-entry behavior by catalogue type: Town locations enter with Town status and no battles; grind locations retain email and Hungry/food eligibility but remove level gating entirely; verify all map records have `unlockLevel: 0` and test entering grind maps with characters at levels 1, mid-game and high level.
- [ ] 5.2 Preserve `map_town` as Sierra-Village and support Outpost, Kwaiouá Taba, Ancient Aramaia City and Imperial Capital Caelum as exact Town destinations; keep the selected Town destination in pending transitions and preserve the active battle snapshot/job while deferring its final transition; verify each Town can be entered without queueing battles.
- [ ] 5.3 Audit all single-`map_town` checks so only default return-to-Town behavior is fixed to Sierra-Village while Town access, presence and Vendor/Storage guards use the canonical current map type; verify Storage is present/usable on every Town map and blocked outside Town.
- [ ] 5.4 Keep grind-map switching behind the existing safe future-queue mutation boundary; verify an active BattleQueueEntry, worker job and snapshot remain unchanged while only eligible future encounters are reconciled for the destination.

## 6. Migration safety, documentation and integration verification

- [ ] 6.1 Remap old `map_lv_*` IDs to valid new grind locations deterministically, preserve `map_town`, backfill discovery, and add migration tests for idempotence and character-level recommendation fallback; verify active/resolved battle snapshots and logs are never rewritten.
- [ ] 6.2 Update `SPEC.md`, its `openspec/specs/SPEC.md` mirror and `ARCHITECTURE.md` with canonical world coordinates, discovery, multi-Town semantics, zero-level access, no-gap visual contract and queue/migration boundaries; update `STATUS.md` only after the implementation and validations actually pass.
- [ ] 6.3 Run catalog/roster tests, discovery and transition tests, focused API tests, shared/API/frontend production builds, OpenSpec strict validation and `git diff --check`; verify the map viewport in a browser at desktop and touch-sized viewports without deploying or running database migrations against an unaudited live schema.

## 7. Interaction and presentation follow-up (2026-10-19)

- [x] 7.1 Preserve native map-tile click targeting by avoiding pointer capture on initial pointer-down; delegate clicks by stable map ID and suppress clicks only after an actual drag.
- [x] 7.2 Normalize displayed map names into natural-language words and use the same canonical JSON in the frontend mirror.
- [x] 7.3 Add cursor-anchored wheel zoom from 100% to 50% and adjust world-space panning/clamping at the active zoom.
- [x] 7.4 Add an immediate dark/bronze tooltip mounted outside clipped ancestors, with prominent map name and smaller Recommended level subtitle.
- [x] 7.5 Place the transparent 34px map header inside the fixed viewport and preserve the empty panel space below it.
- [x] 7.6 Repair the known Town-only initial discovery bootstrap when its only unrelated entry is Green Grounds 4; include the authoritative current map in server discovery checks and return the service transition result from the controller.
- [ ] 7.7 Browser-verify map entry/network requests, initial Town reveal, tooltip placement at viewport edges, header overlay, and zoom/pan at desktop and touch-sized viewport sizes.
- [x] 7.8 Align fog-cell coordinate generation with the map tile grid (`column = x + 7`, `row = 6 - y`) so a discovered map reveals its own cell and only the four cardinal neighbors at the correct visual positions.
- [x] 7.9 When a Town destination is requested during an active battle, persist only `pendingMapTransition` without changing `status` to `town`; keep the Grind panel and waiting message until the resolver commits the requested destination after battle resolution.
- [ ] 7.10 Regression-verify the fog positions around Green Grounds 0 at (-1, 0), and browser-verify Town return while a battle is active, including the panel remaining in Grind until the committed transition.
