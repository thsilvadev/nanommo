# NanoMMO — PLAY_WINDOW_SPEC

> Implementation-level visual/UX specification for the main idle-game shell and the
> Character window. This document refines `SPEC.md §17` and `FRONTEND_SPEC.md`.
> It is intentionally concrete enough to hand to an AI coding agent.

## 0. Design intent

The target is a **browser idle MMORPG dashboard**, not a conventional web-app admin
panel.

The attached reference establishes the UX grammar:
- permanent game HUD;
- dense but readable three-zone composition;
- fantasy game-panel framing;
- map as the visual center of the `/play` experience;
- character/equipment on the left;
- grind/battle information on the right;
- inventory as a persistent lower-center area;
- top-level navigation as large game tabs;
- information is always visible before it becomes interactive.

Do not copy the original Ragnarok UI literally. Use it only as the structural reference.
The implementation should feel like an original NanoMMO interface.

## 1. Visual language

### 1.1 Palette

Use CSS custom properties so the visual language is centralized:

```css
--ui-bg: #120f0d;
--ui-panel: #1b1511;
--ui-panel-raised: #241a14;
--ui-panel-deep: #0d0b09;
--ui-frame: #6f482b;
--ui-frame-light: #a56f3f;
--ui-gold: #d6ad5c;
--ui-gold-bright: #f1d37c;
--ui-text: #efe2c4;
--ui-text-muted: #a99b82;
--ui-danger: #c94b43;
--ui-hp: #c7433f;
--ui-sp: #3186d8;
--ui-success: #65b85a;
--ui-focus: #e8c56b;
```

Do not scatter literal colors through components. Put them in a global theme file.

### 1.2 Surfaces

Every major panel has:
- dark brown/black base;
- 1px or 2px bronze border;
- subtle inner highlight;
- 2–8px radius depending on hierarchy;
- restrained shadow;
- optional `panel-noise.svg` overlay at low opacity.

Avoid glassmorphism, white cards, excessive gradients, giant rounded cards, and modern
SaaS dashboard styling.

### 1.3 Typography

Use a highly readable fantasy serif/display face for headings only and a neutral sans or
monospace/numeric face for dense values. Do not require a paid font.

Recommended implementation:
- headings: CSS font stack with `Georgia, serif`;
- numeric/data: `ui-monospace, SFMono-Regular, Menlo, monospace`;
- body: system sans.

The game should remain legible at 100% browser zoom.

## 2. Global shell

### 2.1 Desktop composition

At >= 1200px, `/play` is a 3-column game board:

```text
┌────────────────────────────────────────────────────────────────────┐
│ TOP BAR: character / XP | Tournament | Grind | Trade | resources │
├───────────────┬───────────────────────────────────┬────────────────┤
│               │                                   │                │
│ LEFT          │ CENTER                            │ RIGHT          │
│ Character     │ Map / current context             │ Grind Info     │
│ Equipment     │                                   │ Proficiency    │
│ HP/SP         │                                   │                │
│ Status        │                                   │                │
│ Derived stats │                                   │                │
│               ├───────────────────────────────────┤                │
│               │ Inventory (50 slots)              │                │
│               │                                   │                │
└───────────────┴───────────────────────────────────┴────────────────┘
```

Use CSS grid, not absolute-positioned screenshot recreation.

Suggested desktop grid:
- shell: `min-height: 100dvh;`
- top bar: 68–76px;
- content: desktop uses wider lateral zones and a reduced center; exact sizing is centralized in the play-shell CSS tokens.
- center content has a minimum width before responsive collapse;
- gaps: 8–12px.
- all three desktop zones share one fixed viewport-derived height and aligned bottom edge.
- Grind central workspace contains the inventory to the left of the 4:3 map.
- Equipment and diet cells are always square.
- Play text sizes are explicitly hard-coded at the enlarged readability scale; browser zoom is not used.
- Grind includes an unbordered Active Gambit title + selector at the top of the inventory column; selecting a Gambit activates it through the existing server-authoritative Gambit activation API.
- The inventory column keeps Active Gambit at the top and Inventory at the bottom, with a local hunt-mode selector in the space between them.
- Hunt mode uses the `hunting.svg`, `defensive.svg`, and `fleeing.svg` icons; Hunting is selected by default and the current visual selection is local-only until its backend system is implemented.
- Central Grind inventory and map sub-panels are borderless; the right Grind panel fills the same fixed shell height as Character and the map.
- Grind inventory uses exactly 5 columns × 10 rows with intrinsic square rows, avoiding stretched vertical row spacing.

