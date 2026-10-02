# NanoMMO — Mobile UI/UX Architecture

**Purpose:** permanent reference for anyone implementing or modifying mobile UI/UX in NanoMMO.

**Scope:** authenticated Play experience below **900px**. Desktop is priority 1 and must remain behaviorally and structurally isolated from mobile work.

**Authoritative product references:** `SPEC.md`, `openspec/specs/SPEC.md`, `PLAY_WINDOW_SPEC.md`, and the active OpenSpec change for the feature being modified.

---

## 1. Core Principle: Mobile Is a Parallel UI Shell

Mobile is not a compressed desktop layout.

The desktop Play shell keeps its existing three-zone composition:

```
CharacterSummary | Router Outlet | GrindInfo
                  |
               Inventory
```

At mobile widths, a separate shell is rendered:

```
+-----------------------------+
| Fixed mobile header         |
+-----------------------------+
|                             |
| Character panel backdrop    |
|                             |
|        Mobile route         |
|                             |
|  Bottom sheet over backdrop |
+-----------------------------+
| Fixed five-item bottom nav  |
+-----------------------------+
```

The mobile shell reuses authoritative stores, API contracts, Socket.IO state, and selected existing components, but its presentation layer is intentionally different.

### Critical branching rule

Mobile rendering is decided by **both route prefix and viewport**.

Use the mobile shell when:

- viewport is below 900px, and
- current route is `/play/m/*`, or the compatibility route `/play/grind` being used as mobile Battle.

Do **not** decide mobile rendering from viewport alone.

This prevents the desktop route `/play/gambits` from accidentally becoming mobile Gambits just because the browser is narrow.

---

## 2. Route Contract

### Mobile routes

| Mobile tab | Route |
|---|---|
| Battle | `/play/m/battle` |
| Map | `/play/m/map` |
| Items | `/play/m/items` |
| Gambits | `/play/m/gambits` |
| Character | `/play/m/character` |

### Desktop routes

These remain desktop routes:

- `/play/grind`
- `/play/character`
- `/play/gambits`

### Compatibility behavior

`/play/grind`:

- mobile (<900px): Battle cockpit
- desktop (>=900px): existing Grind screen

When a `/play/m/*` route is opened at >=900px, redirect to its desktop equivalent.

Current mapping:

```
/play/m/battle    -> /play/grind
/play/m/map       -> /play/grind
/play/m/items     -> /play/grind
/play/m/gambits   -> /play/gambits
/play/m/character -> /play/character?tab=character
```

The mobile route guard handles direct navigation at desktop width, and PlayComponent also watches viewport changes so an already-open mobile route does not remain active after resizing to desktop.

### Why the prefix matters

Never create a mobile route such as `/play/gambits`.

That route already belongs to desktop Character/Gambits chrome.

---

## 3. Main Mobile Components

### `MobileShellComponent`

Responsible for:

- fixed mobile header
- HP/SP/XP micro-bars
- reconnecting indicator
- menu trigger
- fixed five-item bottom navigation
- mobile router outlet
- mobile Chat surface
- Settings surface

It must remain a presentation shell. It must not calculate gameplay outcomes.

### `MobileCharPanelComponent`

The character backdrop behind the sheet.

Contains authoritative:

- identity
- portrait
- level/status
- HP/SP
- hungry/fed state
- Diet
- Auto Feed
- equipment

The character panel is intentionally covered from the bottom as the sheet rises.

At the 10% sheet detent, equipment remains visible.

At higher detents, equipment, then diet/status, then HP/SP are progressively covered.

### `SheetPanelComponent`

Contextual bottom sheet for Battle or Town.

It overlays the character panel instead of replacing it.

### `MobileItemsComponent`

Dedicated mobile Items screen.

Layout:

- equipment: 4 × 2
- inventory: 5 × 10
- scrolling page
- no CDK drag/drop

### `GambitEditorComponent`

The existing Gambit editor is reused directly for `/play/m/gambits`.

Mobile-specific behavior is controlled by route detection and CSS; desktop Gambit behavior remains intact.

### `MapBoard`

The existing MapBoard is reused for `/play/m/map`.

Do not invent a separate map/gameplay system unless the product contract explicitly changes.

### `BattleLogComponent`

Displays all elapsed events from the active battle log.

It is a presentation component only.

---

## 4. Mobile Sheet Architecture

The mobile cockpit uses a Z-stack.

