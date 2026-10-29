# Design

## Context

See `proposal.md` for motivation and `specs/battle-hit-feedback/spec.md` for observable behavior. The battle queue already contains immutable, ordered log events with ticks, targets, damage amounts, critical flags, and status IDs. `CharacterSummary` and `GrindInfo` each project the active battle timeline from `startAt`; the character portrait is a styled HTML element and monster artwork is a transparent SVG displayed at a stable 167×199 size. Battle event ticks are one second apart, and multiple events may share a tick.

## Goals / Non-Goals

**Goals:**
- Use the queued event timeline as the only trigger and source for damage values.
- Keep the floating feedback visually attached to the two existing combatant anchors.
- Support multiple simultaneous effects without leaking DOM nodes or replaying old events on mount.
- Preserve monster sprite transparency during the white hit flash.

**Non-Goals:**
- No battle engine, API, database, RNG, combat balance, or audio changes.
- No persistent battle history effects, damage prediction, or client-computed damage.

## Decisions

### One focused frontend presentation controller
Use a small shared presentation helper/service for event eligibility, event IDs, colors, and animation lifecycle, consumed by the Character portrait and Grind Info anchors. Avoid adding duplicated event reduction logic to unrelated components. Anchors expose a positioned overlay root; the controller adds one DOM element per eligible event and removes it when the animation finishes. CSS keyframes handle the parabola/fade and brief flashes so the browser compositor can animate transforms and opacity efficiently.

Alternative considered: render an Angular `*ngFor` array of every active number. Rejected because it adds frequent signal updates and requires manual lifetime pruning for each transient element; a small managed overlay better isolates short-lived presentation objects.

### Derive event eligibility from event fields, not HP deltas
Only positive `damage` values that target `character` or `monster` qualify. Misses and fully absorbed hits already report zero HP damage and therefore produce no number/flash. Direct attack, damaging skill, reflection, and `status_damage` events share the same pathway. Damage numbers use `status` for DoT identity, with poison and bleed handled explicitly and burn/fire-related statuses using orange; other positive DoT falls back to orange. Critical emphasis applies to positive critical damage, with the requested monster-target critical presentation guaranteed.

Alternative considered: compare successive `hpRemaining` values. Rejected because it can conflate regen, multiple same-tick hits, healing, and event ordering, and would not preserve one number per authoritative event.

### Timeline cursor skips historical events on first mount
For a newly observed battle ID, initialize the event cursor to the last event whose tick is strictly earlier than the current elapsed tick, and process only newly current events. Events that become current on subsequent timer updates are processed once by event index, including sibling events on the same tick. A battle ID change resets the cursor. This matches the existing audio service's approach and avoids replaying a queue log from its beginning when a player enters mid-battle.

Alternative considered: animate all events whose tick is less than or equal to current time. Rejected because late mount/reconnect would flood the UI with historical numbers.

### Preserve alpha for the monster flash
Use an SVG/image alpha-aware CSS filter on the monster image (brightness/opacity/saturation or drop-shadow/overlay filtered to alpha), not a solid pseudo-element over the sprite container. The white flash must act on non-transparent sprite pixels. The portrait is a solid DOM surface and can use a short red background/box-shadow flash.

Alternative considered: place a white translucent rectangle over the sprite bounds. Rejected because it violates the transparent silhouette requirement.

### Colors and sizing
Use CSS classes for normal character damage red, ordinary monster damage white, critical monster damage yellow with `font-size: 1.6em` and a visibly heavier black stroke, orange general DoT, dark green poison, and a brighter bleed red. Place numbers absolutely inside each anchor overlay, animate toward the relevant outer edge, and vary a small per-event offset based on the event index so same-tick events remain distinguishable.

## Risks / Trade-offs

- **[Same-tick bursts can overlap]** → Apply deterministic per-event horizontal/vertical offsets and slightly varied animation timing without changing event timing.
- **[CSS filters may render some SVG artwork differently]** → Keep the filter brief and alpha-preserving; verify with transparent sprites from different monster silhouettes.
- **[Background-tab throttling delays animation]** → Use animation completion callbacks and a bounded lifetime; on view destruction remove all remaining nodes and timers.
- **[A battle event may have multiple damage components but one aggregate damage field]** → Render the authoritative event's aggregate damage once, except when the log itself emits separate damage events; do not infer component values.

## Migration Plan

No data or database migration is needed. Implement the presentation helper, attach it to the existing portrait/sprite anchors, then run frontend production build, relevant unit/spec tests, OpenSpec validation, and `git diff --check`. Rollback consists of reverting the frontend presentation and its documentation; queued battle logs and server behavior are unchanged.
