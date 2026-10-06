# Tasks

## 1. Reconnaissance
- [ ] 1.1 Read STATUS, SPEC, PLAY_WINDOW_SPEC, ARCHITECTURE and this change before editing.
- [ ] 1.2 Inspect live Character/Gambits/Mastery templates and CSS; identify exact classes for sheet header, tabs, panels, Inventory insertion, Stats grid, Gambit nodes/lines and page-meta.
- [ ] 1.3 Record current desktop font sizes and relevant grid/flex dimensions.

## 2. Character
- [ ] 2.1 Insert existing reusable inventory-grid to the left of Attributes.
- [ ] 2.2 Preserve Inventory rendering, tooltip, stack, drag/drop, double-click and consumable interactions.
- [ ] 2.3 Rebalance desktop columns so Inventory + Attributes + Stats fit without overflow.
- [ ] 2.4 Change Stats to one column.
- [ ] 2.5 Double Attributes/Stats typography.
- [ ] 2.6 Align Inventory, Attributes and Stats to the shell bottom baseline.
- [ ] 2.7 Verify two-handed/off-hand equipment swaps through the reused Character inventory/equipment flow.

## 3. Gambits
- [ ] 3.1 Double Gambit typography except sheet-header character name; double sheet-level.
- [ ] 3.2 Remove textual ACTIVE.
- [ ] 3.3 Add solid green 8px border to selected page tab.
- [ ] 3.4 Move Add line, Save Page and Activate into page-meta.
- [ ] 3.5 Align gambit-editor bottom with side panels.
- [ ] 3.6 Keep condition + parameter on one line.
- [ ] 3.7 Keep action + parameter on one line.
- [ ] 3.8 Keep node-block and gambit-line row footprints consistent.
- [ ] 3.9 Verify save/activate/reorder/edit/validation behavior unchanged.

## 4. Mastery
- [ ] 4.1 Double Mastery typography.
- [ ] 4.2 Align Mastery and Weapons panels to shell bottom.
- [ ] 4.3 Verify seven proficiency rows/read-only behavior unchanged.

## 5. Shared safety
- [ ] 5.1 Scope desktop rules to intended breakpoint; preserve mobile.
- [ ] 5.2 Reuse current tooltip implementation; no MutationObserver.
- [ ] 5.3 Reuse shared CSS/components instead of panel-specific item implementations.

## 6. Verification
- [ ] 6.1 git diff --check.
- [ ] 6.2 pnpm --filter @nanommo/frontend build.
- [ ] 6.3 pnpm exec openspec validate character-ui-scale-layout --strict.
- [ ] 6.4 Browser smoke at 100% for Character/Gambits/Mastery.
- [ ] 6.5 Narrow/mobile overflow smoke.
- [ ] 6.6 Interaction smoke: equip/unequip, consumables, tooltips, two-handed/off-hand swaps.
- [ ] 6.7 Update STATUS; update PLAY_WINDOW_SPEC if implementation changes its visual contract.
- [ ] 6.8 Do not modify SPEC unless a genuine gameplay/API rule needs documenting.

## 7. Cleanup
- [ ] 7.1 Remove temporary browser smoke files/scripts not intended for commit.
- [ ] 7.2 Confirm no unrelated backend/gameplay changes.
- [ ] 7.3 No production deployment.