```
.nm-body
  ├── character panel   z-index: 1
  └── sheet             z-index: 2
```

The sheet is positioned at the bottom and covers the character backdrop upward.

### Detents

Exactly three:

- **peek:** approximately 10%
- **half:** approximately 50%
- **full:** approximately 90%

There is no 70% detent.

The sheet never becomes smaller than **88px**.

### Persistence

Two independent localStorage keys:

```
nanommo:sheet-detent-grind
nanommo:sheet-detent-town
```

Defaults:

- Grind: `half`
- Town: `full`

Changing one context must not change the other.

### Measurement

Sheet height is calculated from the actual `.nm-body` height.

`ResizeObserver` feeds the measured body height into a signal.

The resolved height is written in pixels:

```
max(88px, bodyHeight * detentRatio)
```

This is deliberate. Do not replace it with a percentage-only sheet height.

### Gestures

Only the **handle** starts sheet dragging.

Handle:

- Pointer Events
- `setPointerCapture()`
- `touch-action: none`

Sheet content:

- normal vertical scrolling
- `touch-action: pan-y`
- `overscroll-behavior: contain`

During drag:

- disable height transition
- update sheet height directly

On release:

- snap to the nearest detent in pixels

A handle tap without movement cycles:

```
10% -> 50% -> 90% -> 10%
```

Respect `prefers-reduced-motion`.

---

## 5. Battle Sheet

### Grind context

The sheet reads existing authoritative `BattleQueueEntry` state.

Conceptually:

**10%**

- monster name
- monster HP summary
- battle number
- elapsed
- queue size
- compact session counters

**50%**

- monster header
- battle number/time
- monster HP
- status effects
- derived stats
- XP/gold reward
- queued battle count

**90%**

- 50% content
- complete battle event log

Do not invent combat events client-side.

### Battle log

Source:

```
entry.log.events
```

Only show events whose tick has elapsed relative to the active entry.

Order:

- ascending tick order

Scrolling:

- own scroll container
- `overscroll-behavior: contain`

Auto-follow rule:

- if user is already at the bottom, follow new events
- if user has scrolled away, do not steal scroll position
- show a “new lines” affordance instead

No virtual scrolling is necessary: one battle progresses at roughly one tick per second.

The current battle log intentionally replaces the previous “last four events” presentation.

Historical aggregate battle logs are a future concern, not part of this shell.

---

## 6. Town Sheet

Town state is determined from authoritative Character state:

```
status === 'town'
OR
currentMapId is absent
```

The Town sheet reuses the existing **VendorPanel**.

### Town detents

**10%**

- “In Town”
- “Escolher mapa” CTA

**50% / 90%**

- selected NPC
- NPC type
- greeting
- Vendor stock or Quest dialogue as applicable

Do not put the inventory into the Town sheet.

### Vendor behavior

On touch:

- tapping vendor stock directly opens the existing authoritative buy flow
- the quantity/confirmation UI is `TradeModalComponent`

Vendor interactions must continue using the existing server/store contract.

---

## 7. Items and Touch Interaction

### One tap, never double tap

Touch interaction is:

```
item -> ActionSheetComponent
```

Do not rely on hover tooltips or `dblclick` for mobile.

Desktop double-click behavior may remain where it already exists.

### ActionSheetComponent

The ActionSheet is a distinct component.

It is **not** the TradeModal.

Its responsibilities:

- identify selected item
- show item details
- offer contextual actions
- close

Buttons are large, spaced and touch-friendly.

Typical actions:

- Equipar
- Substituir <current>
- Desequipar
- Usar
- Vender
- Detalhes
- Fechar

### Sale flow

The sale flow is deliberately two-stage:

```
Items tap
  -> ActionSheet
  -> Vender
  -> TradeModal
  -> quantity
  -> confirm
  -> authoritative server request
```

Do not collapse these into one generic modal.

---

## 8. TradeModal Architecture

There is exactly **one** shared TradeModal component.

It is rendered by the Play shell and uses the existing `VendorStore`.

### Desktop

Keep dialog behavior:

- centered
- bounded width
- existing visual language

### Mobile (<900px)

Change presentation only:

- anchored to bottom
- rounded top corners
- `max-height: 90dvh`
- slide-up animation
- safe-area bottom padding

Mobile sizing requirements:

- title label: 11px
- title label tracking: 1.5px
- summary labels: 13px
- summary values: 14px
- note/error: 12px
- buttons: minimum 48px
- action gap: 8px
- numeric input: 16px
- `inputmode="numeric"`

