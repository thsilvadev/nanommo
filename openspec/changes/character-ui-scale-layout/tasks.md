# Tasks

## 1. Reconnaissance
- [x] 1.1 Read STATUS, SPEC, PLAY_WINDOW_SPEC, ARCHITECTURE and this change before editing.
- [x] 1.2 Inspected live Character/Gambits/Mastery templates and CSS; identified sheet header, tabs, panel, InventoryGrid, Stats, Gambit nodes/lines and page-meta classes.
- [x] 1.3 Recorded current desktop font sizes and grid/flex dimensions.

## 2. Character
- [x] 2.1 Insert existing reusable inventory-grid to the left of Attributes.
- [x] 2.2 Preserve Inventory rendering, tooltip, stack, drag/drop, double-click and consumable interactions through the shared InventoryGrid.
- [x] 2.3 Rebalance desktop columns so Inventory + Attributes + Stats fit without overflow.
- [x] 2.4 Change Stats to one column.
- [x] 2.5 Double Attributes/Stats typography.
- [x] 2.6 Align Inventory, Attributes and Stats to the shell bottom baseline.
- [x] 2.7 Preserve the existing shared equipment drop targets/CharacterSummary equipment flow, including two-handed/off-hand server rules.

## 3. Gambits
- [x] 3.1 Double Gambit typography except sheet-header character name; double sheet-level.
- [x] 3.2 Remove textual ACTIVE.
- [x] 3.3 Add solid green 8px border to selected page tab.
- [x] 3.4 Move Add line, Save Page and Activate into page-meta.
- [x] 3.5 Align gambit-editor bottom with side panels.
- [x] 3.6 Keep condition + parameter on one line on desktop.
- [x] 3.7 Keep action + parameter on one line on desktop.
- [x] 3.8 Keep node-block and gambit-line row footprints consistent.
- [x] 3.9 Preserve save/activate/reorder/edit/validation behavior; only presentation structure changed.

## 4. Mastery
- [x] 4.1 Double Mastery typography.
- [x] 4.2 Align Mastery and Weapons panels to shell bottom.
- [x] 4.3 Preserve seven proficiency rows/read-only behavior.

## 5. Shared safety
- [x] 5.1 Scope desktop rules to intended breakpoint; preserve mobile.
- [x] 5.2 Reuse current tooltip implementation; no MutationObserver.
- [x] 5.3 Reuse shared CSS/components instead of panel-specific item implementations.

## 6. Verification
- [x] 6.1 git diff --check.
- [x] 6.2 pnpm --filter @nanommo/frontend build.
- [x] 6.3 pnpm exec openspec validate character-ui-scale-layout --strict.
- [ ] 6.4 Browser smoke at 100% for Character/Gambits/Mastery.
- [ ] 6.5 Narrow/mobile overflow smoke.
- [ ] 6.6 Interaction smoke: equip/unequip, consumables, tooltips, two-handed/off-hand swaps.
- [ ] 6.7 Update STATUS; update PLAY_WINDOW_SPEC if implementation changes its visual contract.
- [x] 6.8 SPEC unchanged; no gameplay/API rule changed.

## 7. Cleanup
- [ ] 7.1 Remove temporary browser smoke files/scripts not intended for commit.
- [x] 7.2 Confirm no unrelated backend/gameplay changes in the implementation.
- [x] 7.3 No production deployment.
