# Diet & Auto Feed — Streak and Automation Fixes

## Why

The existing Diet implementation keeps food mastery in a permanent per-food map even after the food leaves the three-slot Diet window, so stars incorrectly return later. Auto Feed also fails to reliably consume the next eligible food when the active digestion expires at a grind boundary.

## What Changes

- Make Diet stars a three-slot streak, not permanent per-food mastery.
- Keep an expired food visible in its Diet slot as a transparent/marked entry until another food consumption shifts it out.
- When a new food is consumed, shift the existing Diet entries left and append the newly consumed food at the right.
- When an expired food is shifted out of the leftmost slot without being consumed again, discard its streak; its next consumption starts at zero stars.
- Recompute the persisted dietLevels state from the retained Diet slots so no discarded food keeps mastery.
- Make Auto Feed consume an eligible configured food at the authoritative digestion boundary before Grind falls into Hungry, and rebuild the future queue from the new authoritative state.
- Preserve server authority: the frontend only displays expiry/streak state and requests authoritative refreshes.
- Add regressions for Auto Feed, streak retention, streak reset after eviction, and realtime/UI representation of expired marked slots.

## Capabilities

### Modified Capabilities

- diet-auto-feed: correct Diet streak semantics and server-authoritative Auto Feed boundary handling.
