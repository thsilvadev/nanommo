# NanoMMO — Frontend Spec (screen breakdown)
 
`SPEC.md` §17 defines the stack, routes, high-level layout, the gambit editor,
and feedback/feel. It stops at the route list — it doesn't break each route
into concrete zones, components, and states. This document is that missing
layer, filled in route by route, ideally *before* that route's first
implementation session, not during it.
 
Each section below: **Purpose**, **Data dependencies** (which store/signals,
which REST/socket calls), **Layout zones** (mapping onto §17.4's persistent
top bar / left / center / right panels), **Components needed**, **States to
design for** (loading / empty / error / success — not just the happy path),
and **cross-references** to `INTERACTION_SPEC.md` rows that apply.
 
---
 
## 1. Global shell (`/play`)
 
Wraps every `/play/*` route.
 
- **Top bar** (persistent, §17.4): name/level, gold, mail badge, presence
  counter, chat toggle. → `TopBarComponent`, reads `CharacterStore`.
- **Left panel** (persistent per §17.4, generically stated — **confirm**
  whether it's truly present on every `/play/*` route or only some):
  portrait/stats/equipment paper-doll.
- **Chat drawer**: collapsible, Global/Town tabs, reachable from anywhere. →
  `ChatDrawerComponent`, backed by `ChatStore`, socket-driven.
- **Redirect logic**: `/play` → `/play/town` or `/play/grind` based on
  `Character.status` (§17.3). This is a guard/resolver, not a component
  (`PlayRedirectGuard`).
**State to design:** what does the shell look like before `Character` has
loaded at all — cold boot, valid token, no character fetched yet? Pick one
pattern (skeleton vs. spinner) and reuse it everywhere; don't let each route
invent its own loading treatment.
 
---
 
## 2. `/play/grind`
 
**Purpose:** the core loop screen — watch and manage the battle queue.
 
**Data dependencies:** `BattleStore` (live queue, socket + REST fallback),
`CharacterStore` (status, current map).
 
**Layout:** center zone = map view + battle progress bar + live scrolling
event feed (§17.4, §17.6).
 
**Components:**
- `BattleProgressBarComponent` — driven purely by `startAt`/`endAt` (§17.6);
  must survive a page refresh with no client-side battle state to rehydrate.
- `EventFeedComponent` — scrolling combat/drop log. Decide: newest on top or
  bottom? Respect reduced-motion for the scroll/append animation.
- `MapSelectorComponent` — SPEC doesn't say where map selection lives (here,
  or only from town). **TBD.**
- `LastDeathButtonComponent` → opens `LastDeathModalComponent`, rendering
  `lastDeathLog` as a readable timeline with damage-source breakdown (§17.6).
**States:** normal grinding; queue momentarily empty
(`INTERACTION_SPEC.md` §3 row 7); just died (row 8); reconnecting (row 10);
pending nav-to-town banner (row 1).
 
---
 
## 3. `/play/town`
 
**Purpose:** hub for vendor / warehouse / market / mail as sub-tabs (§17.4).
 
**Known gap:** SPEC.md has no UI detail for vendor, market, or mail, and all
three are backend stubs (`STATUS.md` §3). **Don't design these screens in
detail yet** — they're blocked on backend work existing at all. If a
placeholder is needed for navigation testing, keep it a literal "Em breve"
per tab so nobody mistakes a mockup for a settled design.
 
**Components (structural only, for now):** `TownTabsComponent` (Vendor |
Warehouse | Market | Mail), each tab lazy-loaded and stubbed until its
backend exists.
 
---
 
## 4. `/play/character`
 
**Purpose:** stats, attribute allocation, equipment paper-doll.
 
**Data dependencies:** `CharacterStore`, `InventoryStore` (equip targets).
 
**Components:**
- `AttributeAllocatorComponent` — spend points. Cross-ref
  `INTERACTION_SPEC.md` row 5 (TBD).
- `PaperDollComponent` — 8 equip slots, drag from the inventory grid.
  Cross-ref row 4 (TBD).
- `WeaponProficiencyComponent` — ×7, per `ARCHITECTURE.md`'s data model.
**States:** 0 unspent points vs. >0 — does the allocator still render if
there's nothing to spend, visible-but-disabled, or hidden? (**TBD.**) An
equip attempt rejected by server-side validation (slot/stacking rules, per
the Security section) needs a visible, specific error — not a silent revert.
 
---
 
## 5. `/play/gambits`
 
**Purpose:** the gambit editor. §17.5 is already detailed — build directly
from it rather than re-deriving.
 
**Components** (named straight from §17.5):
- `GambitPageTabsComponent` — 3 tabs, Active badge, "set active" disabled
  with a tooltip during battle (`INTERACTION_SPEC.md` row 2).
- `GambitLineListComponent` — CDK `cdkDropList`/`cdkDrag`, up to 20 rows.
- `GambitLineRowComponent` — condition 1 select, optional AND/OR + condition
  2 select, action select, enabled toggle, and the greyed-unavailable state
  with tooltip — two *visually distinct* muted states per §17.5 (disabled by
  player vs. unavailable due to current gear/items).
- `GambitCatalogService` — sources all selects from `gambit_catalog.json`.
**States:** a server-side validation error (§8.4) returns field-level paths
like `lines[0].conditions[0].id` — the UI needs to parse that path and
highlight the exact failing control, not just toast the raw string.
 
---
 
## 6. Auth routes (`/login`, `/register`, `/verify-email`, `/reset-password`)
 
Lowest visual priority (not part of the core loop) but required for any
playable slice. Keep functional and plain; revisit polish later.
 
---
 
## 7. Suggested build order (for a minimal "v0 jogável" slice)
 
1. Auth routes — functional only.
2. Global shell + `/play/character` read-only — proves `CharacterStore` and
   the top bar work end to end.
3. `/play/grind` happy path — rows 1/6/8 from `INTERACTION_SPEC.md` at
   minimum.
4. `/play/gambits` — a character with no active gambit never attacks
   (`ENGINEERING_NOTES.md` §4.9), so grinding isn't meaningful without this.
5. Attribute allocation.
6. `/play/town` as a structural stub only — real vendor/market/mail wait on
   backend work.
---
 
## 8. How to extend this document
 
Before building any route not yet listed here, add its section following the
same template (Purpose / Data dependencies / Layout / Components / States).
If a state touches player intent vs. server timing, cross-reference or add a
row in `INTERACTION_SPEC.md` first.
