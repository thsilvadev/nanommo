# Proposal

## Why

The current board is a seven-tile level placeholder rather than the first designed world, and its 90px horizontal-row layout cannot use the supplied 2295×1989 map artwork. Replace it with the full coordinate-driven world and a movable 761×660 viewport, persistent character exploration and safe multi-town navigation.

## What Changes

- Replace the six `lv. N` placeholder maps with the 41 specified world locations. Keep root `maps.json` as the sole canonical map/roster catalogue and mirror it to the frontend.
- Use five Town destinations — Sierra-Village, Outpost, Kwaiouá-Taba, Aramaia-City and Emperial-Capital-Caelum — while only `grind` maps start grinding. Assign unique stable IDs to all locations and unique display names to repeated Menace-Hills/Wastelands entries.
- Set every map's `unlockLevel` to numeric `0`. Remove minimum-level checks from map entry and remove the level label/legend from map tiles. Preserve the submitted level bands only as optional `recommendedLevel` guidance; recommendations must never gate entry.
- Build a continuous 15-column × 13-row world grid of 153×153px cells (2295×1989px), using `project/map-background.png`. Rename the existing `map-art` visual container to `viewport`; keep its 761×660px viewing window fixed and support mouse/touch panning. Do not scale cells or add gaps between them.
- Render interactive locations with a transparent overlay and exactly a 1px inset/internal border in near-white light gray; use a visible hover/focus border highlight and pointer cursor. Do not add tile fill, spacing or placeholder icons that obscure map art.
- Add persistent per-character map discovery. Entering a map discovers it and unveils it plus the four cardinal neighbors. Unknown terrain remains under a black veil; visible neighboring locations can be selected without being marked discovered until arrival succeeds.
- Show `/project/pinpoint.png` centered on the character's authoritative current map. Center the initial camera on that map, clamp panning to world bounds, and prevent a drag from accidentally activating a tile.
- Distribute monster presence across every grind map. Preserve the supplied rates where present and define editable, level-conscious rosters for omitted locations. Validate unique IDs/coordinates, in-grid positions, valid species references and 100% roster totals.
- Route all Town-map clicks through the safe transition flow without starting battles. Retain Sierra-Village's existing NPCs and put the canonical Storage NPC on every Town map. Update map lookup, recommendation display, Town guards and return-to-Town behavior to support multiple Town destinations.
- Add a forward-only migration for legacy map IDs and discovery bootstrap. Preserve `map_town` as Sierra-Village's stable ID; never rewrite active/resolved battle snapshots or historical logs. Follow the project's stopped-consumer, migration-history audit and queue/presence reconciliation safeguards.
- Update `SPEC.md`, its `openspec/specs/SPEC.md` mirror, `ARCHITECTURE.md` and `STATUS.md` when implementation is applied, with focused catalogue, discovery, transition, camera and viewport tests.

## Capabilities

### New Capabilities
- `world-map-exploration`: canonical coordinate-driven world map, movable viewport, persistent exploration/fog-of-war, current-location pin, zero-level-lock navigation and Town/grind transitions.

### Modified Capabilities
- None. The OpenSpec capability inventory is currently empty; this change introduces the behavior as a new capability. The full-game `SPEC.md` remains the existing project-wide reference and will be updated during implementation.

## Impact

Expected areas: root `maps.json` and `apps/frontend/public/data/maps.json`; `apps/frontend/src/app/features/play/map-board.{html,css}` and map logic currently hosted in `components.ts`; `apps/api/src/modules/map/`, `DataService`, character DTO/creation flow and database entities/migrations; shared map types/constants; catalogue validators and tests; `project/map-background.png` (2295×1989) and `project/pinpoint.png`. Combat simulation and drop mechanics remain unchanged except for map-owned monster rosters and location IDs.
