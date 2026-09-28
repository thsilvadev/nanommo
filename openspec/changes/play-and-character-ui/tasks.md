# Tasks

Reference: specs/play-and-character-ui/spec.md.

## 1. Frontend foundation and routing

- [x] 1.1 Replace the prototype PlayComponent with the shared PlayShell architecture.
- [x] 1.2 Add authenticated routes for /play/grind, /play/character, and /play/gambits.
- [x] 1.3 Make /play resolve to the appropriate gameplay context from authoritative character state.
- [x] 1.4 Add shared visual tokens, panel/tab/progress primitives, focus styles, and reduced-motion rules.
- [x] 1.5 Reuse existing semantic SVG assets without adding an icon/UI framework.

## 2. Authoritative state and realtime synchronization

- [x] 2.1 Add CharacterStore with REST bootstrap and readonly signal/computed state.
- [x] 2.2 Add InventoryStore for authoritative inventory/equipment presentation.
- [x] 2.3 Add BattleStore for live unresolved queue and synchronization state.
- [x] 2.4 Add the /game Socket.IO client service using the existing JWT handshake contract.
- [x] 2.5 Resync character and queue state on initial connection and every reconnect.
- [x] 2.6 Handle battle:queueUpdated, battle:resolved, character:leveledUp, and character:died.
- [x] 2.7 Ensure disconnect/reconnect and event loss never trigger local battle resolution.

## 3. /play shell and grind

- [x] 3.1 Implement top HUD with character identity/XP, Tournament/Grind/Trade tabs, resources, and utility actions.
- [x] 3.2 Implement CharacterSummary and PaperDoll with eight equipment slots, HP/SP, status, and compact stats.
- [x] 3.3 Implement MapBoard and MapTile with selected/locked/hover/focus states and no live combat simulation.
- [x] 3.4 Implement BattleProgressBar from server startAt/endAt timestamps only.
- [x] 3.5 Implement GrindInfo with current monster, HP, consumables, XP, timer, and battle state.
- [x] 3.6 Implement exactly 50 inventory cells on the main grind screen.
- [ ] 3.7 Implement seven weapon proficiency rows and compact progression states.
- [ ] 3.8 Implement loading, empty, searching, active, reconnecting, dead/town-bound, and error states.
- [x] 3.9 Add the collapsible Chat drawer integration point without coupling battle resolution to chat.

## 4. Character, equipment, and Gambits

- [x] 4.1 Implement CharacterPage and shared Character/Gambits/Equipment tab navigation.
- [x] 4.2 Implement AttributeAllocator pending +/- preview, Reset, Apply, zero-point, success, and rejection states.
- [ ] 4.3 Implement DerivedStats, StatusEffects, BuildSummary, and character inventory presentation from store state.
- [x] 4.4 Implement EquipmentTab with all eight slots and CDK drag/drop.
- [x] 4.5 Implement server-rejection recovery for equipment mutations.
- [x] 4.6 Implement the three-page Gambit editor with catalog-driven controls and up to 20 rows per page.
- [ ] 4.7 Implement CDK row reorder, enabled/disabled states, unavailable actions, and field-level validation display.
- [x] 4.8 Wire /play/gambits to the same Gambit editor with the Gambits tab selected.

## 5. Verification and polish

- [ ] 5.1 Add component tests for route/deep-link behavior and authoritative state transitions.
- [ ] 5.2 Add battle progress tests using mocked clocks and server startAt/endAt values.
- [ ] 5.3 Verify 50 inventory cells, 8 equipment slots, and 7 proficiency rows.
- [ ] 5.4 Verify keyboard focus, disabled states, tooltips, and prefers-reduced-motion behavior.
- [ ] 5.5 Verify desktop, tablet, and mobile layouts against PLAY_WINDOW_SPEC.md.
- [ ] 5.6 Run frontend tests and production Angular build; fix regressions without changing backend contracts.