### 2.2 Top bar

Left:
- small portrait;
- character name;
- level;
- compact XP bar.

Center:
- three large navigation tabs:
  - Tournament
  - Grind
  - Trade
- active tab has brighter frame + gold highlight;
- Grind is active on `/play`.

Right:
- gold;
- mail unread badge;
- online/presence count;
- chat toggle;
- settings.

The top bar is sticky within the shell.

### 2.3 Left panel

Purpose: answer "who am I and what am I wearing?" without navigation.

Order:
1. paper-doll / character portrait;
2. HP/SP bars;
3. status effects;
4. derived stats.

Equipment slots:
`head`, `body`, `mainHand`, `offHand`, `shoes`, `cape`,
`accessoryLeft`, `accessoryRight`.

In the quick Character summary, the eight slots are arranged in two columns around the centered portrait, with a reserved Status region below HP/SP for future buff/debuff icons.

Equipment interaction:
- drag inventory item onto compatible slot;
- drag equipped item back to inventory;
- CDK drag-drop;
- server remains authoritative;
- on rejected equip, restore the previous visual state and show a specific error.

### 2.4 Center `/play` view

Header:
- framed title: `Currently in: {mapName}`.

Map:
- original fantasy world illustration;
- selectable square grind tiles over the map;
- selected tile has a clear double frame + glow;
- hover/keyboard focus previews tile name and unlock requirement;
- locked tiles remain visible but muted;
- map is an illustration, not a live character scene.

Important:
**There is no character movement/fighting animation on the map.**
The character's combat is represented by information panels and timers.

Map controls:
- zoom in/out if needed;
- legend;
- optional compass/decorative navigation;
- tile selection.

Below the map:
- battle progress bar;
- current monster/battle state if there is enough vertical space;
- 50-slot inventory.

Inventory:
- exactly 50 slots;
- 5 rows × 10 columns on wide desktop;
- each slot is a square game inventory cell;
- item icons occupy most of the usable slot interior;
- the same item-to-slot proportion is used by inventory, equipment and NPC/vendor stock;
- stack count appears bottom-right;
- equipment is never stacked;
- empty slots remain visible;
- item tooltip contains name, rarity, quantity and relevant stats;
- right-click is not required for MVP.

### 2.5 Right panel

Top: `Grind Info`
- current monster portrait;
- monster name and level;
- HP bar;
- encounter/battle state;
- potion count;
- food count;
- XP bar;
- battle timer/progress.

Below: `Weapon Proficiency`
- 7 weapon types;
- level + XP progress;
- compact horizontal bars;
- selected/current weapon is visually emphasized.

Do not turn the right panel into a scrolling wall of text. Prefer compact cards/rows.

### 2.6 Chat

Chat is a drawer, not a permanent fourth column.

Closed:
- small `Chat (Global)` affordance.

Open:
- overlay/drawer with Global/Town tabs;
- keep gameplay visible behind it on desktop;
- on mobile it may become a full-height panel.

## 3. `/play/character`

### 3.1 Purpose

This screen is the authoritative place for:
- extended character information;
- attribute point allocation;
- equipment inspection;
- derived combat stats;
- weapon proficiency;
- Gambit configuration.

The visual language must be identical to `/play`.

### 3.2 Internal navigation

Use a framed sub-tab row:

- `Character` — active default;
- `Gambits`;
- `Equipment`.

The existing `/play/gambits` route remains valid as a deep-link/compatibility route
that opens the same Character shell with `Gambits` selected. Do not create two different
visual implementations of the gambit editor.

### 3.3 Character tab layout

Desktop:

