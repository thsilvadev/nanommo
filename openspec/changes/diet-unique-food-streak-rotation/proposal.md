# Diet — Unique Food Slots and Streak Rotation

## Why

The Diet can currently contain the same food more than once. The consumption helper appends the food without first removing its previous slot, and it rebuilds dietLevels from that duplicate-bearing list. This can produce duplicate icons and make the displayed stars disagree with the intended retained streak. Existing specifications also conflict: an early Diet change calls levels permanent per-food mastery, while the later streak change defines a three-slot streak but still allows repeated entries.

## What Changes

- Define Diet as an ordered window of up to three unique food item IDs, oldest on the left and most recently consumed on the right.
- On a repeat consumption of a food still retained in Diet, preserve and increment its streak by one, capped at ★★★, and move it to the rightmost slot without leaving a duplicate.
- When Diet already has three entries, every successful food consumption advances the window: evict the oldest (leftmost) entry, preserve the relative order of the other entries, remove the selected food's previous occurrence if still present, and append the selected food at the right.
- When Diet has fewer than three entries, do not evict an unrelated food; remove a retained occurrence of the selected food if any, then append it. New food types fill the next available slot.
- Treat stars as a streak belonging only to the retained three-slot window. Eviction resets that food's streak; if consumed again after digestion finishes while absent from Diet, it starts at level 0.
- Keep digestion lockout independent of streak retention. A food remains ineligible until its latest lastDigestUntil has elapsed, even if its slot is evicted. Eviction resets its level but must not bypass digestion.
- Normalize legacy Diet state containing duplicate food entries, preserving the highest observed retained star level while using the newest occurrence for recency/digestion data.
- Apply one shared rule to manual consumption, Auto Feed, NPC-granted food, battle-resolution reconciliation and projected/simulated food consumption.
- Update the canonical SPEC and architecture/status records; add regressions for rotation, streak progression/reset, digestion and legacy duplicates.

## Non-goals

- No changes to food duration, regeneration formula, Auto Feed boundary timing, active-battle immutability, or the three-star cap.
- No frontend-owned Diet mutations or local reconstruction of gameplay state.
- No production deployment as part of the proposal.

## Specification Delta

This change adds the first standalone machine-readable OpenSpec contract for the existing diet-auto-feed capability. The gameplay capability is not new; the new spec delta formalizes its corrected unique-slot, streak-eviction and digestion-lockout behavior so strict OpenSpec validation can track the requirements and scenarios.
