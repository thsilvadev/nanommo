# Tasks

## 1. Shared UI scale and shell geometry

- [x] 1.1 Add centralized desktop scale tokens and apply them to the play shell typography, spacing, controls and major headings; verify the frontend renders at the target readable density at 100% browser zoom.
- [x] 1.2 Rebalance the desktop three-column shell so lateral panels gain width and the center is reduced while respecting minimum widths; verify the intended 1918×964 viewport visually matches the supplied enlarged reference proportions.
- [x] 1.3 Make the desktop left/center/right zones share one fixed viewport-derived height and aligned bottom edge across Grind, Town, Character and Gambit content; verify switching routes does not change the outer panel height.
- [ ] 1.4 Preserve and explicitly override responsive breakpoints so desktop-only sizing does not create horizontal overflow below the desktop breakpoint; verify the existing mobile smoke/build still passes.

## 2. Grind map and inventory layout

- [x] 2.1 Change the Grind workspace to a map-plus-inventory internal layout with a 4:3 map area and a vertical inventory column; verify the map preserves its aspect ratio at the target desktop viewport.
- [x] 2.2 Move the 50-slot Grind inventory beside the map as exactly 5 columns × 10 rows and remove the lower horizontal inventory placement; verify all 50 cells are visible without page scrolling.
- [ ] 2.3 Keep battle/map state, drag/drop behavior, stack counts and tooltips intact while changing only presentation/layout; verify an item can still be dragged and its count remains readable.

## 3. Shared item-slot sizing

- [x] 3.1 Centralize the item icon-to-slot sizing rule and apply it to inventory, Character equipment and NPC/vendor stock surfaces; verify the same relative icon occupancy is visible in all three contexts.
- [ ] 3.2 Update drag previews/placeholders and tooltip positioning for the larger icons; verify drag/drop and hover tooltips remain correctly anchored and items remain upright.
- [ ] 3.3 Check future item-slot reuse points in the frontend and route them through the shared visual rule where they already use the common item-slot structure; verify no duplicate per-panel icon sizing remains for the affected surfaces.

## 4. Character summary composition

- [ ] 4.1 Rebuild the Character summary equipment grid into left/right columns around the centered portrait while preserving all eight equipment slots and existing interactions; verify each compatible slot remains a valid drag target and double-click fallback still works.
- [x] 4.2 Add a fixed/reserved status region below the HP/SP/equipment content without implementing status effects; verify the Character panel remains visually balanced even when the region is empty.
- [x] 4.3 Align the enlarged Character summary typography, portrait and equipment icon scale with the shared desktop scale; verify the panel remains fixed-height and does not resize from content.

## 5. Verification and documentation

- [x] 5.1 Update PLAY_WINDOW_SPEC.md with the new desktop shell proportions, fixed-height invariant, 4:3 map + 5×10 inventory composition, shared item-slot sizing rule and Character equipment/status layout; verify the document matches the implemented contract.
- [x] 5.2 Run shared/API/frontend builds and git diff --check; verify no build errors or whitespace errors are introduced.
- [x] 5.3 Run strict OpenSpec validation for play-ui-scale-layout; verify the change validates successfully.
- [ ] 5.4 Run a browser smoke check at 100% browser zoom for Grind, Town, Character and Gambits at the target desktop viewport plus an existing narrow/mobile viewport; verify panel alignment, readability, inventory geometry, item sizing and absence of horizontal overflow.
