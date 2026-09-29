# NanoMMO — Frontend Spec

`SPEC.md §17` defines the frontend stack, routes, state boundaries, and high-level UX.
This document turns that contract into implementation-ready screen breakdowns.

**Visual/interaction authority for `/play` and `/play/character`:**
`PLAY_WINDOW_SPEC.md`.

The concept images shipped under `assets/concepts/` are references for composition and
visual language, not screenshots to embed.

---

## 1. Global shell (`/play`)

### Purpose
Present NanoMMO as a dense fantasy MMORPG game client: persistent HUD, character identity
and equipment, map/grind context, inventory, progression information, and chat.

### Data dependencies
- `CharacterStore`
- `InventoryStore`
- `BattleStore`
- `ChatStore`
- Socket.IO presence/chat/battle events
- existing REST endpoints for mutations

### Layout
Desktop: top bar + left character summary + center context + right grind/progression panel,
with chat as a collapsible drawer. Exact visual grid, tokens, responsive rules and states
are defined in `PLAY_WINDOW_SPEC.md`.

### Components
`PlayShellComponent`, `PlayTopbarComponent`, `CharacterSummaryComponent`,
`PaperDollComponent`, `MapBoardComponent`, `InventoryGridComponent`,
`GrindInfoComponent`, `WeaponProficiencyComponent`, `ChatDrawerComponent`.

### States
Cold boot/loading skeleton, loaded, reconnecting, server error, character unavailable,
chat closed/open. Use one global loading/skeleton language.

---

## 2. `/play/grind`

### Purpose
Core idle loop screen: choose a map, observe the current battle, and monitor progression.

### Data dependencies
`BattleStore`, `CharacterStore`, `InventoryStore`, presence socket events.

### Layout
Center: `Currently in: {mapName}`, illustrated fantasy map, selectable square grind tiles,
selected/locked/hover/focus states, battle progress.

Bottom-center: 50-slot inventory.

Left: character summary.

Right: current monster, consumables, XP, battle time, weapon proficiency.

### Components
`MapBoardComponent`, `MapTileComponent`, `BattleProgressBarComponent`,
`GrindInfoComponent`, `InventoryGridComponent`, `EventFeedComponent`,
`LastDeathButtonComponent`, `LastDeathModalComponent`.

Map selection is part of the center map board, not a separate TBD component.

### Rules
The map is not a live combat scene. No character movement or monster movement is rendered.
Battle progress is derived from server `startAt`/`endAt` timestamps.

### States
Map loading, map selected, locked map/tile, searching for encounter, battle active,
queue empty, reconnecting, dead/pending return, town return banner.

---

## 3. `/play/character`

### Purpose
Extended character management: attribute allocation, derived combat stats, equipment,
weapon proficiency, and Gambit access.

### Internal tabs
- `Character`
- `Gambits`
- `Equipment`

The existing `/play/gambits` route is a deep-link into this same view with `Gambits`
selected. There must be one Gambit editor implementation.

### Character tab
Components:
- `AttributeAllocatorComponent`
- `DerivedStatsComponent`
- `PaperDollComponent`
- `StatusEffectsComponent`
- `WeaponProficiencyComponent`
- `BuildSummaryComponent`
- `InventoryStripComponent`

Attribute allocator:
- show `unspentAttributePoints`;
- show STR/AGI/DEX/VIT/INT/SOR;
- +/- controls;
- pending preview delta;
- Reset Allocation;
- Apply Changes;
- 0-point state remains visible but disabled;
- server rejection restores authoritative state and shows a specific error.

### Equipment
Eight slots: `head`, `body`, `mainHand`, `offHand`, `shoes`, `cape`,
`accessoryLeft`, `accessoryRight`. Use Angular CDK drag/drop. Invalid combinations must
produce a visible server-authoritative error.

### States
Loading, 0 points, points available, allocation pending/success/rejected,
valid/invalid equipment drag target, equipment mutation rejected.

---

## 4. `/play/gambits`

Deep-link to the Gambits sub-tab of `/play/character`.

Reuse the same:
- `GambitPageTabsComponent`
- `GambitLineListComponent`
- `GambitLineRowComponent`
- `GambitCatalogService`

The editor remains exactly as specified by `SPEC.md §17.5`: 3 pages, one active page,
up to 20 rows, CDK reorder, condition 1, optional AND/OR + condition 2, action,
enabled toggle, unavailable actions visible but greyed out, and field-level validation.

