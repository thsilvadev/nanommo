# Proposal

## Why

The current desktop play shell is visually underscaled at the browser's normal 100% zoom: text, controls and item icons occupy too little of the available viewport while the central area leaves excessive empty space. The attached 170% reference demonstrates the intended readable density, so the game UI should adopt that visual scale at normal browser zoom while using the freed central width for a more deliberate map/inventory composition.

## What Changes

- Increase the effective desktop UI scale at 100% browser zoom through the application's own sizing/typography tokens; do not require browser zoom.
- Rebalance the desktop three-column shell so the left and right panels gain width while the central play area becomes narrower.
- Give the Grind center a 4:3 map area and place the 50-slot inventory beside it inside the central panel as a vertical 5-column × 10-row grid.
- Remove the current inventory position below the map on Grind.
- Increase item-icon occupancy inside inventory/equipment/vendor/NPC-stock and other item-slot surfaces through one shared slot/icon sizing rule.
- Redesign the Character summary equipment arrangement into columns surrounding the character portrait, with reserved space below SP for future status-effect icons.
- Keep left, center and right shell panels at one fixed desktop height, aligned near the bottom of the viewport, across all play screens; internal content may leave intentional empty space.
- Preserve the existing dark-fantasy visual language, gameplay contracts, responsive/mobile behavior, tooltips and server-authoritative state.
- Treat the attached 100% and 170% screenshots as visual references, not runtime assets.

## Capabilities

### New Capabilities

- `play-ui-scale-layout`: Defines the desktop UI scale, shell proportions, fixed panel geometry, Grind map/inventory composition, shared item-slot icon sizing, and Character summary layout.

### Modified Capabilities

None.

## Impact

- Primarily affects Angular frontend shell, Grind/map/inventory, Character summary, Character page and reusable item-slot styling.
- No backend/API/data-model changes are expected.
- No new dependency is required.
- The existing desktop-first/mobile-second responsive architecture remains intact; mobile-specific routes and behavior must not be regressed.