The underlying transaction semantics remain unchanged.

---

## 9. AccountDeleteModal Architecture

There is exactly **one** shared AccountDeleteModal component.

It must stay a centered modal on both desktop and mobile.

Do not convert account deletion into a bottom sheet.

Reason: it is destructive and intentionally demands attention.

Mobile sizing:

- confirmation input: 16px
- body text: 14px
- buttons: minimum 48px
- readable tracking; avoid excessive letter spacing on tiny text

The confirmation flow remains server-authoritative.

---

## 10. Gambit Mobile Interaction

The mobile Gambit editor still uses the existing Gambit model and server validation.

### Editing

Touching a Gambit row does not mean “edit”.

Inputs and selects are edited directly.

### Tap row

A tap on the row itself can toggle enabled state.

Disabled rows become visually greyed.

The click handler must ignore taps originating inside:

```
input
select
button
label
```

Otherwise touching an input would accidentally toggle the whole Gambit.

### Priority

Use explicit buttons:

```
▲
▼
```

Movement reuses `moveItemInArray` and then renormalizes:

```
priority = arrayIndex + 1
```

Do not implement a second priority algorithm.

### Drag

Desktop CDK reorder remains.

Mobile CDK reorder is disabled.

### Touch sizing

Enable switch target:

- at least 44px class target
- approximately 44 × 24px visual/tap area

Numeric Gambit inputs:

- minimum 16px font size on focus-capable numeric fields
- `inputmode="numeric"`

---

## 11. CDK Drag/Drop Policy

There is one shared capability gate:

```
ViewportService.canDrag()
```

Its meaning:

```
canDrag = !isTouch
```

Use it consistently.

### Required bindings

For drag sources:

```
[cdkDragDisabled]="!canDrag()"
```

For drop lists:

```
[cdkDropListDisabled]="!canDrag()"
```

Applies to:

1. CharacterSummary
2. InventoryGrid
3. VendorPanel
4. GambitEditor

Do not write independent `window.innerWidth` checks inside these components.

The gate is pointer-capability based, not width based.

A coarse pointer may exist at a wide viewport, and that still means drag should be disabled.

Existing desktop handlers remain in place.

---

## 12. Ticker Architecture

The Play UI has one shared presentation ticker:

### `TickerService`

One 250ms interval exposes a signal:

```
now
```

The four requested consumers are:

1. CharacterSummary — `battleDisplayTimer`
2. InventoryGrid — `timer`
3. BattleProgress — `timer`
4. GrindInfo — `timer`

These are presentation clocks.

### Visibility optimization

When:

```
document.hidden === true
```

TickerService stops its interval.

On `visibilitychange` back to visible:

- refresh time immediately
- resume the 250ms interval

This is important because NanoMMO may remain open for hours on an idle game tab.

### Do not migrate these

Keep these independent:

- CharacterSummary `townTimer` — 1s network polling
- MapBoard `townPoll` — 1s network polling
- LoginMusicService `requestAnimationFrame`

Those timers have different responsibilities and changing their cadence would change network behavior or music behavior.

---

## 13. Safe-Area and Viewport Rules

### Global viewport meta

Do **not** reintroduce:

```
viewport-fit=cover
```

globally.

Current rule:

```
<meta name="viewport" content="width=device-width, initial-scale=1">
```

Safe-area handling is localized to mobile shell surfaces.

### Why

The desktop experience is priority 1.

A global `viewport-fit=cover` policy can cause desktop/iPad landscape content to interact badly with device cutouts.

Use `env(safe-area-inset-*)` where the mobile shell actually needs it.

### Height

Mobile shell:

```
height: 100dvh
```

Fallback:

```
@supports not (height: 100dvh) {
  ...
}
```

The shell also uses the measured body height for the sheet.

### Overflow

The mobile shell is designed to avoid page-level rubber-band scrolling.

Internal scrollers should use:

```
overscroll-behavior: contain
```

The sheet and character panel are internal scrolling surfaces.

---

## 14. Mobile Character Page

Route:

```
/play/m/character
```

The mobile Character page is not the full desktop Character page.

Mobile exposes:

- Attributes
- Mastery

Equipment stays out of this route.

Equipment remains visible in:

- the mobile cockpit character backdrop
- the mobile Items tab

Allocator buttons should meet touch-size expectations.

