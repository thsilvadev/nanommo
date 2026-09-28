# Proposal

## Why

The NanoMMO backend now has the authoritative grind/battle loop and the /game
WebSocket synchronization contract. The Angular app is still a small auth shell plus
a prototype /play screen that does not expose the real character, inventory, queue,
Gambit, equipment, or server-timed battle state.

The frontend therefore needs a single coherent game-client shell before the remaining
gameplay-facing screens can be implemented. The supplied concepts and reference define
the intended visual grammar, while SPEC.md, FRONTEND_SPEC.md, and
PLAY_WINDOW_SPEC.md define the contracts and UX boundaries.

## What Changes

- Replace the prototype /play screen with the shared NanoMMO game shell.
- Add /play/grind, /play/character, and /play/gambits routing.
- Implement the desktop three-zone shell: top HUD, character/equipment summary,
  map/inventory center, grind/proficiency right panel, and collapsible chat drawer.
- Implement /play/character with Character, Gambits, and Equipment sub-tabs.
- Implement /play/gambits as a deep-link to the same Gambit editor, not a duplicate.
- Add signal-based character, inventory, and battle state suitable for REST bootstrap
  plus /game Socket.IO synchronization.
- Implement server-timestamp battle progress from startAt/endAt; never simulate
  outcomes or resolution timing in the browser.
- Implement attribute pending/apply/reset behavior, equipment drag/drop, 50-slot
  inventory rendering, map tile selection, Gambit editing, and required UI states.
- Centralize the dark fantasy visual tokens and reuse the supplied dependency-free SVG
  assets without embedding concept screenshots as UI.
- Keep responsive behavior intentional from desktop through mobile.
## Non-Goals

- No backend gameplay, formula, battle-engine, inventory, equipment, or Gambit rule changes.
- No client-side battle simulation, outcome prediction, or authoritative timers.
- No new map movement, live monster movement, or combat scene.
- No Town, Market, Mail, or Chat backend workflow implementation; chat is only a shell/drawer integration point here.
- No screenshot recreation, canvas UI, WebGL, Three.js, Phaser, NgRx, Angular Material icon dependency, or new UI framework.
- No duplicate Gambit editor implementation.
- No redesign of unrelated auth routes beyond visual compatibility where required by the shell.

## Capabilities

### New Capabilities

- play-and-character-ui: playable Angular shell, grind view, character management,
  Gambit editor/deep-link, equipment and inventory presentation, and shared visual system.

### Modified Capabilities

None. The frontend consumes the existing backend contracts without changing them.

## Impact

Primary area:
- apps/frontend/src/app
- apps/frontend/src/styles.css
- apps/frontend/assets/ui (reuse; add only narrowly justified semantic SVG assets)

Routing:
- /play
- /play/grind
- /play/character
- /play/gambits

Verification:
- Angular unit/component tests for stateful UI behavior.
- Production Angular build.
- Route and responsive smoke verification.
- Focused checks for 50 inventory slots, 8 equipment slots, 7 proficiency rows,
  Gambit deep-link reuse, server-timestamp battle progress, and attribute pending state.

No database migration and no backend contract modification are expected.