---

## 5. `/play/town`

Structural hub for Vendor, Warehouse, Market, and Mail. Until backend workflows exist,
use structural placeholders rather than inventing final workflows.

---

## 6. Auth routes

`/login`, `/register`, `/verify-email`, `/reset-password`. Functional and visually
consistent, but lower priority than the core game loop.

---

## 7. Visual implementation rules

- Dark fantasy game-client aesthetic.
- Bronze/gold framed panels.
- Cream text.
- Red HP and blue SP bars.
- Compact numeric typography.
- 50 visible inventory cells on the main grind screen.
- No SaaS-card visual language.
- No screenshot baked into the DOM.
- Semantic DOM + CSS grid/flex.
- Dependency-free SVG icons from `assets/ui/`.
- Angular CDK for drag/drop and overlays.
- No canvas/WebGL/Three.js/Phaser required for these screens.

See `PLAY_WINDOW_SPEC.md` for exact visual system and responsive composition.

---

## 8. Suggested component structure

```text
features/
  play/
    play-shell/
    play-topbar/
    character-summary/
    map-board/
    inventory-grid/
    grind-info/
    weapon-proficiency/
    chat-drawer/

  character-sheet/
    character-page/
    character-tabs/
    attribute-allocator/
    derived-stats/
    paper-doll/
    status-effects/
    equipment-tab/
    build-summary/

  gambit-editor/
    gambit-page-tabs/
    gambit-line-list/
    gambit-line-row/
```

Keep components small and state-driven.

---

## 9. Build order

1. Auth routes — functional only.
2. Global shell + `/play/character` read-only.
3. `/play/grind` map + battle bar + inventory.
4. Gambit editor and `/play/gambits` deep-link.
5. Attribute allocation.
6. Equipment drag/drop.
7. Town structural shell.
8. Visual polish + responsive + i18n + reduced-motion pass.

---

## 10. Reference contract

When visual details conflict with backend/game rules:
- `SPEC.md` wins for rules/data/contracts.
- `FRONTEND_SPEC.md` defines route/component boundaries.
- `PLAY_WINDOW_SPEC.md` defines visual composition and interaction details.

Do not change formulas, server authority, battle timing, inventory rules, or Gambit
semantics to achieve a visual effect.

---

## 11. Battle WebSocket synchronization contract

This section defines the realtime contract implemented by the `/game` Socket.IO gateway.
It is intentionally transport-only: **the server is authoritative**. The client sends intents,
receives facts, updates its local store, and renders them. The client never decides battle outcome,
resolution timing, queue contents, or resolution order.

### 11.1 Connection and authentication

Connect to Socket.IO namespace `/game` with the same JWT access token used by REST:

```ts
io('/game', {
  auth: { token: accessToken },
});
```

The server validates the JWT and requires `payload.sessionId === users.activeSessionId`.
A successful connection joins the private room `char:<characterId>`. If the character is already
grinding, the socket also joins `map:<mapId>` for presence-related traffic.

A disconnect does **not** pause, cancel, resolve, or otherwise alter the battle loop.

### 11.2 Authoritative state bootstrap and reconnect

WebSocket events are not an event log and are not replayed after reconnect. After every initial
connection and every reconnect, the frontend MUST resynchronize through REST:

1. `GET /characters` — authoritative character state.
2. `GET /battles/queue` — authoritative live unresolved queue.
3. Reconcile the current route/map from `character.currentMapId` and `character.status`.

`GET /battles/queue` currently returns a **bare `BattleQueueEntry[]`**, not `{ entries: [...] }`.

REST wins over stale cached socket state. Do not reconstruct missed battles from elapsed wall-clock
time, local timers, or previously cached queue entries.

### 11.3 `battle:queueUpdated`

**Payload actually emitted:**

```ts
type BattleQueueUpdated = {
  entries: BattleQueueEntry[];
};
```

`BattleQueueEntry` is the persisted backend entity and currently contains:

```ts
{
  id: string;
  characterId: string;
  sequenceIndex: number;
  mapId: string;
  monsterId: string;
  startAt: string; // ISO timestamp after JSON serialization
  endAt: string;   // ISO timestamp after JSON serialization
  outcome: 'win' | 'loss';
  log: unknown;
  xpGain: number;
  goldGain: number;
  drops: unknown[];
  itemsConsumed: Array<{ itemId: string; quantity: number }>;
  hpAfter: number;
  spAfter: number;
  resolved: false;
  seedUsed: string;
}
```

