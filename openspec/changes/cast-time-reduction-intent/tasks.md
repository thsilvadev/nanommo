# Tasks

## 1. Contract and stat plumbing

- [x] 1.1 Add the `character-skill-casting` capability contract and reconcile its rules with both root and canonical `SPEC.md` copies.
- [x] 1.2 Rename derived `castSpeed` to `castTimeReduction` in shared calculation/result, DTO, API serializer, frontend model and Character Stats UI; update DEX tooltip and all mocks/fixtures.
- [x] 1.3 Add a shared, tested effective-cast-duration helper using `max(0, ceil(baseCastTicks - CTR / 100))`; assert DEX 5 → CTR 10 and two-tick skill results CTR 10 → 2, CTR 100 → 1, CTR 200 → 0.

## 2. Character skill-intent state machine

- [x] 2.1 Evaluate the canonical player Cast Gambit at T0 and every tick, retaining its first-legal-line conditions, unlock/equipment, SP and cooldown validation; do not use the player cast gauge as a prerequisite for skills.
- [x] 2.2 Introduce pending-character-cast state (skill ID, start tick, resolution tick) for positive durations, with zero-duration effects resolved immediately in the intention tick.
- [x] 2.3 Resolve a selected legal in-range skill immediately for duration zero or at `startTick + effectiveCastTicks` for positive durations; make effect/status/damage/heal logs and status durations use the resolution tick.
- [x] 2.4 Keep a legal out-of-range targeted skill as the selected approach intent, initiate no cast and spend no SP/start no cooldown; begin casting on the first tick the currently selected legal skill is in range. Re-evaluate Gambit/legality during approach.
- [x] 2.5 Reuse one existing skill-resolution implementation for all skills, preserving formulas, pre-cost SP reads, refunds, statuses, seeded RNG and action side effects; charge SP and begin cooldown at resolution.
- [x] 2.6 Hold/reset the player Attack gauge from cast start through the resolution tick; prevent another character skill or a non-skill Cast action from resolving during a pending cast.
- [x] 2.7 Preserve Gambit ordering and the legacy Cast-gauge schedule for non-skill actions `use_item`, `defend`, and `wait`; prevent duplicate skill execution and same-tick skill/basic-attack resolution.

## 3. Regression coverage

- [x] 3.1 Add T0 self-target/no-target regressions (including War Cry): valid intent begins at T0 without a target-range wait; positive duration resolves only at the expected tick.
- [x] 3.2 Cover zero `baseCastTicks` and CTR-reduced-to-zero: legal skills resolve in the intention tick after all validations; no artificial one-tick minimum.
- [x] 3.3 Cover CTR rounding/tick boundaries and cast-start/resolution timing for 0-, 1-, and 2-tick effective durations.
- [ ] 3.4 Cover target range: out-of-range skill starts movement only; no SP/cooldown/pending cast until in range; movement phase timing determines the first legal start tick; self/no-target skills skip range checks.
- [ ] 3.5 Cover invalid/locked/insufficient-SP skills and Gambit fallback order; ensure an out-of-range selected skill does not let lower-priority Cast actions execute.
- [ ] 3.6 Cover SP payment, cooldown start/availability, and skill event timestamps at resolution; representative damage/heal/buff/status skills plus Wisp Flow/Arcane Dynamo preserve their existing mechanics.
- [ ] 3.7 Cover attack priority/lock: no basic attack on the skill-start or resolution tick and none during a pending cast; Attack gauge resumes after cast completion.
- [ ] 3.8 Add regressions proving `use_item`, `defend`, and `wait` retain existing Cast-gauge timing, and Wailing Wraith's monster Ice Bolt timing is unchanged by player DEX/CTR.
- [ ] 3.4–3.8 Add/complete range, legality/fallback, resource/cooldown, representative skill side-effect, non-skill Cast scheduling and monster timing regressions.
- [ ] 3.9 Run focused combat tests and all relevant shared/API/frontend builds; strict OpenSpec validation, old-field reference search and `git diff --check`.

## 4. Documentation and handoff

- [x] 4.1 Update the relevant derived-stat, player-cast, tick-order and non-skill-action rules in root `SPEC.md` and `openspec/specs/SPEC.md` without overwriting unrelated differences.
- [x] 4.2 Update `ARCHITECTURE.md` for character pending-cast state, action priority, resolution ownership, CTR formula and explicit unchanged monster path.
- [x] 4.3 Update `STATUS.md` with exact changes, commands/tests actually run, outcomes, and remaining verification; explicitly confirm no database operation, migration or deployment occurred.