Do not introduce weapon XP/progression systems as part of mobile UI work. Mobile Mastery only presents the already-authoritative progression data available to the existing contract.

---

## 15. Header and Bottom Navigation

### Header

Two compact rows.

**Row 1**

- avatar
- character name
- level
- gold
- menu button

**Row 2**

- HP micro-bar
- SP micro-bar
- XP bar

Also show a reconnecting indicator when:

```
battle.state() === 'reconnecting'
```

The reconnect banner is informational only.

### Bottom nav

Exactly five items:

```
Battle | Map | Items | Gambit | Char
```

Requirements:

- fixed bottom position inside the shell
- safe-area bottom padding
- minimum touch target around 44px
- accessible active/current-state indication

The selected tab must be derived from the real route, not a separate navigation state.

---

## 16. Settings, Chat and Logout

### Menu

The mobile menu contains:

- Chat
- Configurações
- Sair da conta

### Chat

Keep the existing chat mock.

Do not turn mobile UI work into a realtime chat implementation.

### Settings

Reuse the existing music control and persisted volume state.

Do not create a second volume store.

### Account deletion

Settings opens the shared AccountDeleteModal.

The modal remains centered.

Logout should use the existing AuthStore flow, not merely navigate visually to `/login`.

---

## 17. Server Authority Boundary

Mobile UI must not become a second game engine.

### Client may

- render server state
- animate from timestamps
- show elapsed battle events
- request actions
- optimistically adjust presentation only where existing contracts already permit it
- navigate

### Client must not

- calculate battle outcomes
- generate loot
- decide XP
- authoritatively alter HP/SP
- decide Diet progression
- decide Auto Feed timing
- invent combat events
- bypass server validation
- add mobile-only gameplay endpoints

Use the existing:

- CharacterStore
- InventoryStore
- BattleStore
- VendorStore
- GameSocketService
- ApiService

as the integration boundary.

---

## 18. Character / Inventory Realtime Synchronization

This mobile layer sits on top of an important existing synchronization model.

### Authoritative stores

Character and Inventory stores represent persisted server state.

The server uses a monotonic Character `stateVersion`.

Realtime resolution can publish:

- Character snapshot
- Inventory snapshot
- state revision

### Active battle presentation

During an actually active encounter, CharacterSummary may show a temporary HP/SP projection based on the immutable queued battle log and timestamps.

That projection is:

- read-only
- presentation-only
- never written back into CharacterStore

Inventory quantities do not use battle-log projection.

### Important consequence

Do not “fix” a mobile stale-state issue by adding local gameplay state.

Investigate:

- authoritative revision
- realtime generation
- HTTP response ordering
- active-battle presentation projection

before changing state ownership.

---

## 19. Diet UI Boundary

Diet is authoritative server state.

Mobile can present:

- food slots
- Diet stars
- digestion countdown
- hungry/fed
- Auto Feed state

Do not implement Diet progression in mobile UI.

Food stat scaling remains the existing shared/server formula:

```
effectiveFoodStatValue(catalogValue, dietLevel)
```

The mobile UI should display the authoritative result, not reproduce the gameplay calculation as a second source of truth.

---

## 20. Desktop Safety Rules

Desktop is priority 1.

Before modifying any shared UI component, ask:

1. Does this change affect the desktop DOM?
2. Does it change an existing desktop route?
3. Does it change desktop drag behavior?
4. Does it alter a desktop timer or polling cadence?
5. Does it change an existing store contract?

Prefer:

- mobile-only components
- route-aware presentation
- mobile-only CSS
- shared components with narrowly scoped responsive rules

Avoid:

- replacing desktop templates with mobile templates
- changing desktop route semantics
- changing server contracts to solve presentation problems
- duplicating authoritative business logic

The safest mobile change is the smallest change that leaves desktop rendering untouched.

---

## 21. Common Regression Traps

### Trap 1 — Route collision

Wrong:

```
/play/gambits
```

for mobile.

Correct:

```
/play/m/gambits
```

### Trap 2 — Viewport-only branching

Wrong:

```
if (isMobile) ...
```

for every Play route.

Correct:

```
mobile route prefix + mobile viewport
```

### Trap 3 — Global `viewport-fit=cover`

Do not restore it.

Safe-area handling belongs to mobile surfaces.

### Trap 4 — Mobile CDK drag

Touch users should not be forced through CDK drag/drop.

Use:

```
[cdkDragDisabled]="!canDrag()"
[cdkDropListDisabled]="!canDrag()"
```