```text
┌────────────────┬──────────────────────────────────┬─────────────────┐
│ Paper doll     │ Attribute allocation             │ Weapon          │
│ + HP/SP        │ STR  [-] 12 [+]  +0             │ Proficiency     │
│ + status       │ AGI  [-]  8 [+]  +0             │                 │
│                │ DEX  [-] 15 [+]  +2             │ 7 weapon rows   │
│                │ VIT  [-] 10 [+]  +0             │                 │
│                │ INT  [-]  7 [+]  +0             │                 │
│                │ SOR  [-]  5 [+]  +0             │                 │
│                ├──────────────────────────────────┤                 │
│                │ Derived stats                    │ Build summary   │
└────────────────┴──────────────────────────────────┴─────────────────┘
┌───────────────────────────────────────┬─────────────────────────────┐
│ Inventory                              │ Gambit summary               │
└───────────────────────────────────────┴─────────────────────────────┘
```

### 3.4 Attribute allocator

Show:
- unspent points prominently;
- current value;
- decrement/increment controls;
- preview delta;
- one-line effect explanation.

Allocation is client-side pending state only until Apply:
- changing `+/-` does not immediately mutate the server store;
- Apply sends the allocation request;
- Reset Allocation returns to server state before Apply;
- if server rejects, discard pending changes and show error.

If 0 points:
- controls remain visible but disabled;
- explain `No attribute points available`;
- never hide the allocator.

### 3.5 Derived stats

Use two compact columns on desktop:
- ATK
- MATK
- DEF
- MDEF
- Accuracy
- Evasion
- Crit
- ASPD
- HP Regen
- SP Regen

Values come from `CharacterStore`; frontend does not invent alternative formulas.

### 3.6 Weapon proficiency

Seven rows:
- Sword
- Greatsword
- Dagger
- Bow
- Staff
- Wand
- Shield

Each row:
- icon;
- weapon name;
- level;
- XP/current threshold;
- progress bar.

Do not present skill unlocks as a separate tree here; proficiency progress is the primary
character-sheet concern. Skills can be shown in an optional tooltip/detail overlay later.

### 3.7 Gambits sub-tab

Reuse the exact editor defined by `SPEC.md §17.5`:
- 3 pages;
- Active badge;
- up to 20 reorderable rows;
- condition 1;
- optional AND/OR + condition 2;
- action;
- enabled toggle;
- unavailable-state tooltip;
- field-level server validation.

The sub-tab may show the editor full-width. Do not squeeze 20 rows into a tiny card.

### 3.8 Equipment sub-tab

Show:
- large paper doll;
- eight equipment slots;
- selected item detail;
- stat roll detail;
- inventory drag source.

This is a detailed management view; the global shell's left paper doll remains a
quick summary.

## 4. Responsive behavior

### >= 1200px
Full three-column desktop composition.

### 900–1199px
- keep three zones but reduce panel padding;
- right panel can collapse into a vertical accordion below center;
- inventory remains 10 columns if space permits.

### 600–899px
- top navigation remains horizontally scrollable;
- left character summary becomes a top/side compact strip;
- right grind/proficiency becomes collapsible sections;
- inventory becomes 5 columns × 10 rows;
- map preserves selectable tile clarity.

### < 600px
Prioritize:
1. top bar;
2. current map;
3. battle status;
4. character quick status;
5. inventory;
6. secondary details in drawers/accordions.

Character screen:
- paper doll first;
- attribute allocator second;
- derived stats/proficiency in collapsible sections;
- Gambits gets its own full-screen tab.

Never solve mobile by simply shrinking the desktop screenshot.

## 5. State design

Every screen must define:
- initial loading skeleton;
- loaded;
- empty;
- disabled;
- optimistic/pending;
- server rejection;
- disconnected/reconnecting;
- fatal/unrecoverable error.

Use one global skeleton language:
- dark blocks;
- animated shimmer only if `prefers-reduced-motion: no-preference`;
- no spinner-only full-screen waits for normal data fetches.

Grind-specific:
- no battle queued;
- searching for encounter;
- battle active;
- queue reconnecting;
- dead/pending return;
- returned to town.

Character-specific:
- 0 points;
- points available;
- pending allocation;
- allocation success;
- allocation rejection;
- equipment drag over valid slot;
- equipment drag over invalid slot.

