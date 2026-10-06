# Proposal

## Why
The next UI pass targets the three Character sub-tabs: Character, Gambits, and Mastery. The previous `play-ui-scale-layout` work established the correct desktop strategy on Grind: enlarged readability must be native at 100% browser zoom, outer panels share one shell baseline, reusable Inventory/item UI should be reused, and desktop rules must not leak into mobile.

This change applies those lessons deliberately to Character. It is a presentation/layout change: inventory/equipment actions remain live and server-authoritative while the surrounding Character information gets the requested space and typography.

## What Changes

### 1. Character sub-tab
- Add the existing reusable `inventory-grid` to the left of Attributes.
- Reuse the same Inventory component/data/interaction contract used by Grind; do not create a Character-only inventory.
- Preserve equip/unequip, consumable use where currently allowed, stack display, item tooltips, drag/drop and double-click fallbacks.
- Attributes content/behavior remains unchanged.
- Stats changes from two columns to one vertical column.
- Inventory, Attributes and Stats share the same bottom baseline as the side panels.
- Double the displayed text size in Attributes and Stats.

### 2. Gambits sub-tab
- Double all Gambit-screen text except the character name in `sheet-header`; `sheet-level` is included in the enlarged scale.
- Align `gambit-editor` to the same bottom baseline as side panels.
- Remove the textual `ACTIVE` indicator; selected page tab gets a solid green 8px border.
- Put `+ Add line`, `Save Page`, and `Activate` inside `div.page-meta`.
- At the enlarged scale, condition + parameter must stay on one line, and action + parameter must stay on one line.
- `node-block` and `gambit-line` must keep the same intended row footprint instead of growing unpredictably from wrapping.
- Preserve all existing Gambit save/activate/validation behavior.

### 3. Mastery sub-tab
- Double all Mastery text.
- Align Mastery and Weapons panels to the same bottom baseline as the side panels.
- Preserve the existing seven weapon proficiency rows and read-only/server-authoritative model. No weapon XP/progression is added.

## Non-Goals
- No backend/API/gameplay rule changes.
- No changes to attribute/derived-stat formulas, equipment rules, inventory capacity, consumable rules, Gambit validation or Mastery data.
- No browser `zoom`, transform-based fake scaling, new UI framework or icon dependency.
- No mobile redesign; preserve the existing responsive composition.
- No tooltip architecture rewrite. Preserve the current document-level floating tooltip implementation; do not reintroduce MutationObserver.

## Implementation Boundary
Expected areas: `apps/frontend/src/app/features/character/*`, `apps/frontend/src/app/features/gambit-editor/*`, `apps/frontend/src/app/features/play/inventory-grid.*`, relevant page styles/templates, and shared styles only for genuinely reusable rules.

Before editing, inspect the live DOM/classes. In particular verify `sheet-header`, `sheet-level`, `page-meta`, `node-block`, `gambit-line`, page-tab and panel classes rather than trusting older diagrams.

## Lessons Carried Forward from Grind
1. Never use browser zoom; make scale native through CSS sizing/tokens.
2. Never attach MutationObservers to every tooltip; a previous implementation caused severe Firefox UI/CPU freezes.
3. Reuse Inventory/item/tooltip presentation; tooltip content is centralized in `CatalogService.itemTooltipLines()`.
4. Fixed outer height is a shell invariant; content must not make panel bottoms drift.
5. Let grids absorb reduced width; Stats becomes one column and Gambit rows reserve enough width for labels + parameters.
6. Scope desktop rules deliberately so mobile does not inherit desktop scaling.
7. Build success is not enough: larger text/slots can expose drag/drop, tooltip and overflow regressions.
8. Do not change gameplay rules while fixing UI. The two-handed/off-hand equipment invariant must continue to work through the Character inventory/equipment UI.

## Acceptance Criteria

### Character
- [ ] Inventory is left of Attributes; Attributes is middle; Stats is right.
- [ ] All three central panels share the shell bottom baseline.
- [ ] Attributes behavior/content is unchanged apart from typography.
- [ ] Stats is one column.
- [ ] Attributes/Stats text is visibly 2× the previous Character-page scale.
- [ ] Inventory uses the existing reusable implementation and interactions.

### Gambits
- [ ] All Gambit text is 2× except the sheet-header character name; sheet-level is enlarged.
- [ ] Gambit editor bottom aligns with side panels.
- [ ] Selected page tab has a solid green 8px border and no ACTIVE text.
- [ ] Add line, Save Page and Activate are inside page-meta.
- [ ] Condition + parameter and action + parameter each remain on one line.
- [ ] node-block and gambit-line rows have a consistent footprint without accidental wrapping.
- [ ] Existing save/activate/validation behavior is unchanged.

### Mastery
- [ ] All Mastery text is 2×.
- [ ] Mastery and Weapons panels share the shell bottom baseline.
- [ ] Existing proficiency data remains unchanged/read-only.

### Regression
- [ ] Frontend build passes.
- [ ] git diff --check passes.
- [ ] Strict OpenSpec validation passes.
- [ ] Browser smoke at 100% zoom verifies all three tabs at the target desktop viewport.
- [ ] Narrow/mobile smoke shows no horizontal overflow regression.
- [ ] Inventory drag/drop, double-click equipment, consumable use, tooltips and two-handed/off-hand swaps remain functional where applicable.
- [ ] No MutationObserver tooltip code is introduced.
- [ ] No production deployment.

## Documentation
This change introduces no gameplay contract, so `SPEC.md` should remain unchanged unless implementation discovers a genuine gameplay/API mismatch. Visual layout belongs in `PLAY_WINDOW_SPEC.md` and this OpenSpec change. Update STATUS with outcome; update ARCHITECTURE only for durable technical lessons.
