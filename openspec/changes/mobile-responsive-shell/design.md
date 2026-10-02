# Design

## Context

The current PlayComponent owns a desktop three-zone shell and hides both side zones below 900px. Existing CharacterStore, InventoryStore, BattleStore, VendorStore, GameSocketService, LoginMusicService, and GambitEditorComponent already provide the authoritative state and interactions required by the mobile shell. See proposal.md and the mobile-responsive-shell spec delta for the behavioral contract.

## Goals / Non-Goals

**Goals:**
- Add a parallel Angular mobile shell without changing the desktop DOM path at 900px and above.
- Centralize viewport/touch/reduced-motion decisions and replace duplicated 250ms timers with one ticker.
- Reuse existing formatting and authoritative stores rather than creating mobile-specific gameplay logic.
- Make the mobile sheet measurable in pixels from the actual body height so detents remain stable across browser chrome changes.

**Non-Goals:**
- No backend/API/database changes.
- No new combat simulation or client-side outcome calculation.
- No landscape optimization, PWA, real chat, or aggregated battle history.
- No visual redesign of the existing desktop shell.

## Decisions

### 1. Route + viewport shell branch
PlayComponent SHALL render MobileShellComponent only when the current route is a mobile route under `/play/m/*` (or the mobile `/play/grind` alias) AND `ViewportService.isMobile()` is true. Desktop routes `/play/grind`, `/play/character`, and `/play/gambits` retain the desktop DOM path. A route-prefix-only or viewport-only branch was rejected because `/play/gambits` must not collide with the mobile Gambit surface.

### 2. Pixel-based sheet height
SheetPanelComponent SHALL measure .nm-body with ResizeObserver and write a pixel height directly. The three detents are resolved from body height and clamped to a minimum of 88px. Percentage-only CSS was rejected because nested browser viewport changes and the required minimum make percentage heights inconsistent.

### 3. Pointer Events only on the handle
Only the 32px handle region captures pointer events and disables its transition while dragging. Sheet content keeps pan-y scrolling. This avoids nested-scroll heuristics and keeps drag intent deterministic. Gesture detection on the whole sheet was rejected because it competes with log and form scrolling.

### 4. Single touch capability gate
ViewportService.canDrag() is the sole gate for CDK drag/drop. Existing desktop handlers remain available, but mobile disables cdkDrag/cdkDropList and uses explicit tap actions. Width-based checks inside individual components were rejected because a coarse pointer can exist at a wide viewport and vice versa.

### 5. Shared presentation services
GameFormatService delegates existing item/event/food formatting methods without forcing templates to change. TickerService exposes a shared 250ms signal. UiPrefsStore owns only detent persistence. ViewportService owns media-query signals. This reduces duplicated timers and ad-hoc browser checks while preserving existing component APIs.

### 6. Mobile routes under a dedicated prefix
The five mobile tabs SHALL use exact routes `/play/m/battle`, `/play/m/map`, `/play/m/items`, `/play/m/gambits`, and `/play/m/character`. `/play/grind` remains the desktop Grind route and is the mobile Battle alias below 900px. A mobile route guard SHALL redirect `/play/m/*` to the equivalent desktop route at viewport >=900px, avoiding collision with `/play/gambits` and other desktop chrome.

### 7. Action sheet over tooltips/double-click
Mobile items use one tap to open ActionSheetComponent. The sheet renders details from the existing catalog formatting and calls the existing inventory/vendor store methods. Desktop double-click remains available only to desktop-capable components. A separate mobile item model was rejected to avoid diverging game rules.

### 8. Complete battle log in mobile
BattleLogComponent reads only the active BattleQueueEntry.log.events and elapsed tick derived from the server timestamps. It never synthesizes events. The log keeps its own scroll container and records whether the user is at the bottom before new data arrives.

### 9. Shared modals
TradeModalComponent and AccountDeleteModalComponent are single shared instances rendered by the Play shell. Trade remains a centered dialog on desktop and becomes a bottom-anchored rounded-top panel below 900px with `max-height:90dvh` and slide-up animation. AccountDelete remains centered at all sizes, with 16px confirmation input, 14px body copy, and 48px action buttons. Settings reuses the existing LoginMusicControlComponent rather than creating a second volume state.

### 10. No backend changes
All mobile actions use existing REST/socket contracts. This keeps the server-authoritative invariant intact and avoids introducing mobile-only endpoints that would later need reconciliation.

## Risks / Trade-offs

- [Risk] Mobile and desktop templates diverge. → Mitigation: share stores, formatting, trade/account modals, and route components; desktop DOM remains untouched.
- [Risk] Browser safe-area and dynamic viewport behavior differs across iOS/Android. → Mitigation: no global `viewport-fit=cover` so desktop/iPad landscape is not put under the safe area; mobile shell uses `env(safe-area-inset-*)` only where needed, `100dvh`, and body ResizeObserver.
- [Risk] A coarse pointer can be used at desktop width. → Mitigation: canDrag is pointer-capability based, while the shell branch is width based.
- [Risk] The active battle log can grow. → Mitigation: one battle at a time, 1 tick/sec, scrollable DOM without virtual scrolling as explicitly accepted by the plan.
- [Risk] Existing component timers may remain after extraction. → Mitigation: migrate only the four requested 250ms presentation timers to TickerService; keep the 1s network polling timers and LoginMusicService requestAnimationFrame unchanged. TickerService pauses while `document.hidden`.
- [Risk] The current vendor/trade modal is coupled to GrindInfo. → Mitigation: extract the modal before mobile Items/Town surfaces are wired.
- [Risk] Desktop regression from route changes. → Mitigation: retain the existing desktop Grind component and run the production build plus 1440px smoke/static checks.
## Migration Plan

1. Add the OpenSpec change artifacts and validate them strictly.
2. Add shared frontend services and standalone mobile components without touching backend code.
3. Extract shared modals and route the mobile shell.
4. Gate existing CDK drag/drop and double-click behavior by touch capability.
5. Build and run focused mobile/static checks, then production builds and git diff --check.
6. If a desktop regression is found, revert only the mobile branch/styles; no database or API rollback is necessary.
7. No production deployment is performed in this session.