Gambit-specific:
- active;
- editable;
- locked while current battle is in flight;
- validation error;
- unavailable action;
- explicitly disabled row.

## 6. Interaction rules

- Buttons must have visible hover, active, focus and disabled states.
- Keyboard focus must be visible with a gold outline.
- Tooltips explain game-specific unavailable states.
- Never rely only on color to communicate state.
- Do not animate layout reflow.
- Progress bars animate smoothly only from server timestamps/data; they do not
simulate game outcomes.
- Respect `prefers-reduced-motion`.
- Use CDK for drag/drop and overlay instead of hand-rolled pointer systems.
- No canvas is required for MVP UI.
- No WebGL/Three.js/Phaser is required for these screens.

## 7. Angular implementation rules

Use standalone Angular components.

Recommended feature structure:

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
    attribute-allocator/
    derived-stats/
    paper-doll/
    equipment-tab/
    character-tabs/
  gambit-editor/
    gambit-page-tabs/
    gambit-line-list/
    gambit-line-row/
```

State:
- Signals for local state and computed display state.
- Signal stores for Character/Inventory/Battle.
- RxJS only for Socket.IO event streams or genuinely stream-like sources.
- Do not introduce NgRx.
- Do not introduce a new UI framework.

## 8. Icons and assets

Angular does not provide a built-in fantasy icon set.

Preferred solution:
- dependency-free SVG assets in `assets/ui/`;
- or a tiny reusable `IconComponent` that renders inline SVG paths.

Use the supplied icons for:
- sword, shield, helmet, armor, boots, cape, ring;
- potion, food;
- coin, mail, chat, settings;
- map, grind, trade;
- heart, mana, target, star, warning, plus/minus/check;
- inventory, scroll, weapon, magic.

Do not use emoji as final UI icons.

For the map and character art:
- use raster images as visual backgrounds/references;
- keep interactive controls and text as real Angular DOM;
- never flatten the complete UI into one screenshot.

## 9. Asset naming

Use stable semantic names:
`icon-sword.svg`, `icon-shield.svg`, `icon-potion.svg`, etc.

The generated concept art is:
- `assets/concepts/play-window-concept.png`
- `assets/concepts/character-window-concept.png`

They are visual targets only, not runtime UI.

## 10. Acceptance checklist

The implementation is not done until:
- `/play` visually reads as a fantasy game dashboard at first glance;
- map is the visual center;
- inventory is visibly 50 slots;
- left panel answers character/equipment/status;
- right panel answers current grind/proficiency;
- top tabs clearly distinguish Tournament / Grind / Trade;
- `/play/character` has a true attribute-allocation workflow;
- Character has Character/Gambits/Equipment sub-tabs;
- `/play/gambits` deep-links to the same Gambits view;
- no UI area is a screenshot baked into the DOM;
- no Angular Material or icon library was added just for icons;
- all interactive states are implemented;
- desktop and mobile layouts are intentional;
- visual tokens are centralized;
- existing backend contracts from `SPEC.md` remain unchanged.

## 11. Do not do these things

- Do not redesign the game into a modern SaaS dashboard.
- Do not make the map a generic Google Maps-like component.
- Do not add character movement or combat animation to the map.
- Do not add monsters to the map as moving entities.
- Do not invent new combat formulas.
- Do not compute battle outcomes on the frontend.
- Do not replace the Gambit model with a generic rules engine.
- Do not hide unavailable gambit options.
- Do not make every panel a rounded floating card.
- Do not use giant typography or excessive whitespace.
- Do not add dependencies without a concrete need.

## 12. Reference files

- `SPEC.md` — authoritative game/technical rules.
- `FRONTEND_SPEC.md` — route/component/state breakdown.
- `assets/concepts/play-window-concept.png` — visual target for `/play`.
- `assets/concepts/character-window-concept.png` — visual target for `/play/character`.
- `assets/reference/original-reference.png` — user-provided inspiration.

When these documents conflict, preserve game rules in `SPEC.md`; this document owns
visual composition and interaction details for these screens.


### Town map presence

Town is the canonical gameplay map `map_town`. The existing Town tile/panel remains unchanged visually, while its realtime `Players in map: X` count uses the same map-presence contract as every other map.
