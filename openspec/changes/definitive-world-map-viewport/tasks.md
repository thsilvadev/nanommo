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

- [ ] 3.1 Implement mouse and touch panning through a unified Pointer Events path with pointer capture, pointer deltas, a drag threshold and click suppression; verify a drag pans but does not enter a map accidentally.
- [ ] 3.2 Clamp horizontal/vertical camera offsets to 0–1534px and 0–1329px and preserve the fixed 761×660 viewport; verify dragging toward every edge cannot expose outside-world space and does not scale the background or cells.

## 4. Persistent exploration veil

- [ ] 4.1 Add `Character.discoveredMapIds` with a JSONB safe default, initialize newly created characters with `map_town`, and add a forward-only migration that backfills Sierra-Village plus each character's valid post-migration current map; verify new/existing characters have deduplicated IDs.
- [ ] 4.2 Persist a destination as discovered only when the authoritative map arrival commits; calculate reveal state from each discovered coordinate plus its four cardinal neighbors, and render all other cells under a contiguous black veil; verify north/south/east/west visibility, no diagonal leakage, empty revealed cells and per-character isolation.
- [ ] 4.3 Add API/frontend tests for rejected and pending transitions, reload persistence, repeated discovery idempotence and no premature reveal; verify the visible tile set derives from canonical coordinates rather than persisted per-cell flags.

## 5. Multi-Town transitions and zero-level entry

- [ ] 5.1 Refactor map-entry behavior by catalogue type: Town locations enter with Town status and no battles; grind locations retain email and Hungry/food eligibility but remove level gating entirely; verify all map records have `unlockLevel: 0` and test entering grind maps with characters at levels 1, mid-game and high level.
- [ ] 5.2 Preserve `map_town` as Sierra-Village and support Outpost, Kwaiouá-Taba, Aramaia-City and Emperial-Capital-Caelum as exact Town destinations; keep the selected Town destination in pending transitions and preserve the active battle snapshot/job while deferring its final transition; verify each Town can be entered without queueing battles.
- [ ] 5.3 Audit all single-`map_town` checks so only default return-to-Town behavior is fixed to Sierra-Village while Town access, presence and Vendor/Storage guards use the canonical current map type; verify Storage is present/usable on every Town map and blocked outside Town.
- [ ] 5.4 Keep grind-map switching behind the existing safe future-queue mutation boundary; verify an active BattleQueueEntry, worker job and snapshot remain unchanged while only eligible future encounters are reconciled for the destination.

## 6. Migration safety, documentation and integration verification

- [ ] 6.1 Remap old `map_lv_*` IDs to valid new grind locations deterministically, preserve `map_town`, backfill discovery, and add migration tests for idempotence and character-level recommendation fallback; verify active/resolved battle snapshots and logs are never rewritten.
- [ ] 6.2 Update `SPEC.md`, its `openspec/specs/SPEC.md` mirror and `ARCHITECTURE.md` with canonical world coordinates, discovery, multi-Town semantics, zero-level access, no-gap visual contract and queue/migration boundaries; update `STATUS.md` only after the implementation and validations actually pass.
- [ ] 6.3 Run catalog/roster tests, discovery and transition tests, focused API tests, shared/API/frontend production builds, OpenSpec strict validation and `git diff --check`; verify the map viewport in a browser at desktop and touch-sized viewports without deploying or running database migrations against an unaudited live schema.