Only live unresolved entries are returned by the queue read path. The frontend should normally use
`sequenceIndex`, `startAt`, `endAt`, `monsterId`, `outcome`, `xpGain`, `goldGain`, `drops`, and
`itemsConsumed` for the battle UI; it should not expose `seedUsed` or treat `log` as authoritative
input for simulation.

**When it is emitted:** map entry, queue top-up, and queue rebuild after a level-up. A death does
not create a replacement queue.

**UI action:** replace the BattleStore's live queue with the received authoritative entries. Select
the currently active entry by the earliest unresolved sequence/time, render its progress from
`startAt`/`endAt`, and show the next entries as the predicted server queue. Do not locally append,
remove, reorder, or mutate queue entries based only on animation completion.

### 11.4 `battle:resolved`

**Payload actually emitted:**

```ts
type BattleResolved = {
  entryId: string;
  outcome: 'win' | 'loss';
  xpGain: number;
  goldGain: number;
  drops: unknown[];
  characterAfter: {
    id: string;
    level: number;
    xp: number;
    hpCurrent: number;
    spCurrent: number;
    gold: number;
    status: string;
  };
};
```

This event is emitted only after the resolver successfully claims the row and applies its
authoritative effects. A duplicate resolution attempt does not emit a second `battle:resolved`.

**UI action:** update the CharacterStore with `characterAfter`, mark the referenced `entryId` as
resolved in transient UI state, and refresh any reward/event-feed presentation from `xpGain`,
`goldGain`, and `drops`. Do not treat the event as permission to invent a new queue. The following
`battle:queueUpdated`, when applicable, is the authoritative live queue.

### 11.5 `character:leveledUp`

**Payload actually emitted:**

```ts
type CharacterLeveledUp = {
  newLevel: number;
  unspentAttributePoints: number;
};
```

One event is emitted for a resolution that crosses one or more thresholds; the payload contains the
final level and final unspent points.

**UI action:** update the displayed level and available attribute points, play the level-up feedback,
and refresh derived character presentation from authoritative character state. Do not calculate the
new level locally from XP or assume that exactly one level was gained.

A queue rebuild may follow this event. The frontend must accept the subsequent
`battle:queueUpdated` as the replacement queue.

### 11.6 `character:died`

**Payload actually emitted:**

```ts
type CharacterDied = {
  deathLog: {
    monsterId: string;
    mapId: string;
    timestamp: string;
    log: unknown;
  };
};
```

`deathLog` is the exact object stored in `Character.lastDeathLog` by the death handler.

**UI action:** mark the character as dead/town-bound, stop rendering an active battle as if it were
still progressing, surface the latest death information, and route to the Town view according to
frontend navigation rules. Then resync through `GET /characters` and `GET /battles/queue` so the UI
uses the persisted `status`, `currentMapId`, HP, XP, and empty live queue rather than inferring them
from the event alone.

No replacement battle queue is emitted after death.

### 11.7 Event ordering and rendering rules

For a normal winning resolution, the authoritative flow is:

1. battle effects are persisted;
2. `battle:resolved` is published;
3. `character:leveledUp` is published if applicable;
4. `battle:queueUpdated` is published with the final live queue.

For death:

1. death state and `lastDeathLog` are persisted;
2. `battle:resolved` is published for the loss;
3. `character:died` is published;
4. no replacement queue is published.

The frontend may animate between these facts, but animation completion never triggers server
resolution. `startAt` and `endAt` are server timestamps and are the only timing authority for the
battle progress bar.

### 11.8 Event delivery failure and reconnect behavior

Event delivery is best-effort synchronization. Redis/Socket.IO publication failure must not prevent
battle resolution, XP/gold/drop application, death handling, level-up handling, or queue rebuilding.

Therefore:

- Never retry a battle locally because an event was not observed.
- Never resolve a battle from the browser.
- Never assume an event was lost merely because a UI animation ended.
- On reconnect, REST state is authoritative and replaces stale local battle state.
- After resync, subsequent socket events are incremental synchronization facts.

### 11.9 Out of scope for this battle-loop contract

Chat, Mail, Market, and Town workflows are not part of the battle-loop synchronization contract.
Their future realtime behavior must not be used as a dependency for battle resolution.
