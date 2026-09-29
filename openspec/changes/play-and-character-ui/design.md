# Design

## Context

The current frontend is Angular 18 standalone with Tailwind, Angular CDK already
installed, and only auth plus a prototype PlayComponent. There are no Signal stores
for character/inventory/battle yet and no Socket.IO client service. The backend already
exposes REST state and the /game Socket.IO contract documented in FRONTEND_SPEC.md.

The visual references are supplied as composition targets, not runtime assets. The
implementation must remain semantic DOM/CSS so real server state can replace loading
and placeholder values without rewriting the layout.

## Decisions

### D1 — One game shell, route-specific center content

PlayShell owns the persistent HUD and three-zone layout. /play/grind owns the grind
center state; /play/character owns the character management workspace. /play resolves
to the appropriate gameplay context from authoritative character state rather than
creating a second shell.

### D2 — Character page is the single source of Gambit UI

CharacterPage owns Character/Gambits/Equipment tabs. /play/gambits navigates to the
same page with the Gambits tab selected. There is no separate Gambit feature tree that
can drift from the character screen.

### D3 — REST bootstrap, WebSocket synchronization

On initial load and socket reconnect, stores fetch authoritative character state and
GET /battles/queue. Socket events then update those stores incrementally. A reconnect
never reconstructs state from local timers or missed events.

### D4 — Server timestamps drive only presentation

BattleProgressBar receives startAt/endAt from BattleStore and computes visual progress
from the current clock. It never calls a resolver, changes queue contents, or derives
outcomes. battle:resolved, character:leveledUp, character:died, and battle:queueUpdated
are synchronization facts from the existing gateway.
### D5 — Signal stores own authoritative display state

Use small injectable stores for Character, Inventory, and Battle. Components consume
readonly signals/computed signals and keep only local interaction state such as pending
attribute deltas, selected inventory item, active character tab, and chat visibility.
RxJS remains reserved for HTTP composition where needed and Socket.IO streams.

### D6 — Existing backend contracts are typed at the frontend boundary

Create frontend DTO/types matching actual responses and socket payloads instead of
inventing a parallel domain model. Static catalogs such as gambit_catalog.json remain
catalog data; formulas stay on the server.

### D7 — Visual primitives are centralized

Global CSS custom properties own palette, frame, text, HP/SP, success, danger and
focus tokens. Shared panel, progress, tab, slot and tooltip primitives provide the
visual grammar. Components do not scatter literal theme colors.

### D8 — Layout uses CSS grid/flex, not screenshot coordinates

Desktop uses the specified three-column board. Breakpoints collapse secondary panels
and preserve map, battle state, character identity and inventory visibility. No fixed
pixel reconstruction of the concept images is allowed.

### D9 — CDK handles interaction infrastructure

Use Angular CDK DragDrop for equipment/inventory movement and Gambit row reordering,
and CDK Overlay for tooltips/modal-like overlays where needed. Do not add a second UI
framework merely to provide these primitives.

## State and interaction boundaries

Character allocation has a local pending model: +/- changes only affect preview state;
Reset restores the last authoritative snapshot; Apply sends the allocation request;
server rejection discards pending changes and surfaces the returned error.

Equipment drag/drop is similarly server-authoritative. A compatible target can receive
an optimistic visual cue, but the committed equipped state comes only from server data.
Invalid drops do not invent client validation rules beyond known slot compatibility and
must present the server rejection when applicable.

Gambit editing follows the existing catalog and validation contract. Unavailable actions
remain visible but disabled with an explanatory state. Active-page switching respects the
backend mid-battle restriction; the frontend must not bypass it.

## Visual composition

The top bar contains character identity/XP, Tournament/Grind/Trade navigation, resources,
and utility affordances. The left zone contains paper doll, HP/SP, statuses and compact
stats. The center zone contains current map title, illustrated map with selectable tiles,
battle status and exactly 50 inventory cells. The right zone contains grind/monster state,
consumables, XP/timer and seven weapon proficiency rows. Chat is a collapsible drawer.

Character management reuses the same visual tokens while giving attributes, derived stats,
proficiency, paper doll and inventory a larger workspace. Gambits gets enough width for
20 rows rather than being compressed into a small card.
