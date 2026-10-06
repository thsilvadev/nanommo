# Design

## 1. Baseline
Read `STATUS.md`, `SPEC.md`, `PLAY_WINDOW_SPEC.md`, `ARCHITECTURE.md`, the latest relevant OpenSpec change, and the live Character/Gambit/Mastery templates/CSS before editing. Record the current font sizes and grid/flex dimensions before applying “2×”.

## 2. Character composition
Target desktop:
```
┌──────────────┬────────────────────┬────────────────────┐
│   Inventory  │    Attributes      │       Stats        │
│    5 × 10    │                    │   ATK              │
│              │   existing rows    │   MATK             │
│              │   + controls       │   DEF              │
│              │                    │   MDEF             │
│              │                    │   ...              │
└──────────────┴────────────────────┴────────────────────┘
                 shared bottom baseline
```
Use the existing InventoryGrid. Prefer `minmax(0,...)` tracks so reduced width is absorbed without overflow. Stats is one column.

## 3. Gambit composition
Keep the semantic editor unchanged while doubling its presentation scale. The critical constraint is horizontal integrity:
```
Condition [parameter]        Action [parameter]
|--------- same row footprint / no wrapping ---------|
```
Use explicit grid/flex constraints and stable minimum widths. Do not shrink text to solve the requirement. Remove ACTIVE text; selected tab gets `border: 8px solid` using the project's success/green token. Keep action buttons semantically inside `div.page-meta`.

## 4. Mastery
Mastery and Weapons keep the same data surfaces. Only presentation changes: enlarged typography and bottom alignment.

## 5. Typography
“Double” means approximately 2× the current live CSS font sizes, not browser zoom or transform. Do not globally double headings/body in `styles.css`; scope changes to these screens. Exception: Gambit sheet-header character name stays current size; sheet-level doubles.

## 6. Tooltip/item UI
Keep the current document-level floating tooltip: pointer events, clone into `document.body`, viewport-aware placement, no MutationObserver. Character Inventory must reuse it and the centralized `CatalogService.itemTooltipLines()` content path.

## 7. Responsive boundary
Keep desktop layout rules inside the existing desktop breakpoint. Inspect selectors for leakage below desktop. Do not “fix” mobile by globally shrinking desktop rules.

## 8. Verification
Run: `git diff --check`; `pnpm --filter @nanommo/frontend build`; `pnpm exec openspec validate character-ui-scale-layout --strict`; browser smoke at 100% for Character/Gambits/Mastery; narrow/mobile overflow smoke; interaction smoke for equipment/consumables/tooltips/two-handed-off-hand swaps. If browser tooling is unavailable, record that limitation rather than claiming visual verification.

## 9. Known traps
- No MutationObserver tooltip tracking.
- No `zoom` or `transform: scale()`.
- No Character-only Inventory fork.
- Do not use `overflow:hidden` to hide Gambit wrapping.
- Do not let larger fonts create inconsistent Gambit row heights.
- Do not use absolute positioning when `page-meta` is a semantic requirement.
- Do not modify backend contracts merely because Character exposes more inventory interactions.
