# AI Coding Agent Prompt — NanoMMO `/play` + `/play/character`

You are implementing the NanoMMO frontend in an existing Angular 18+ standalone
application.

## Read first

Before changing code, read:
1. `SPEC.md`
2. `FRONTEND_SPEC.md`
3. `PLAY_WINDOW_SPEC.md`
4. `assets/README.md`
5. the generated visual references:
   - `assets/concepts/play-window-concept.png`
   - `assets/concepts/character-window-concept.png`

`SPEC.md` is authoritative for game rules, data contracts, formulas, routes and
server behavior. `PLAY_WINDOW_SPEC.md` is authoritative for the visual/UX composition.

Do not invent or alter backend/game rules.

## Objective

Implement the visual shell and screens for:

- `/play`
- `/play/grind`
- `/play/character`
- `/play/gambits`

The result must strongly evoke the supplied fantasy MMORPG reference while remaining
an original NanoMMO UI.

The UI should look like a game client, not a SaaS dashboard.

## Primary visual target

Use the concept PNGs as composition references.

Do NOT:
- embed the PNG as the page background;
- crop the screenshot into panels;
- use canvas to reproduce the screenshot;
- hard-code screenshot coordinates;
- create a fake static mock that cannot consume real Angular state.

Build semantic Angular components with CSS grid/flex and real DOM content.

## Required `/play` composition

Desktop:
- persistent top bar;
- left character/equipment/status panel;
- center map + current location title + inventory;
- right grind info + weapon proficiency;
- chat as collapsible drawer.

Top bar:
- character portrait/name/level/XP;
- Tournament / Grind / Trade tabs;
- gold, mail badge, presence, chat, settings.

Center:
- title `Currently in: {mapName}`;
- original illustrated fantasy map;
- square selectable map tiles;
- selected tile visually highlighted;
- locked tiles muted;
- battle progress information;
- exactly 50 inventory slots.

Left:
- 8 equipment slots;
- character portrait;
- HP/SP;
- statuses;
- derived stats.

Right:
- monster portrait/name/level/HP;
- potion and food counts;
- XP progress;
- battle timer;
- 7 weapon proficiency rows.

## Required `/play/character`

Create a proper Character page, not just a modal.

Sub-tabs:
1. Character
2. Gambits
3. Equipment

The old `/play/gambits` route must open the same Gambits implementation with the Gambits
tab selected. Do not duplicate the editor.

Character tab:
- paper doll + HP/SP/status;
- attribute allocator for STR/AGI/DEX/VIT/INT/SOR;
- visible unspent attribute points;
- +/- controls;
- pending preview delta;
- Reset Allocation;
- Apply Changes;
- derived stats;
- seven weapon proficiency rows;
- compact build summary;
- inventory strip.

Gambits tab:
- implement `SPEC.md §17.5` exactly;
- 3 pages;
- Active badge;
- up to 20 reorderable rows;
- condition 1;
- optional AND/OR + condition 2;
- action;
- enabled toggle;
- unavailable state tooltip;
- server field-level validation;
- CDK drag/drop.

Equipment tab:
- detailed 8-slot paper doll;
- item selection/details;
- inventory drag source.

## Angular constraints

Use:
- standalone components;
- Signals;
- existing Signal stores;
- RxJS only for sockets/streams;
- Tailwind;
- Angular CDK DragDrop and Overlay.

Do NOT add:
- NgRx;
- Angular Material solely for icons;
- another UI framework;
- Three.js;
- Phaser;
- a canvas UI.

For icons, use the dependency-free SVGs in `assets/ui/`.

## Asset policy

Use semantic SVG assets:
`icon-sword.svg`, `icon-shield.svg`, `icon-helmet.svg`, `icon-armor.svg`,
`icon-boots.svg`, `icon-cape.svg`, `icon-ring.svg`, `icon-potion.svg`,
`icon-food.svg`, `icon-coin.svg`, `icon-mail.svg`, `icon-chat.svg`,
`icon-map.svg`, `icon-grind.svg`, `icon-trade.svg`, `icon-settings.svg`,
`icon-heart.svg`, `icon-mana.svg`, `icon-target.svg`, `icon-warning.svg`,
`icon-plus.svg`, `icon-minus.svg`, `icon-check.svg`.

You may create additional SVG assets if necessary, following the same visual language.

Do not use emoji as final icons.

## CSS / visual system

Centralize visual tokens as CSS variables:
- dark brown/black backgrounds;
- bronze frame;
- gold highlight;
- cream text;
- red HP;
- blue SP;
- green success;
- muted gray-brown disabled.

Use game-like framed panels, subtle inner highlights and restrained shadows.

Avoid:
- white cards;
- glassmorphism;
- huge rounded rectangles;
- modern SaaS dashboard aesthetics;
- excessive gradients;
- excessive animations.

## Responsive

>=1200px:
full 3-column game board.

900–1199:
reduce padding; allow right panel to collapse.

600–899:
stack secondary panels; map and battle status remain primary.

<600:
mobile-first single-column flow with drawers/accordions.

Do not simply scale the desktop layout down.

## State requirements

Implement at least:
- loading skeleton;
- loaded;
- empty;
- disabled;
- pending;
- server error;
- reconnecting;
- no battle queue;
- active battle;
- dead/pending town return;
- attribute points = 0;
- attribute points > 0;
- invalid equipment drop;
- valid equipment drop;
- gambit unavailable action;
- gambit disabled line;
- gambit validation error.

Respect `prefers-reduced-motion`.

## Data rules

Never invent formulas in the frontend.

Use the values already exposed by:
- `CharacterStore`;
- `InventoryStore`;
- `BattleStore`;
- static game data/catalogs;
- existing API/socket contracts.

Battle progress is based on server `startAt`/`endAt` timestamps.

Equipment and attribute mutations remain server-authoritative.

## Component quality bar

Components should be:
- small enough to reason about;
- named semantically;
- standalone;
- accessible;
- data-driven;
- easy to test.

Prefer:
```text
PlayShell
PlayTopbar
CharacterSummary
PaperDoll
MapBoard
MapTile
InventoryGrid
InventorySlot
GrindInfo
WeaponProficiency
ChatDrawer
CharacterPage
CharacterTabs
AttributeAllocator
DerivedStats
GambitEditor
GambitPageTabs
GambitLineList
GambitLineRow
EquipmentTab
```

Do not create one 1,000-line component.

## Final verification

Before finishing:
1. Run the project's existing formatter/linter/tests.
2. Build the Angular app.
3. Verify all routes.
4. Verify `/play/gambits` deep-links to the same Gambits UI.
5. Verify 50 inventory cells render.
6. Verify all 8 equipment slots.
7. Verify 7 weapon proficiency rows.
8. Verify attribute allocation pending/apply/reset states.
9. Verify keyboard focus and reduced motion.
10. Verify mobile layout.
11. Do not modify backend rules or shared game formulas.

When a detail is ambiguous, prefer the existing specs and preserve their terminology.
Do not redesign unrelated screens.
