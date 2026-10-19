# Design

## Context

See `proposal.md` for motivation and approved gameplay behavior.

The shared engine currently computes `castSpeed = 100 + floor(DEX × 2)`, uses a separate DEX-only `castGaugeThreshold` for all player Cast actions, and evaluates player skill Gambits before the basic Attack gauge solely to grant same-tick priority. When the player cast gauge fires, skill SP/cooldown are applied and the complete effect/log are resolved immediately; `castLockTicks` is set afterward. Monster casting already has a distinct `monsterCastGauge` path and must remain isolated.

The battle clock is integer ticks at one second each. Lane movement commits in a deterministic post-action phase; positions changed at the end of tick N become visible to range checks on tick N+1. The engine is pure/deterministic and the server's pre-simulated battle snapshot remains immutable after queue creation.

## Goals / Non-Goals

**Goals**
- Make a legal player skill intent actionable at T0 rather than after an unrelated gauge fill.
- Make `baseCastTicks` the actual time until the skill effect resolves.
- Keep all legality, effect formulas, status application, seeded RNG, log ownership and single-target semantics in the shared engine.
- Make CTR one canonical derived value shared by API and frontend.
- Preserve monster timelines and non-skill Cast action behavior.

**Non-Goals**
- Change monster casting, monster SP/cooldowns, basic Attack duration/gauge, the one-second simulation clock, or battle queue timing.
- Change skill catalogue balance, skill costs, cooldown values, skill effects, ranges, or target definitions.
- Add new cast-interruption rules, target switching, projectiles, or client-side simulation.
- Add persistence, database schema, migrations, or production deployment.

## Decisions

### 1. CTR calculation and whole-tick quantization

Calculate `castTimeReduction = floor(DEX × 2)` in the same authoritative derived-stat calculation that currently supplies Cast Speed. Do not add 100: DEX 5 yields CTR 10, not 110. Rename the returned/serialized stat to `castTimeReduction` end-to-end; do not maintain a second `castSpeed` alias that can drift or mislead the UI.

For a character skill, normalize its base duration to a non-negative integer tick count using the existing catalog default of 2 when `baseCastTicks` is absent. Then compute:

```ts
effectiveCastTicks = Math.max(0, Math.ceil(baseCastTicks - castTimeReduction / 100));
```

The ceiling is deliberate: the simulator only has whole-second resolution, so a remaining positive fraction of a second resolves on the next tick, not early. Every 100 CTR removes one full tick when available. No one-tick floor is permitted. A catalog duration of 0 or a reduced duration of 0 resolves at the same tick as the legal in-range intent.

Examples for a two-tick skill: CTR 10 → 2 ticks; CTR 100 → 1 tick; CTR 200 → 0 ticks. These examples are requirements for the helper and regression tests.

### 2. Separate skill intent from the legacy non-skill Cast gauge

At every tick, evaluate the same canonical player Cast Gambit early enough to preserve its current relationship with Attack-gauge precedence. The first line returned by `GambitEvaluator` remains authoritative; do not invent a second evaluator, reorder lines, or bypass conditions/unlock/equipment/SP/cooldown legality.

If a selected legal action is `use_skill` and there is no skill already casting:
1. Resolve the skill definition from the immutable character skill snapshot.
2. Determine whether it requires an enemy target from the existing canonical skill target/range semantics. Self/no-target skills skip distance checks.
3. For a targeted skill, convert its catalog range through the existing lane-distance helper/semantics. If out of range, set movement intent/range and do not create a pending cast or alter SP/cooldown.
4. If in range, clear stale movement intent and begin the cast. A positive duration creates pending state with skill ID, start tick and resolution tick. A zero duration goes straight to the existing skill-resolution logic in the same tick.
5. While pending, do not begin another player skill, execute a non-skill Cast action, or resolve a basic Attack. Keep the Attack gauge at zero; it begins refilling again after the cast resolution tick. Re-evaluate Gambit conditions/legality during approach, but do not cancel or replace a cast that has already begun.

The current Cast gauge remains only for non-skill actions (`use_item`, `defend`, `wait`). Preserve their current DEX-based scheduling, action legality and cooldown/consumption behavior. A selected higher-priority non-skill Cast action must retain normal Gambit precedence rather than allowing a lower-priority skill to leapfrog it; it still executes only on the existing non-skill Cast-gauge fire. A selected out-of-range skill continues to own that Gambit selection and must not cause a lower-priority Cast action to execute. Ensure a Cast-gauge fire cannot execute a `use_skill` a second time after the new skill-intent path has already started or resolved it.

