# Design

## Context

See proposal.md for motivation. What shapes the approach technically:

- Food regeneration values are **flat integers**, not percentages. `food_bread` is `hpRegenPerTenTicks: 4, spRegenPerTenTicks: 1`. The engine adds them to a flat base regen (`battle-engine/index.ts:875`), and the base is itself flat (`1 + Math.floor(vit / 2)`). So the bonus is an additive integer, with no rounding rule needed.
- A food buff value is currently resolved in **two independent places**, which is the central hazard:
  1. Server-side consumption writes the active buff from raw catalog values.
  2. The battle engine reads `def.effect` directly when a `use_item` food happens mid-simulation.
  A third path reconstructs the active buff at resolve time from the battle log.
- The engine has no concept of Diet. `CharacterSnapshot` carries no Diet state, and the engine tracks per-food digestion itself via `foodDigestRemainingTicksByItem`.
- The level a consumption awards is computed twice and must agree: once in server-side consumption, once at resolve from the battle log. The rule is "a repeat after finished digestion awards level+1; a first consumption stays at 0".

## Goals / Non-Goals

**Goals:**

- One formula, defined once, used by every path that resolves a food value.
- Keep the engine deterministic and consistent with resolve-time application.
- No schema change and no data migration.
- Make the value a player reads in the tooltip identical to the value the engine applies.

**Non-Goals:**

- Changing food catalog values or the star cap of 3.
- Retroactively downgrading or grandfathering already-earned stars (see Risks).
- Adding percentage-typed food stats.
- Changing which food Auto Feed may choose.

## Decisions

### The level applied is the level the consumption awards, not the level before it

The bonus uses the **post-consumption** level — the one recorded on the Diet entry and rendered as stars.

This makes the star the player sees and the bonus they are receiving the same number, which is the whole point of mastery feedback. It also falls out of the existing rule naturally: a first consumption stays at level 0 and so grants exactly catalog values; a second consumption records level 1 and grants catalog+1.

**Alternative considered:** apply the pre-consumption level, so the first repeat grants catalog+0. Rejected — the star increments visibly on that consumption while the bonus appears not to move, which reads as a bug.

### Pass Diet level into the engine rather than pre-scaling item definitions

`CharacterSnapshot` gains a per-food Diet level map. The engine scales a food's stats at the moment it resolves the `use_item`.

**Alternative considered:** pre-scale the `itemDefinitions` handed to `simulateBattle` so the engine stays entirely diet-agnostic. Tempting, because it requires no engine type change, but it is wrong at the boundary: the level that applies to an in-battle consumption depends on whether that food had a previous entry whose digestion finished, which the engine knows and a pre-scaled definition cannot express. It would also split the level derivation across the API and the engine, inviting drift. Rejected.

Pre-scaling would additionally bake levels into a shared definition map that is reused across calls, so a level change would have to invalidate it.

### Centralize the formula in one shared helper

The effective value is computed by a single exported helper taking the catalog value and the Diet level. Every call site — server-side consumption, resolve-time reconstruction, engine in-simulation use, frontend tooltip — calls it.

**Alternative considered:** compute inline at each of the four sites. Rejected: the spec now requires all paths to agree, and the drift this feature is most likely to produce is exactly a silent mismatch between two of them. One helper makes drift a compile-time concern instead of a playtest discovery.

### Derive the in-battle level from digestion state, not by mirroring the API

The engine derives the level for an in-simulation `use_item` from the per-food digestion map it already maintains. A food whose digestion is still running is rejected by the existing legality check, so by the time a `use_item` succeeds the food either has no previous entry (level 0) or has a finished one (level+1). That is the same rule the API applies, derived independently rather than duplicated as a second copy of the API's condition.

### Percentage-typed stats, if they ever exist, take +1 percentage point

The intended rule is recorded even though no food currently grants a percentage stat: a level of `n` adds `n` percentage points to a percentage stat, mirroring the flat `+n`. Implementing it now would add an untested branch, so the helper will accept the value and level and the percentage semantics are documented for when such a stat is introduced.

## Risks / Trade-offs

- **Silent balance shift for returning players** → `dietLevels` is already persisted, so a character with stars gains the bonus immediately on deploy, with no migration or announcement step. Accepted deliberately: capping or grandfathering would decouple the bonus from the star the player can see, and the magnitude is small (at most +3 per stat). Flagged here so it is a choice rather than a surprise.
- **Cross-package type change** → adding a field to `CharacterSnapshot` touches the shared package and every engine caller. Mitigated by keeping it additive and optional, so existing call sites that omit it simulate as before (level treated as 0).
- **Formula drift between consumption and resolve** → mitigated by the shared helper and by making the "effective food value is consistent everywhere" spec requirement explicit and testable.
- **Frontend recomputes a bonus the server already knows** → the tooltip derives catalog + level from authoritative item and Diet data rather than from a server-computed field. Accepted to avoid a new API surface; the risk is that the tooltip and the engine disagree if the formula changes, which the shared helper prevents since both call the same code.
- **Component CSS budget** → the Character Panel stylesheet sits at its configured ceiling. Diet tooltip rules must live in the global stylesheet rather than the component stylesheet, or the build fails on budget.

## Migration Plan

None required. `dietLevels` already stores `{ level, lastDigestUntil }` per food and is already part of the authoritative Character snapshot, and the snapshot already flows to the realtime channels the client subscribes to. The additive `CharacterSnapshot` field needs no backfill: absence means level 0, which is also the correct level for any food never consumed.

Rollback is a revert. Because no persisted data changes shape, reverting leaves `dietLevels` intact and simply stops applying the bonus.

## Open Questions

None that would change the specs, the approach, or the task breakdown.