### Trap 5 — Double-tap item UX

Mobile item actions are one-tap ActionSheet interactions.

### Trap 6 — ActionSheet vs TradeModal

They are intentionally separate.

ActionSheet = choose an item action.

TradeModal = quantity + transaction confirmation.

### Trap 7 — Moving network polling into TickerService

Do not do this.

The 1s Town polling timers are network behavior.

### Trap 8 — Using TickerService for music

Do not touch LoginMusicService's `requestAnimationFrame`.

### Trap 9 — Local combat math

Never invent mobile-only combat calculations.

Render the authoritative battle state.

### Trap 10 — Replacing the center map in Town

The game can remain in the Grind-oriented central surface while Town content is shown in the appropriate panel/sheet.

Do not replace the central map or invent a separate Town map unless the product contract changes.

---

## 22. Recommended Workflow for Future Mobile UI Work

Before coding:

```
1. Read STATUS.md
2. Read SPEC.md
3. Read openspec/specs/SPEC.md
4. Read PLAY_WINDOW_SPEC.md
5. Read the active OpenSpec change
6. Identify whether the change is:
   - mobile-only
   - shared presentation
   - authoritative gameplay
```

For mobile-only presentation, prefer isolated files under:

```
apps/frontend/src/app/features/play/
apps/frontend/src/app/core/
apps/frontend/src/app/shared/
```

When the behavior already exists on desktop, reuse the same store/service/component rather than reimplementing the behavior.

When a mobile-specific interaction is necessary, keep the semantics identical and change only the interaction surface.

---

## 23. Validation Checklist

For a normal mobile UI change:

### Required

- frontend build
- shared build if shared code changed
- API build if API-adjacent code changed
- OpenSpec strict validation
- `git diff --check`

### Browser smoke

Run when practical for UI-sensitive work.

Useful target viewports:

- **390 × 844**
- **360 × 740**

Check at minimum:

- no horizontal overflow
- route navigation
- Android/browser back behavior
- sheet detents
- safe-area behavior
- 50 inventory cells
- item action sheet
- trade confirmation
- account deletion modal
- Gambit touch controls
- battle log scrolling
- reconnecting state
- Town vendor flow

For this implementation, browser smoke was intentionally skipped during the final integration session. That is a known limitation, not evidence that the UI was visually verified.

---

## 24. Current Mobile Architecture Map

```
PlayComponent
│
├── Desktop branch (>=900px or desktop route)
│   ├── CharacterSummary
│   ├── RouterOutlet
│   └── GrindInfo
│
└── Mobile branch (<900px + mobile route)
    │
    └── MobileShellComponent
        ├── Mobile header
        ├── MobileCharPanelComponent
        ├── RouterOutlet
        │   ├── /play/m/battle
        │   ├── /play/m/map
        │   ├── /play/m/items
        │   ├── /play/m/gambits
        │   └── /play/m/character
        ├── SheetPanelComponent
        │   ├── Battle presentation
        │   └── Town / Vendor presentation
        ├── BattleLogComponent
        ├── ActionSheetComponent
        ├── TradeModalComponent
        ├── AccountDeleteModalComponent
        └── bottom navigation
```

Shared infrastructure:

```
ViewportService
├── isMobile
├── isTouch
├── canDrag
├── isLandscape
└── reducedMotion

TickerService
└── one 250ms presentation clock
    └── pauses when document.hidden

UiPrefsStore
├── grind detent
└── town detent

GameFormatService
└── shared presentation formatting
```

---

## 25. Final Design Intent

The mobile UI should feel like a purpose-built idle game cockpit, not a desktop website squeezed into a phone.

The most important architectural constraints are:

1. **Desktop remains isolated and stable.**
2. **Mobile routes use the `/play/m/*` namespace.**
3. **Mobile presentation can diverge; game authority cannot.**
4. **Touch replaces drag/double-click where needed.**
5. **One shared ticker handles the four 250ms presentation clocks only.**
6. **Network polling remains network polling.**
7. **TradeModal, AccountDeleteModal and ActionSheet are distinct responsibilities.**
8. **The bottom sheet overlays the character panel; it does not replace the cockpit.**
9. **Server state is always the source of truth.**
10. **Future UI/UX work should extend this architecture instead of creating parallel gameplay semantics.**

**Last updated:** 2026-10-02  
**Architecture document:** Mobile UI/UX reference  
**Status:** Active
