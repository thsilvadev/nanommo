# Design

## Context

The current shell uses a narrow left column, a wide center, a narrow right column, and a horizontal inventory below the Grind map. The existing CSS also sizes many item icons independently, which causes the same item to look undersized in different slot surfaces. See the proposal and the current `PLAY_WINDOW_SPEC.md` for the existing visual contract.

The two supplied screenshots have the same 1918×964 viewport: the first shows the current 100% presentation and the second shows the desired readability when browser zoom is increased. The implementation should reproduce the latter's perceived scale at browser zoom 100%, without changing browser settings or rasterizing the UI.

## Goals / Non-Goals

**Goals:**
- Establish centralized desktop UI scale tokens so typography, spacing, controls and slot icons become consistently larger.
- Make the three shell columns visually balanced and keep their panel bottoms aligned.
- Make the Grind center a compact map-plus-vertical-inventory workspace.
- Establish a reusable item-slot/icon proportion that applies to inventory, equipment, vendor/NPC stock and future item-slot surfaces.
- Reserve a stable status area below HP/SP in Character summary.
- Keep the layout deterministic at desktop widths and compatible with the existing responsive collapse below desktop.

**Non-Goals:**
- No browser-level zoom manipulation, accessibility zoom hacks, or screenshot/background recreation.
- No gameplay, API, inventory semantics, equipment rules or tooltip-content changes.
- No change to the number of inventory slots or their authoritative ordering.
- No new status-effect gameplay implementation; only reserve presentation space.
- No mobile redesign beyond preserving existing breakpoints and avoiding desktop CSS leaking into mobile layouts.

## Decisions

### 1. Application-level scale tokens

Introduce a small set of shared CSS custom properties for the desktop UI scale (base font, panel padding, control height, slot icon ratio, gaps and heading scale). Prefer tokenized dimensions over multiplying every existing declaration independently.

**Why:** A single scale contract prevents the current problem where text, icons and controls drift apart. It also makes future visual tuning one-token work.

**Alternative rejected:** Applying `zoom: 1.7` to the application. Browser CSS zoom is inconsistent for layout/overlays and would make responsive behavior and fixed-position UI harder to reason about.

### 2. Rebalanced fixed desktop grid

At the primary desktop breakpoint, use a three-column grid with wider side columns and a reduced center column. The shell content row uses a fixed viewport-relative height derived from the top bar and bottom breathing room, with `align-items: stretch` so all three zones terminate on the same baseline.

The exact column widths should be expressed with stable min/max values rather than a hardcoded 170% scale. The center must retain enough width for a 4:3 map plus the five-column inventory.

**Why:** The requested result is proportional redistribution, not simply enlarging every panel until the center overflows.

**Alternative rejected:** Keeping the existing wide center and only increasing fonts. That would preserve the excessive empty center and cannot fit the requested side-by-side inventory.

### 3. Grind center as map + inventory workspace

The Grind content becomes a two-column internal layout: a 4:3 map area on the left and a vertical 5×10 inventory on the right. The map is allowed to shrink within the center but must preserve its 4:3 ratio. The inventory has exactly 50 visible cells, five columns by ten rows, with no separate lower inventory section.

The battle/map context remains above/around this workspace according to the existing Grind component contract; no gameplay state is moved to the server.

**Why:** This directly uses the central width that is currently empty while keeping the map visually dominant.

**Alternative rejected:** A 10×5 inventory below the map, because it recreates the current low-density horizontal composition and consumes the vertical budget.

### 4. Shared item-slot visual contract

Create/centralize a reusable visual rule for item-bearing slots: the item icon should occupy most of the usable slot area while preserving a small inset for borders and a readable bottom-right stack/count overlay where applicable. The same rule applies to inventory, Character equipment and NPC/vendor stock, and is designed so future craft/storage/mail item slots can reuse it.

The underlying item component/data contract is unchanged; this is a presentation rule.

**Why:** The user explicitly wants the same item-to-slot proportion everywhere, eliminating repeated tooltip/icon-size fixes in separate panels.

**Alternative rejected:** Per-panel icon sizes, which would continue to create visual inconsistency and duplicated fixes.

### 5. Character summary paper-doll arrangement

The quick Character panel keeps the portrait centered, with equipment slots arranged in left and right columns around it. HP/SP remain above the equipment area. A dedicated status region is reserved below SP/equipment as appropriate for the existing panel flow, with enough height for future buff/debuff icons but no new status mechanics.

**Why:** This matches the supplied Character reference and prevents future status UI from forcing another structural redesign.

**Alternative rejected:** Extending the current 4-column equipment row, which does not create the requested paper-doll silhouette or future status space.

### 6. Fixed panel height

The shell's three desktop zones share the same explicit height. The height is calculated from the viewport/top bar and clamped to a safe minimum so panels extend almost to the bottom without depending on their content height. Internal sections can overflow/scroll only where already semantically necessary; the outer panel itself does not grow or shrink based on content.

**Why:** The requested alignment is a shell-level invariant and must not vary between Town, Grind, Character or Gambit content.

**Alternative rejected:** `min-height` only, because content-dependent heights would still make the panel bottoms drift between screens.

## Risks / Trade-offs

- [Risk] The larger scale may make some dense screens overflow at intermediate desktop widths. → Mitigation: keep the existing 1200/900 breakpoints, use min/max column constraints, and explicitly test the primary 1918×964 viewport plus narrower desktop widths.
- [Risk] Shared slot sizing may affect existing drag previews or tooltip positioning. → Mitigation: preserve the current tooltip/drag contracts and test inventory, equipment and vendor stock separately.
- [Risk] A fixed shell height can expose internal overflow on content-heavy Character/Gambit screens. → Mitigation: constrain the outer shell and allow only the relevant inner content region to scroll/collapse; do not let the three-zone frame resize.
- [Risk] Desktop scale changes can accidentally leak into mobile layouts. → Mitigation: scope desktop scale/layout rules to the desktop breakpoint and retain explicit mobile overrides.