The exact implementation may extract a small helper for the canonical current Cast choice, but it must keep a single priority/legality source of truth. Do not hardcode individual skills such as War Cry to gain immediate behavior.

### 3. Pending-cast lifecycle and resolution ownership

Extract/reuse one player-skill resolution path instead of duplicating every skill effect between instant and timed casts. The path is called only when the pending cast reaches its resolution tick (or immediately for zero ticks). It must preserve the existing formulas and side-effect order, including Wisp Flow's pre-cost SP sample, Arcane Dynamo refund timing, status application through canonical status definitions, seeded random rolls, damage/HP/SP events and Mastery-action logging.

- Validate legality and target range before starting the cast.
- Keep the skill selected by the successful start; changing Gambit conditions later does not retroactively replace an in-progress cast.
- Pay the SP cost when the skill effect resolves, matching the established resolver ownership; the start-time SP legality check guarantees the cost can be paid because other SP-spending Cast actions are locked while casting and passive regeneration can only increase SP.
- Start the skill cooldown at resolution, so configured cooldown ticks occur after cast time and do not run concurrently with it. Reuse current cooldown bookkeeping conventions carefully and test the exact tick where the next cast can begin.
- Apply effect and status durations at the actual resolution tick; emit `use_skill`/status/damage/heal/resource logs with the resolution tick, not the cast-start tick.
- Once a positive-duration cast is pending, do not re-evaluate it against changing Gambit conditions. No new interruption semantics are introduced; retain the engine's existing battle-end/status rules and do not invent a separate cancellation mechanic.

Maintain existing action ordering: character actions resolve before the monster's action on a tick, and movement resolves in the current deterministic post-action phase. If a target is out of range at the beginning of a tick but moves into range only in the end-of-tick movement phase, its earliest cast-start check is the following tick.

### 4. Monsters remain on their current path

Do not repurpose `monsterCastGauge`, monster cast thresholds, monster `baseCastTicks`, `foeCooldowns`, or monster SP timing to use CTR or player pending-cast state. A Wailing Wraith two-tick Ice Bolt retains its existing monster timing exactly. Use the existing monster regression to detect accidental coupling, and add an assertion that changing character DEX/CTR does not change the monster event ticks in an otherwise identical seeded simulation.

### 5. Derived-stat/UI integration

Rename the field instead of exposing stale aliases:
- Shared result: `castTimeReduction`
- API Character DTO: `castTimeReduction`
- Frontend Character model/serialized API data: `castTimeReduction`
- Character Stats label: `Cast Time Reduction`
- DEX explanatory tooltip: DEX contributes to Accuracy and Cast Time Reduction.

Update fixture/mocked Character objects and all source references. Do not duplicate or independently calculate CTR in Angular. This is derived data, so no database migration or catalog rewrite is needed.

### 6. Verification and docs

Use focused deterministic simulator tests rather than timing sleeps. Cover T0 choice, delayed/instant resolution, CTR values/rounding, enemy range/movement, self-target, SP/cooldown ownership, skill vs Attack priority, non-skill Cast regression, and monster non-regression. Run shared/API/frontend builds, relevant existing combat tests, strict OpenSpec validation and `git diff --check`.

Update only the relevant cast/stat paragraphs in both `SPEC.md` copies, preserving unrelated differences between those files. Update `ARCHITECTURE.md` with the pending-cast and tick-order ownership. `STATUS.md` must record tests actually executed, their results and any environment limitations. No deployment or DB operation.

## Risks / Trade-offs

- **A skill could resolve at the wrong tick because start ticks are counted as elapsed time** → Define resolution as `startTick + effectiveCastTicks`, keep T0 as the instant start, and assert exact event ticks for durations 0, 1 and 2.
- **A delayed skill's side effects could diverge from the former inline effect path** → Extract/reuse one resolver and assert representative active skills including self-buff, heal, damage, status, Wisp Flow SP sampling and passive refund.
- **Items or lower-priority lines could execute while a skill is approaching/casting** → Keep one Gambit evaluator/priority result per tick, leave out-of-range selected skills as the selected intent, and lock all other Cast actions only while a cast is pending.
- **Basic attacks could land during a cast or on the same tick as the skill** → Reset/hold the player Attack gauge from cast start through the resolution tick; resume only on a later tick.
- **Player CTR changes monster timelines** → Keep monster code and clocks separate and prove this with Wailing Wraith Ice Bolt timing regression.
- **API stat rename leaves stale consumers/fixtures** → Search for all old `castSpeed` references after the change and update DTO/model/test fixtures together.
- **Existing non-skill Cast behavior unintentionally accelerates** → Keep `use_item`, `defend`, and `wait` on the current Cast gauge scheduling and test representative cases.
