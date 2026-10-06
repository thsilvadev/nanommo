# Direct Damage Variance

## Why

Direct attacks and damaging skills currently resolve to a fully deterministic final damage value after hit/crit, mitigation and other damage multipliers. This makes otherwise identical successful hits always deal exactly the same amount.

## What Changes

- Add a small server-authoritative damage variance to every successful direct damage event from both characters and monsters.
- Roll a uniform multiplier from **0.99 through 1.01** and apply it to the already-mitigated/final direct damage before the existing integer rounding and minimum-damage rule.
- Use the battle engine's seeded PRNG so the variance remains deterministic and replayable for a given battle seed.
- Apply the variance to basic attacks and damaging skills, regardless of whether the source is a player or monster.
- Do not apply this variance to damage-over-time ticks.
- When a DOT exists, its per-tick damage value and tick interval must be snapshotted when the effect is applied; subsequent ticks reuse those values without rerolling or recalculating them.

## Capabilities

### Modified Capabilities

- battle-engine: add deterministic ±1% variance to direct final damage and define the non-rerolling DOT boundary.

## Impact

Server/shared battle-engine only. No client authority, API change, equipment/stat change, or new gameplay resource is introduced. Existing seeded replay/determinism remains intact.
