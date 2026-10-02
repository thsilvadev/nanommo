# Tasks

## Shared infrastructure
- [x] 1. Keep the global viewport meta desktop-safe (no `viewport-fit=cover`) and apply safe-area handling only inside the mobile shell.
- [x] 2. Add ViewportService with isMobile, isTouch, canDrag, isLandscape, and reducedMotion signals.
- [x] 3. Add TickerService with one shared 250ms signal, migrate only CharacterSummary battleDisplayTimer, InventoryGrid timer, BattleProgress timer, and GrindInfo timer, and pause the ticker while `document.hidden`.
- [x] 4. Add GameFormatService for shared item/event/food/tier formatting used by mobile surfaces without changing desktop gameplay semantics.
- [x] 5. Add UiPrefsStore with independent grind/town detent localStorage keys and defaults.

## Shared UI extraction and touch gates
- [x] 6. Extract one TradeModalComponent and one AccountDeleteModalComponent and preserve their authoritative flows; make TradeModal bottom-anchored only below 900px while AccountDelete remains centered.
- [x] 7. Gate inventory/equipment/vendor/Gambit CDK drag-drop with `canDrag()`; keep desktop handlers intact.
- [x] 8. Remove mobile dependence on InventoryGrid double-click by using single-tap ActionSheet actions; desktop double-click remains available in desktop components.
- [x] 9. Keep ActionSheetComponent separate from TradeModal; use it for item actions/details, with Vender leading to the existing TradeModal confirmation.

## Routing and shell
- [x] 10. Add the exact mobile routes `/play/m/battle`, `/play/m/map`, `/play/m/items`, `/play/m/gambits`, and `/play/m/character`.
- [x] 11. Preserve desktop `/play/grind`, `/play/character`, and `/play/gambits`; redirect `/play/m/*` to the equivalent desktop route at viewport >=900px.
- [x] 12. Make PlayComponent choose the mobile shell only when the route is a mobile route (or mobile /play/grind alias) and the viewport is <900px.
- [x] 13. Keep the mobile shell with fixed header/body/bottom-nav structure and safe-area insets without changing the desktop shell DOM path.
- [x] 14. Keep five mobile bottom-nav items: Battle, Map, Items, Gambit, Char, with route-aware active state.

## Character and contextual sheet
- [x] 15. Keep MobileCharPanelComponent behind the sheet with identity, portrait, HP/SP, food/diet, status, and equipment; at 10% sheet coverage leaves the equipment region visible.
- [x] 16. Keep SheetPanelComponent at 10/50/90%, 88px minimum, handle-only Pointer Events, nearest-detent snap, tap cycling, context persistence, and Town/Grind content.
- [x] 17. Reuse the existing VendorPanel in Town; mobile vendor stock opens the shared TradeModal on tap, while the Town peek exposes the Map CTA.
- [x] 18. Add BattleLogComponent with all elapsed active-battle events, ascending tick order, scroll preservation, and a new-lines affordance.

## Mobile tabs and touch actions
- [x] 19. Add the Items tab with 4x2 equipment and 5x10 inventory, single-tap ActionSheet actions, and no mobile drag.
- [x] 20. Add mobile Gambit controls: 44px-class switch target, tap-to-toggle/greyed rows, ▲/▼ priority movement with renormalization, and numeric input sizing with `inputmode="numeric"`; keep desktop CDK reorder.
- [x] 21. Keep Character mobile as Attributes/Mastery without equipment in the Character page; enlarge allocator controls for touch.
- [x] 22. Keep mobile menu/settings with Chat, Configurações, Sair da conta, persisted music volume, and the single shared account deletion modal.

## Validation and cleanup
- [ ] 23. Browser smoke was intentionally skipped by request.
- [x] 24. Run frontend/shared/API builds, OpenSpec strict validation, and `git diff --check`; update STATUS.md with implementation notes, verification, limitations, and traps.
