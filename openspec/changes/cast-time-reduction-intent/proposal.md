# Proposal

## Why

Character skills currently wait for a DEX-based cast gauge before they can even begin; a selected self-target skill such as War Cry therefore does not start at T0. The engine also applies a character skill's effect immediately when that gauge fires and only then applies `baseCastTicks` as a lock, so the recorded effect timing does not represent an actual cast. This change separates immediate skill intent from the time required for a cast to resolve.

## What Changes

- Replace the displayed **Cast Speed** derived stat with **Cast Time Reduction (CTR)**. CTR is `floor(DEX × 2)`, with no legacy +100 baseline; a fresh character at DEX 5 has 10 CTR.
- Apply 100 CTR as one second (one battle tick) of cast-time reduction. Since character combat resolves on whole-second ticks, calculate effective duration as `max(0, ceil(baseCastTicks - CTR / 100))`. Never impose a minimum of one tick: an effective duration of zero resolves in the same tick that the skill intention passes validation.
- Evaluate the character's Cast Gambit from T0 and on subsequent ticks without waiting for the character cast gauge to fire. Validate the selected skill through the canonical Gambit legality rules before considering its target and range.
- For a legal skill with an enemy target, check current distance before starting. If out of range, set the existing movement intent only: do not begin casting, spend SP, or start cooldown. Re-evaluate the Gambit and legality while approaching; begin casting on the first tick the selected legal skill is in range. Self-target/no-target skills such as War Cry can begin at T0.
- Track a pending character skill while it casts. For positive duration, resolve the effect at `castStartedAtTick + effectiveCastTicks`; for zero duration, resolve immediately in the intention tick. Pay SP and start the skill cooldown at resolution, preserve canonical effect formulas/status/log behavior, and prevent a basic attack or another character Cast action from resolving during the skill's cast.
- Keep the existing non-skill Cast actions (`use_item`, `defend`, `wait`) on their current scheduling/legality contract; do not let the new skill-intent path execute them twice or bypass Gambit priority.
- Keep the monster cast gauge and all monster `baseCastTicks`/cooldown timing unchanged. Keep basic attack timing and its separate two-tick resolution behavior unchanged outside the existing skill-action priority/lock.
- Update both canonical SPEC copies, ARCHITECTURE.md, DTO/API/frontend stat naming and the Character Stats display; add focused deterministic regression tests for timing, movement, resources, priority and monster non-regression.

## Capabilities

### New Capabilities

- `character-skill-casting`: Defines the character-only immediate skill-intent and CTR-based cast-resolution contract.

### Modified Capabilities

None. The repository has no registered capability specs under `openspec/specs/<capability>/spec.md`; this change creates a focused capability delta rather than pretending the monolithic `SPEC.md` is already a registered OpenSpec capability.

## Impact

- Shared derived-stat calculation and deterministic battle simulation in `packages/shared/src/battle-engine/index.ts`.
- Character DTO and serialization in `packages/shared/src/dto/index.ts` and `apps/api/src/modules/character/character.service.ts`.
- Frontend Character model and Stats/DEX tooltips in `apps/frontend/src/app/core/game.models.ts` and `apps/frontend/src/app/features/character/`.
- Shared-engine/API/frontend contract tests and relevant simulator regression tests.
- Documentation: `SPEC.md`, `openspec/specs/SPEC.md`, `ARCHITECTURE.md`, and the implementation handoff in `STATUS.md`.

No schema change or database migration is required: CTR is a derived stat, and pending casts exist only inside a deterministic battle simulation. Do not deploy or mutate a database as part of implementation.
