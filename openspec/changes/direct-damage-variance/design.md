# Design

## Direct damage boundary

The variance belongs at the last damage-calculation stage, after hit/crit selection, raw damage, defense/magic mitigation and source damage multipliers have been applied, but before the existing `Math.floor` and minimum-damage rule.

This keeps the requested ±1% variation attached to the final damage number rather than changing attack, defense, hit chance or critical chance.

The multiplier is sampled uniformly as:

```
0.99 + rng.next() * 0.02
```

The existing battle `Mulberry32` instance supplies the roll. Therefore the result is deterministic for the stored battle seed and remains reproducible during battle-log replay.

## Covered direct paths

The current engine has three successful direct-damage paths:

1. character basic Attack -> monster;
2. character damaging Skill -> monster;
3. monster basic Attack or damaging Skill -> character.

All use the same small helper so a future direct-damage branch cannot silently implement a different percentage rule.

## DOT boundary

The current battle engine does not yet execute damage-over-time damage. Its status-effect representation currently carries effect identity/timing metadata, but no active DOT tick-resolution path exists.

This change therefore does **not** invent a DOT subsystem. Instead, it establishes the required boundary for any future DOT implementation: application time computes and stores the fixed per-tick damage and fixed tick interval; the tick loop only consumes those stored values. No ±1% direct-damage roll may occur inside a DOT tick.

If a future DOT is based on a skill's damage, its snapshot is taken once at application from that skill/application context. Defense/mitigation rules for that DOT should remain whatever the DOT contract specifies; the important invariant here is that N and M do not change between ticks.

## Determinism

The helper must consume the existing battle PRNG rather than `Math.random()`. A same-seed simulation must remain byte-for-byte deterministic, while different seeds may produce different direct damage values as part of the normal seeded battle variation.
