# Tasks

## 1. Shared formula and contract

- [x] 1.1 Add a single exported helper that computes a food stat's effective value from its catalog value and a Diet level, plus the level derivation for a consumption (level stays 0 on first use, increments by one on a repeat after finished digestion, capped at 3). Verify: a unit-level check asserts catalog value unchanged at level 0, catalog+1 at level 1, catalog+3 at level 3, and cap behavior at level 3.
- [x] 1.2 Add an optional per-food Diet level map to the character snapshot contract consumed by the battle engine, defaulting to level 0 when absent so existing callers are unaffected. Verify: the shared package builds and an existing simulateBattle call that omits the field produces a byte-identical result to before.

## 2. Shared engine

- [x] 2.1 Scale in-simulation food stats by Diet level where the engine resolves a `use_item` food, using the shared helper rather than a local copy of the formula. Verify: a deterministic engine test at level 0 reproduces the current regen totals, and the same test at level 3 grants catalog+3 per stat.
- [x] 2.2 Derive the level for an in-battle food consumption from the engine's existing per-food digestion map, so it agrees with server-side consumption without duplicating that condition. Verify: a test consuming a never-seen food grants catalog values, and a test consuming a food whose digestion finished grants catalog+1.

## 3. Backend

- [x] 3.1 Write the effective, level-scaled value into the active food buff when food is consumed, covering both manual use and Auto Feed through the shared helper. Verify: consuming a level-0 food records catalog values; consuming the same food again after digestion records catalog+1.
- [x] 3.2 Reconstruct the active food buff at battle resolution with the same shared helper and the same level the consumption awarded, so a resolve cannot drift from the consumption that preceded it. Verify: consume at level 1, resolve a later battle, and assert the reconstructed buff equals the consumed value.
- [x] 3.3 Populate the engine snapshot's Diet level map from authoritative character state on every path that builds a snapshot for simulation. Verify: a snapshot built for a character with diet levels carries those levels, and a character with no diet yields level 0.

## 4. Frontend

- [x] 4.1 Report the effective, level-scaled regeneration in the Diet food tooltip by calling the shared helper with authoritative item and Diet state, instead of the raw catalog value. Verify: hovering a level-2 food that grants 8 HP and 1 SP shows 10 HP and 3 SP; a level-0 food shows its catalog values unchanged.
- [x] 4.2 Confirm the Diet hover reveal rule is present and scoped so the existing tooltip appears on an occupied Diet slot, and that the rule lives in the global stylesheet rather than the Character Panel component stylesheet. Verify: hovering an occupied Diet slot shows the tooltip in a browser, and a frontend build completes without tripping the component style budget.

## 5. Verification and documentation

- [x] 5.1 Update the main spec's food detail section to state that Diet level grants a flat +1 per granted stat, and that a mastered food grants strictly more than the same food at level 0. Verify: the text matches the delta in this change and no other spec contradicts it.
- [x] 5.2 Update project status and architecture notes with the fact that the effective food value has one definition shared across consumption, simulation, resolution and the tooltip, and why pre-scaling item definitions was rejected. Verify: the notes name the shared helper as the single source.
- [x] 5.3 Build shared, API and frontend, and run the focused engine and food tests. Verify: all three builds complete and the new level-scaling assertions pass alongside the existing food and digestion tests.
- [x] 5.4 Run strict OpenSpec validation on this change. Verify: validation passes with no errors.