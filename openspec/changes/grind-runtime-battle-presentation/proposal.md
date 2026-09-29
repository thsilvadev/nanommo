# Proposal

## Why

The deterministic battle queue already contains enough authoritative data to run an idle grind loop, but the current implementation does not fully connect queue resolution to resource exhaustion, deferred equipment changes, and the visual battle experience.

This change completes the second half of the grind loop without introducing client-side combat authority.

## Scope

- Continuous one-monster-at-a-time grind.
- XP, gold and drops applied only after a win resolves.
- Death returns the character to town and stops the chain.
- Potion/food exhaustion stops the chain and returns to town.
- Equipment replacement while grinding is staged and becomes active only between battles.
- The frontend renders the current battle from the authoritative event log: monster HP and character HP visibly fall at the event ticks, with no arena/map combat simulation.
- Queue transitions and reconnects remain server-authoritative.

## Non-goals

No manual combat input, client-side outcome simulation, new combat RNG, or arena presentation is introduced by this change.
