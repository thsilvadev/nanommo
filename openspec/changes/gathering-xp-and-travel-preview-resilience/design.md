# Design

## Travel preview

The active `Character.travelIntent` takes precedence over local preview bookkeeping. The destination tile is derived from `travelIntent.destinationMapId`; when the persisted route ends at that destination, the remaining polyline is projected from `routeMapIds.slice(segmentIndex)`. If the server intent exists but the stored path is temporarily unavailable/inconsistent, use canonical frontend BFS from the authoritative current map to the active destination rather than drawing a fabricated non-cardinal edge. Retain local `destinationMapId`/BFS only as the pre-intent request preview. Arrival is still determined by authoritative `currentMapId` and the existing reconciliation clears.

The marker has an 88px box, but its SVG artwork is not visually centered on the viewBox anchor. Apply `top - 7px` only while `travelIntent.kind === 'route'` and the current route segment is a valid cardinal edge. Do not shift an idle or settled marker.

## Gathering progression

Add integer `Character.gatheringXp` defaulting to zero. `gatheringLevel` is derived by `floor(max(0, gatheringXp) / 100) + 1`. Keep both persisted fields synchronized in `advanceStationaryActivity()`: increment XP by exactly 30 only after `canFitInventoryDrop()` succeeds and `InventoryService.addItem()` is performed, then recalculate the level before the character transaction commits. Since the loop recalculates duration for every cycle, a level acquired during offline catch-up affects subsequent cycles, not the cycle already completed. No map pool, full inventory, or absent selected resource means no XP.

The shared XP projection reports cumulative XP and current-level progress as `xpIntoLevel = gatheringXp - (level - 1) * 100`, `xpToNextLevel = 100`. The existing shared base-duration formula continues to use the authoritative level and reduces the base by one second for each level above 1.

Migration `1799900000000-GatheringProgression` adds the column idempotently and normalizes the stored level from XP. It remains forward-only and must not be executed during this implementation session.
