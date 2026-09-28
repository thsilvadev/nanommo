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
